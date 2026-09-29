import { describe, expect, it } from 'vitest';
import { cropForRatio, isLegacyDocument, moveCrop, normalizeDocument, resizeCrop } from '../domain';
import { DEFAULT_CROP } from '../model';

describe('crop domain rules', () => {
  it('fits a 1:1 crop inside a wide image and centers it', () => {
    const crop = cropForRatio('1:1', 1.5, DEFAULT_CROP);
    expect(crop.width).toBeCloseTo(2 / 3);
    expect(crop.height).toBe(1);
    expect(crop.x).toBeCloseTo(1 / 6);
  });

  it('clamps movement to the image boundary', () => {
    const crop = moveCrop({ ...DEFAULT_CROP, width: 0.5, height: 0.5 }, 0.9, -0.9);
    expect(crop.x).toBe(0.5);
    expect(crop.y).toBe(0);
  });

  it('keeps a selected ratio while resizing', () => {
    const crop = resizeCrop({ ...DEFAULT_CROP, ratio: '16:9', width: 0.5, height: 0.28125 }, 0.8, 0.8);
    expect(crop.width).toBe(0.8);
    expect(crop.height).toBeCloseTo(0.45);
  });

  it('repairs partially damaged documents instead of dropping the composition', () => {
    const repaired = normalizeDocument({
      version: 1,
      image: { id: 'x', width: 10, height: 10, name: 'a.jpg' },
      // @ts-expect-error 故意给出残缺数据
      guides: undefined,
      subject: { x: 2, y: -1 },
      crop: { ...DEFAULT_CROP, width: 5 },
      variants: [
        // @ts-expect-error 旧版本方案没有 exported 字段
        { id: 'old', x: 0, y: 0, width: 0.5, height: 0.5, ratio: '1:1' },
      ],
    });
    expect(repaired.guides.thirds).toBe(true);
    expect(repaired.subject).toEqual({ x: 1, y: 0 });
    expect(repaired.crop.width).toBe(1);
    expect(repaired.variants[0].exported).toBe(false);
  });

  it('detects legacy documents with embedded image src', () => {
    expect(isLegacyDocument({ version: 1, image: { src: 'data:x' }, guides: {}, crop: DEFAULT_CROP, variants: [] })).toBe(true);
    expect(isLegacyDocument({ version: 1, image: { id: 'n', width: 1, height: 1, name: 'n' }, guides: {}, crop: DEFAULT_CROP, variants: [] })).toBe(false);
  });
});
