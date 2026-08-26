import sharp from 'sharp';

export const LEARN_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const LEARN_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const LEARN_MEDIA_MAX_BYTES = LEARN_VIDEO_MAX_BYTES;
const LEARN_IMAGE_MAX_DIMENSION = 4096;
const IMAGE_FORMATS = {
  jpeg: { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' },
  png: { kind: 'image', mimeType: 'image/png', extension: 'png' },
  webp: { kind: 'image', mimeType: 'image/webp', extension: 'webp' },
  gif: { kind: 'image', mimeType: 'image/gif', extension: 'gif' },
};

function declaredMimeType(contentType) {
  return String(contentType || '').split(';', 1)[0].trim().toLowerCase();
}

function validateVideo(buffer, declaredMime) {
  // ponytail: validate container signature only; add ffprobe/parser when codec or duration enforcement is required.
  if (buffer.length > LEARN_VIDEO_MAX_BYTES) throw new RangeError('Video must be 25 MB or smaller');
  if (declaredMime === 'video/mp4') {
    if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') throw new TypeError('File is not a valid MP4 video');
    return { kind: 'video', mimeType: declaredMime, extension: 'mp4' };
  }
  if (declaredMime === 'video/webm') {
    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      throw new TypeError('File is not a valid WebM video');
    }
    return { kind: 'video', mimeType: declaredMime, extension: 'webm' };
  }
  return null;
}

export async function validateLearnMedia(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new TypeError('Media file is required');
  const declaredMime = declaredMimeType(contentType);
  const video = validateVideo(buffer, declaredMime);
  if (video) return video;
  if (!declaredMime.startsWith('image/')) {
    throw new TypeError('Only PNG, JPEG, WebP, GIF, MP4, and WebM media are supported');
  }
  if (buffer.length > LEARN_IMAGE_MAX_BYTES) throw new RangeError('Image must be 5 MB or smaller');

  let metadata;
  try {
    metadata = await sharp(buffer, { animated: true, limitInputPixels: LEARN_IMAGE_MAX_DIMENSION ** 2 }).metadata();
  } catch {
    throw new TypeError('File is not a valid image');
  }
  const format = IMAGE_FORMATS[metadata.format];
  if (!format) throw new TypeError('Only PNG, JPEG, WebP, and GIF images are supported');
  if (declaredMime !== format.mimeType) throw new TypeError(`Image content type must be ${format.mimeType}`);
  if (!metadata.width || !metadata.height
    || metadata.width > LEARN_IMAGE_MAX_DIMENSION
    || metadata.height > LEARN_IMAGE_MAX_DIMENSION) {
    throw new RangeError(`Image dimensions must not exceed ${LEARN_IMAGE_MAX_DIMENSION}×${LEARN_IMAGE_MAX_DIMENSION}`);
  }
  return { ...format, width: metadata.width, height: metadata.height };
}

export const validateLearnImage = validateLearnMedia;
