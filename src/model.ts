export type GuideKey = 'thirds' | 'center' | 'diagonal' | 'golden';
export type Phase = 'loading' | 'ready' | 'editing' | 'recovery' | 'error';
export type Ratio = 'free' | '1:1' | '4:5' | '16:9';
export type RecoveryReason = 'image-missing' | 'legacy-image-evicted';

/** 可持久化的图片元信息（体积小，随构图结构保存）。 */
export interface ImageRef {
  id: string;
  width: number;
  height: number;
  name: string;
}

/** 图片数据在本地存储中的容器，与构图结构分开管理。 */
export interface StoredImage {
  meta: ImageRef;
  src: string;
}

/** 运行时图片：在元信息之外附带 data URL；stored 表示该数据是否已落入本地存储。 */
export interface ImageAsset extends ImageRef {
  src: string;
  stored: boolean;
}

export interface CropVariant {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ratio: string;
  /** 是否已导出过；未导出的方案不允许被清理动作删除。 */
  exported: boolean;
}

export interface FrameDocument {
  version: 1;
  /** 图片元信息；图片数据本身单独存储，缺失时工作台进入 recovery 态。 */
  image: ImageRef | null;
  guides: Record<GuideKey, boolean>;
  subject: { x: number; y: number } | null;
  crop: CropVariant;
  variants: CropVariant[];
}

export interface ViewState {
  phase: Phase;
  document: FrameDocument;
  /** 当前会话可用的图片数据；结构在、图片缺失时为 null（recovery 态）。 */
  image: ImageAsset | null;
  recovery: RecoveryReason | null;
  compareOpen: boolean;
  notice: string;
  error: string | null;
  storage: StorageUsage | null;
  storageOpen: boolean;
  confirm: ConfirmRequest | null;
}

/** 一个 localStorage 条目的占用情况。 */
export interface StorageSegment {
  key: string;
  label: string;
  bytes: number;
  appOwned: boolean;
}

export interface StorageUsage {
  /** 本应用占用（构图结构 + 图片数据）。 */
  used: number;
  /** 浏览器本地存储的估算总容量。 */
  quota: number;
  /** 同一 localStorage 下的全部条目，含其他网站/扩展占用。 */
  segments: StorageSegment[];
  structureBytes: number;
  imageBytes: number;
  /** 同源其他数据占用，仅供提示，不提供清理。 */
  foreignBytes: number;
}

export type CleanupKind = 'image' | 'exported';

export interface ConfirmRequest {
  kind: CleanupKind;
  title: string;
  detail: string;
  bytesToFree: number;
}

export const DEFAULT_CROP: CropVariant = {
  id: 'current',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  ratio: 'free',
  exported: false,
};

export const EMPTY_DOCUMENT: FrameDocument = {
  version: 1,
  image: null,
  guides: { thirds: true, center: false, diagonal: false, golden: false },
  subject: null,
  crop: DEFAULT_CROP,
  variants: [],
};
