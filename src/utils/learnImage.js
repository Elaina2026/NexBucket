import sharp from 'sharp';

export const LEARN_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const LEARN_IMAGE_MAX_DIMENSION = 4096;
const FORMATS = {
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  png: { mimeType: 'image/png', extension: 'png' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
  gif: { mimeType: 'image/gif', extension: 'gif' },
};

export async function validateLearnImage(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new TypeError('Image file is required');
  if (buffer.length > LEARN_IMAGE_MAX_BYTES) throw new RangeError('Image must be 5 MB or smaller');

  const declaredMime = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  let metadata;
  try {
    metadata = await sharp(buffer, { animated: true, limitInputPixels: LEARN_IMAGE_MAX_DIMENSION ** 2 }).metadata();
  } catch {
    throw new TypeError('File is not a valid image');
  }

  const format = FORMATS[metadata.format];
  if (!format) throw new TypeError('Only PNG, JPEG, WebP, and GIF images are supported');
  if (declaredMime !== format.mimeType) throw new TypeError(`Image content type must be ${format.mimeType}`);
  if (!metadata.width || !metadata.height
    || metadata.width > LEARN_IMAGE_MAX_DIMENSION
    || metadata.height > LEARN_IMAGE_MAX_DIMENSION) {
    throw new RangeError(`Image dimensions must not exceed ${LEARN_IMAGE_MAX_DIMENSION}×${LEARN_IMAGE_MAX_DIMENSION}`);
  }

  return { ...format, width: metadata.width, height: metadata.height };
}
