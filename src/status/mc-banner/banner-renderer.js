const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { join } = require("node:path");
const BannerImages = require("./banner-images");

class BannerRenderer {
  constructor(font, assetRoot) {
    this.font = font;
    this.assetRoot = assetRoot;
    this.pingIcons = new Map();
  }

  async render(options) {
    const renderHeight = 256;
    const canvas = createCanvas(options.width, renderHeight);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const [background, icon, pingIcon] = await Promise.all([
      BannerImages.background(
        options.backgroundUrl,
        options.allowRemoteBackgrounds,
        options.allowPrivateHosts,
        options.backgroundTimeoutMillis,
      ),
      BannerImages.serverIcon(options.favicon),
      this.#getPingIcon(options.ping),
    ]);

    ctx.save();
    ctx.filter = "blur(2px) brightness(0.55)";
    ctx.drawImage(background, -4, -4, options.width + 8, renderHeight + 8);
    ctx.restore();
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(0, 0, options.width, renderHeight);

    const padding = 24;
    const iconSize = 184;
    const iconX = padding;
    const iconY = Math.trunc((renderHeight - iconSize) / 2);
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.filter = "blur(0.4px)";
    ctx.drawImage(icon, iconX, iconY, iconSize, iconSize);
    ctx.restore();

    const textX = iconX + iconSize + 28;
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.filter = "blur(0.4px)";
    this.font.draw(ctx, [{ text: options.title, color: "#eeeeee" }], textX, 18, 38);
    ctx.restore();
    for (let index = 0; index < options.motd.length; index++) {
      this.font.draw(
        ctx,
        options.motd[index],
        textX,
        78 + index * 54,
        40,
      );
    }

    const pingWidth = 64;
    const pingHeight = 50;
    const pingX = options.width - padding - pingWidth;
    const playerFontSize = 44;
    const playerY = 17;
    const pingY = 9;
    ctx.drawImage(pingIcon, pingX, pingY, pingWidth, pingHeight);
    this.font.draw(
      ctx,
      [{ text: options.players, color: "#eeeeee" }],
      pingX - 20,
      playerY,
      playerFontSize,
      { align: "right" },
    );
    return canvas.toBuffer("image/png");
  }

  async #getPingIcon(milliseconds) {
    const name = milliseconds < 0 ? "ping_unknown"
      : milliseconds < 150 ? "ping_5"
      : milliseconds < 300 ? "ping_4"
      : milliseconds < 600 ? "ping_3"
      : milliseconds >= 1000 ? "ping_1"
      : "ping_2";
    if (!this.pingIcons.has(name)) {
      const file = join(
        this.assetRoot,
        "assets", "minecraft", "textures", "gui", "sprites", "icon", `${name}.png`,
      );
      this.pingIcons.set(name, await loadImage(file));
    }
    return this.pingIcons.get(name);
  }
}

module.exports = BannerRenderer;
