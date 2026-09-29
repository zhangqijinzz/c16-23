export type GuideKey = 'thirds' | 'center' | 'diagonal' | 'golden';
export type Phase = 'loading' | 'ready' | 'editing' | 'error';
export type Ratio = 'free' | '1:1' | '4:5' | '16:9';

export interface ImageMeta {
  name: string;
  width: number;
  height: number;
}

export interface ImageAsset extends ImageMeta {
  src: string;
}

export interface CropVariant {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ratio: string;
}

export interface FrameDocument {
  version: 1;
  /** Full image data in memory; null when the image could not be persisted. */
  image: ImageAsset | null;
  /** Image metadata is kept even when the image data itself was dropped. */
  imageMeta: ImageMeta | null;
  /** True when composition survived but the image data did not. */
  imageMissing: boolean;
  guides: Record<GuideKey, boolean>;
  subject: { x: number; y: number } | null;
  crop: CropVariant;
  variants: CropVariant[];
}

export interface StorageInfo {
  appUsed: number;
  documentSize: number;
  imageSize: number;
  totalUsed: number;
  quota: number;
  imagePresent: boolean;
  imageMissing: boolean;
  variantCount: number;
}

export interface ViewState {
  phase: Phase;
  document: FrameDocument;
  compareOpen: boolean;
  notice: string;
  error: string | null;
  storageInfo: StorageInfo | null;
  storageDialogOpen: boolean;
}

export const DEFAULT_CROP: CropVariant = {
  id: 'current',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  ratio: 'free',
};

export const EMPTY_DOCUMENT: FrameDocument = {
  version: 1,
  image: null,
  imageMeta: null,
  imageMissing: false,
  guides: { thirds: true, center: false, diagonal: false, golden: false },
  subject: null,
  crop: DEFAULT_CROP,
  variants: [],
};
