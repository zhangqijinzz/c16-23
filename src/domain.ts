import { DEFAULT_CROP, EMPTY_DOCUMENT, type CropVariant, type FrameDocument, type Ratio } from './model';

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

/** 旧版本数据里图片是内嵌在 document 中的（含 src）。 */
export function isLegacyDocument(value: unknown): boolean {
  if (!isFrameDocument(value)) return false;
  const image = value.image as unknown;
  return !!image && typeof image === 'object' && typeof (image as { src?: unknown }).src === 'string';
}

/** 基本结构校验；字段细节交给 normalizeDocument 补齐。 */
export function isFrameDocument(value: unknown): value is FrameDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FrameDocument>;
  return candidate.version === 1 && typeof candidate.guides === 'object' && candidate.crop !== undefined && Array.isArray(candidate.variants);
}

/** 把任何已通过结构校验的数据补齐为当前版本，避免半残状态。 */
export function normalizeDocument(value: FrameDocument): FrameDocument {
  const base = structuredClone(EMPTY_DOCUMENT);
  const guides = { ...base.guides, ...(value.guides ?? {}) };
  const image = normalizeImageRef(value.image);
  return {
    version: 1,
    image,
    guides,
    subject: typeof value.subject?.x === 'number' && typeof value.subject?.y === 'number'
      ? { x: clamp(value.subject.x), y: clamp(value.subject.y) }
      : null,
    crop: { ...DEFAULT_CROP, ...normalizeVariant(value.crop ?? DEFAULT_CROP, 'current') },
    variants: (value.variants ?? []).map((variant, index) => normalizeVariant(variant, variant.id || `variant-${index}`)),
  };
}

function normalizeVariant(variant: CropVariant, id: string): CropVariant {
  const normalized = normalizeCrop({
    id,
    x: typeof variant.x === 'number' ? variant.x : DEFAULT_CROP.x,
    y: typeof variant.y === 'number' ? variant.y : DEFAULT_CROP.y,
    width: typeof variant.width === 'number' ? variant.width : DEFAULT_CROP.width,
    height: typeof variant.height === 'number' ? variant.height : DEFAULT_CROP.height,
    ratio: typeof variant.ratio === 'string' ? variant.ratio : DEFAULT_CROP.ratio,
    exported: variant.exported === true,
  });
  return { ...normalized, id, exported: variant.exported === true };
}

function normalizeImageRef(image: FrameDocument['image']): FrameDocument['image'] {
  if (!image || typeof image !== 'object') return null;
  const candidate = image as { id?: unknown; width?: unknown; height?: unknown; name?: unknown };
  if (typeof candidate.width !== 'number' || typeof candidate.height !== 'number' || typeof candidate.name !== 'string') return null;
  return {
    id: typeof candidate.id === 'string' ? candidate.id : 'legacy-image',
    width: candidate.width,
    height: candidate.height,
    name: candidate.name,
  };
}
