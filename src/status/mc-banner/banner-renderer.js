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
    const scale = options.width / BannerImages.BASE_WIDTH;
    const renderHeight = Math.max(1, Math.trunc(BannerImages.BASE_HEIGHT * scale));
    const canvas = createCanvas(options.width, renderHeight);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

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

    ctx.drawImage(background, 0, 0, options.width, renderHeight);
    this.font.draw(ctx, [{ text: options.title, color: "#ffffff" }], Math.trunc(76 * scale), Math.trunc(7 * scale), 16 * scale);
    for (let index = 0; index < options.motd.length; index++) {
      this.font.draw(
        ctx,
        options.motd[index],
        Math.trunc(76 * scale),
        Math.trunc(29 * scale) + Math.trunc(index * 18 * scale),
        16 * scale,
      );
    }
    ctx.drawImage(
      icon,
      Math.trunc(5 * scale),
      Math.trunc(5 * scale),
      Math.trunc(64 * scale),
      Math.trunc(64 * scale),
    );
    ctx.drawImage(
      pingIcon,
      options.width - Math.trunc(27 * scale),
      Math.trunc(7 * scale),
      Math.trunc(20 * scale),
      Math.trunc(15.5 * scale),
    );
    this.font.draw(
      ctx,
      [{ text: options.players, color: "#aaaaaa" }],
      options.width - Math.trunc(34 * scale),
      Math.trunc(8 * scale),
      16 * scale,
      { align: "right" },
    );
    this.font.draw(
      ctx,
      [{ text: options.watermark, color: "#555555" }],
      options.width,
      renderHeight - Math.trunc(8 * scale),
      6 * scale,
      { align: "right" },
    );
    const output = BannerImages.ensureOutputSize(canvas, options.width);
    return output.toBuffer("image/png");
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
