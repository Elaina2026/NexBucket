'use strict';

const net = require('net');
const NetworkGuard = require('./network-guard');

class SocketReader {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.error = null;
    this.ended = false;

    this.onData = (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this._flush();
    };
    this.onError = (err) => {
      this.error = err;
      this._rejectWaiters(err);
    };
    this.onEnd = () => {
      this.ended = true;
      this._rejectWaiters(new Error('Unexpected end of Minecraft packet'));
    };

    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('end', this.onEnd);
  }

  _flush() {
    while (this.waiters.length > 0) {
      const { bytes, resolve } = this.waiters[0];
      if (this.buffer.length >= bytes) {
        const waiter = this.waiters.shift();
        clearTimeout(waiter.timer);
        const data = this.buffer.subarray(0, bytes);
        this.buffer = this.buffer.subarray(bytes);
        resolve(data);
      } else {
        break;
      }
    }
  }

  _rejectWaiters(err) {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }

  async readExactly(n) {
    if (this.error) throw this.error;
    if (this.buffer.length >= n) {
      const data = this.buffer.subarray(0, n);
      this.buffer = this.buffer.subarray(n);
      return data;
    }
    if (this.ended) throw new Error('Unexpected end of Minecraft packet');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error('Read timeout'));
      }, this.timeoutMs);

      this.waiters.push({ bytes: n, resolve, reject, timer });
    });
  }

  async readByte() {
    const buf = await this.readExactly(1);
    return buf[0];
  }

  async readVarInt() {
    let result = 0;
    let bytesRead = 0;
    let current;
    do {
      const buf = await this.readExactly(1);
      current = buf[0];
      result |= (current & 0x7f) << (7 * bytesRead);
      bytesRead++;
      if (bytesRead > 5) {
        throw new Error('VarInt is too large');
      }
    } while ((current & 0x80) !== 0);
    return result;
  }

  destroy() {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('end', this.onEnd);
  }
}

function writeVarInt(value) {
  const bytes = [];
  do {
    let current = value & 0x7f;
    value >>>= 7;
    if (value !== 0) {
      current |= 0x80;
    }
    bytes.push(current);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function writeString(str) {
  const strBuf = Buffer.from(str, 'utf8');
  if (strBuf.length > 32767) {
    throw new Error('Minecraft host is too long');
  }
  return Buffer.concat([writeVarInt(strBuf.length), strBuf]);
}

function writePacket(socket, payload) {
  const lenBuf = writeVarInt(payload.length);
  socket.write(Buffer.concat([lenBuf, payload]));
}

function normalizeDescription(description) {
  if (description == null) {
    return JSON.stringify({ text: '' });
  }
  if (typeof description === 'string') {
    return JSON.stringify({ text: description });
  }
  return JSON.stringify(description);
}

function decodeFavicon(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }
  const comma = rawValue.indexOf(',');
  if (comma < 0 || !rawValue.substring(0, comma).toLowerCase().includes('base64')) {
    return null;
  }
  const base64Str = rawValue.substring(comma + 1).trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Str) || base64Str.length % 4 !== 0) return null;
  let bytes;
  try {
    bytes = Buffer.from(base64Str, 'base64');
  } catch (e) {
    return null;
  }
  if (bytes.length > 1_000_000) {
    throw new Error('Server favicon is too large');
  }
  return bytes;
}

class MinecraftStatusClient {
  constructor(
    connectTimeoutMillis = 5000,
    readTimeoutMillis = 5000,
    protocolVersion = 47,
    allowPrivateHosts = false,
    deps = {}
  ) {
    this.connectTimeoutMillis = connectTimeoutMillis;
    this.readTimeoutMillis = readTimeoutMillis;
    this.protocolVersion = protocolVersion;
    this.allowPrivateHosts = allowPrivateHosts;
    this.netConnect = deps.netConnect || net.connect;
    this.dnsResolver = deps.dnsResolver;
  }

  async query(host, port) {
    const resolved = await NetworkGuard.resolve(host, this.allowPrivateHosts, this.dnsResolver);

    const socket = await new Promise((resolve, reject) => {
      let timer;
      const s = this.netConnect({ host: resolved.address, port }, () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      timer = setTimeout(() => {
        s.destroy();
        reject(new Error('Connect timeout'));
      }, this.connectTimeoutMillis);
    });

    socket.setNoDelay(true);
    const reader = new SocketReader(socket, this.readTimeoutMillis);

    try {
      // 1. Send Handshake
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port, 0);
      const handshakePayload = Buffer.concat([
        writeVarInt(0x00),
        writeVarInt(this.protocolVersion),
        writeString(resolved.handshakeHost),
        portBuf,
        writeVarInt(0x01)
      ]);
      writePacket(socket, handshakePayload);

      // 2. Send Status Request
      writePacket(socket, Buffer.from([0x00]));

      // 3. Read Status Response
      const responseLength = await reader.readVarInt();
      if (responseLength <= 0 || responseLength > 2_000_000) {
        throw new Error('Invalid Minecraft status packet length');
      }
      const packetId = await reader.readVarInt();
      if (packetId !== 0x00) {
        throw new Error(`Unexpected Minecraft status packet id: ${packetId}`);
      }

      const jsonLength = await reader.readVarInt();
      if (jsonLength < 0 || jsonLength > 1_900_000) {
        throw new Error('Minecraft status JSON is too large');
      }
      const jsonBuf = await reader.readExactly(jsonLength);
      const jsonStr = jsonBuf.toString('utf8');

      let root;
      try {
        root = JSON.parse(jsonStr);
        if (typeof root !== 'object' || root === null || Array.isArray(root)) {
          throw new Error('Minecraft status response is not a JSON object');
        }
      } catch (e) {
        if (e.message === 'Minecraft status response is not a JSON object') throw e;
        throw new Error('Invalid JSON returned by Minecraft server');
      }

      // 4. Send Ping
      const pingStarted = process.hrtime.bigint();
      const timeBuf = Buffer.alloc(8);
      timeBuf.writeBigInt64BE(BigInt(Date.now()), 0);
      const pingPayload = Buffer.concat([writeVarInt(0x01), timeBuf]);
      writePacket(socket, pingPayload);

      // 5. Read Pong
      const pongLength = await reader.readVarInt();
      if (pongLength > 64) {
        throw new Error('Invalid pong packet length');
      }
      const pongId = await reader.readVarInt();
      if (pongId !== 0x01) {
        throw new Error(`Unexpected pong packet id: ${pongId}`);
      }
      await reader.readExactly(8);
      const elapsedNs = process.hrtime.bigint() - pingStarted;
      const latencyMillis = Math.max(0, Number(elapsedNs / 1_000_000n));

      // Extract result fields
      const players = (root.players && typeof root.players === 'object') ? root.players : {};
      const version = (root.version && typeof root.version === 'object') ? root.version : {};

      const online = typeof players.online === 'number' ? players.online : 0;
      const max = typeof players.max === 'number' ? players.max : 0;
      const versionName = typeof version.name === 'string' ? version.name : 'Unknown';
      const descriptionJson = normalizeDescription(root.description);
      const favicon = decodeFavicon(root.favicon);

      return {
        online: true,
        onlinePlayers: online,
        maxPlayers: max,
        latencyMillis,
        versionName,
        descriptionJson,
        favicon,
        error: null
      };
    } finally {
      reader.destroy();
      socket.destroy();
    }
  }

  static offline(error) {
    return {
      online: false,
      onlinePlayers: 0,
      maxPlayers: 0,
      latencyMillis: -1,
      versionName: 'Unknown',
      descriptionJson: JSON.stringify({ text: '' }),
      favicon: null,
      error
    };
  }
}

module.exports = MinecraftStatusClient;
