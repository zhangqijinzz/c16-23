import type { CropVariant, FrameDocument, ImageAsset, ImageMeta, Ratio } from './model';

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

export function normalizeCrop(crop: CropVariant): CropVariant {
  const width = clamp(crop.width, 0.12, 1);
  const height = clamp(crop.height, 0.12, 1);
  return {
    ...crop,
    x: clamp(crop.x, 0, 1 - width),
    y: clamp(crop.y, 0, 1 - height),
    width,
    height,
  };
}

export function cropForRatio(ratio: Ratio, imageRatio: number, current: CropVariant): CropVariant {
  if (ratio === 'free') return { ...current, ratio };
  const [w, h] = ratio.split(':').map(Number);
  const target = w / h;
  let width = 1;
  let height = 1;
  if (target > imageRatio) height = Math.min(1, imageRatio / target);
  else width = Math.min(1, target / imageRatio);
  return normalizeCrop({
    ...current,
    ratio,
    width,
    height,
    x: (1 - width) / 2,
    y: (1 - height) / 2,
  });
}

export function moveCrop(crop: CropVariant, dx: number, dy: number): CropVariant {
  return normalizeCrop({ ...crop, x: crop.x + dx, y: crop.y + dy });
}

export function resizeCrop(crop: CropVariant, width: number, height: number): CropVariant {
  const nextWidth = width;
  let nextHeight = height;
  if (crop.ratio !== 'free') {
    const [w, h] = crop.ratio.split(':').map(Number);
    nextHeight = nextWidth / (w / h);
  }
  return normalizeCrop({ ...crop, width: nextWidth, height: nextHeight });
}

export function makeVariant(crop: CropVariant, id: string): CropVariant {
  return { ...normalizeCrop(crop), id };
}

export function isImageMeta(value: unknown): value is ImageMeta {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ImageMeta>;
  return typeof candidate.name === 'string' && typeof candidate.width === 'number' && typeof candidate.height === 'number';
}

export function isImageAsset(value: unknown): value is ImageAsset {
  if (!isImageMeta(value)) return false;
  const candidate = value as Partial<ImageAsset>;
  return typeof candidate.src === 'string' && candidate.src.length > 0;
}

export function isFrameDocument(value: unknown): value is FrameDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FrameDocument>;
  if (candidate.version !== 1) return false;
  if (typeof candidate.guides !== 'object' || candidate.guides === null) return false;
  if (typeof candidate.crop !== 'object' || candidate.crop === null) return false;
  if (!Array.isArray(candidate.variants)) return false;
  if (candidate.imageMeta !== null && candidate.imageMeta !== undefined && !isImageMeta(candidate.imageMeta)) return false;
  return true;
}
