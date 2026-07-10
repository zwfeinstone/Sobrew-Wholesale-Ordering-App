const ALLOWED_IMAGE_TYPES: ReadonlyMap<string, 'jpg' | 'png' | 'webp'> = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
] as const);

export const IMAGE_UPLOAD_ACCEPT = '.jpg,.jpeg,.png,.webp';

export type PreparedImageUpload = {
  bytes: Uint8Array;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
  height: number;
  width: number;
};

export class ImageUploadError extends Error {
  constructor(public readonly code: 'image_dimensions' | 'image_invalid' | 'image_too_large') {
    super(code);
    this.name = 'ImageUploadError';
  }
}

function uint16BigEndian(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint16LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint24LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function uint32BigEndian(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function pngDimensions(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  return { width: uint32BigEndian(bytes, 16), height: uint32BigEndian(bytes, 20) };
}

function jpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;

  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 1 >= bytes.length) break;

    const segmentLength = uint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        height: uint16BigEndian(bytes, offset + 3),
        width: uint16BigEndian(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }

  return null;
}

function webpDimensions(bytes: Uint8Array) {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(bytes, 12, 4);

  if (chunk === 'VP8X') {
    return {
      width: uint24LittleEndian(bytes, 24) + 1,
      height: uint24LittleEndian(bytes, 27) + 1,
    };
  }

  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: uint16LittleEndian(bytes, 26) & 0x3fff,
      height: uint16LittleEndian(bytes, 28) & 0x3fff,
    };
  }

  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const byte1 = bytes[21];
    const byte2 = bytes[22];
    const byte3 = bytes[23];
    const byte4 = bytes[24];
    return {
      width: 1 + byte1 + ((byte2 & 0x3f) << 8),
      height: 1 + (byte2 >> 6) + (byte3 << 2) + ((byte4 & 0x0f) << 10),
    };
  }

  return null;
}

export function imageDimensions(bytes: Uint8Array, contentType: string) {
  if (contentType === 'image/png') return pngDimensions(bytes);
  if (contentType === 'image/jpeg') return jpegDimensions(bytes);
  if (contentType === 'image/webp') return webpDimensions(bytes);
  return null;
}

export async function prepareImageUpload(
  file: File,
  {
    maxBytes = 5 * 1024 * 1024,
    maxDimension = 4096,
    maxPixels = 16_000_000,
  }: { maxBytes?: number; maxDimension?: number; maxPixels?: number } = {}
): Promise<PreparedImageUpload> {
  const extension = ALLOWED_IMAGE_TYPES.get(file.type);
  if (!extension || file.size <= 0) throw new ImageUploadError('image_invalid');
  if (file.size > maxBytes) throw new ImageUploadError('image_too_large');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = imageDimensions(bytes, file.type);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new ImageUploadError('image_invalid');
  }
  if (
    dimensions.width > maxDimension
    || dimensions.height > maxDimension
    || dimensions.width * dimensions.height > maxPixels
  ) {
    throw new ImageUploadError('image_dimensions');
  }

  return {
    bytes,
    contentType: file.type as PreparedImageUpload['contentType'],
    extension,
    ...dimensions,
  };
}
