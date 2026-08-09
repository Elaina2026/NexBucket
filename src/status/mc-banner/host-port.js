const { normalizeHost } = require("./network-guard");

function parsePort(raw) {
  if (!/^\d+$/.test(raw)) throw new TypeError("Invalid port");
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError("port must be between 1 and 65535");
  }
  return port;
}

function choosePort(explicit, embedded) {
  if (explicit != null && embedded != null && explicit !== embedded) {
    throw new TypeError("Port is specified twice with different values");
  }
  return explicit ?? embedded ?? 25565;
}

function parseHostPort(raw, explicitPort = null) {
  const value = String(raw ?? "").trim();
  if (value.startsWith("[") && value.includes("]")) {
    const close = value.indexOf("]");
    const host = value.slice(1, close);
    let embedded = null;
    if (close + 1 < value.length) {
      if (value[close + 1] !== ":") throw new TypeError("Invalid IPv6 address");
      embedded = parsePort(value.slice(close + 2));
    }
    const normalized = normalizeHost(host);
    const port = choosePort(explicitPort, embedded);
    return { host: normalized, port, display: port === 25565 ? normalized : `[${normalized}]:${port}` };
  }

  if ((value.match(/:/g) || []).length === 1) {
    const colon = value.lastIndexOf(":");
    const possiblePort = value.slice(colon + 1);
    if (/^\d+$/.test(possiblePort)) {
      const normalized = normalizeHost(value.slice(0, colon));
      const port = choosePort(explicitPort, parsePort(possiblePort));
      return { host: normalized, port, display: port === 25565 ? normalized : `${normalized}:${port}` };
    }
  }

  const normalized = normalizeHost(value);
  const port = choosePort(explicitPort, null);
  return { host: normalized, port, display: port === 25565 ? normalized : `${normalized}:${port}` };
}

module.exports = { parseHostPort, parsePort };
