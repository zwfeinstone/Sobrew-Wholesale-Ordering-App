import { describe, expect, it } from 'vitest';
import { ImageUploadError, imageDimensions, prepareImageUpload } from '@/lib/image-upload';

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('image upload validation', () => {
  it('reads verified PNG dimensions', () => {
    expect(imageDimensions(pngHeader(640, 480), 'image/png')).toEqual({ width: 640, height: 480 });
  });

  it('rejects a type whose bytes are not a valid image', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'fake.png', { type: 'image/png' });
    await expect(prepareImageUpload(file)).rejects.toMatchObject({ code: 'image_invalid' } satisfies Partial<ImageUploadError>);
  });

  it('rejects dimensions beyond the configured bound', async () => {
    const file = new File([pngHeader(5000, 100)], 'wide.png', { type: 'image/png' });
    await expect(prepareImageUpload(file, { maxDimension: 4096 })).rejects.toMatchObject({ code: 'image_dimensions' } satisfies Partial<ImageUploadError>);
  });
});
