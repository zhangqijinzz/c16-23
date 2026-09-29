import type { CropVariant, ImageAsset } from './model';

/** 构图结构（辅助线、裁切、主体、方案、图片元信息）——优先保住的部分。 */
export const STRUCTURE_KEY = 'framesense.document.v1';
/** 图片数据（data URL）——容量不足时可独立丢弃。 */
export const IMAGE_KEY = 'framesense.image.v1';
/** 旧版本把结构与图片写在同一个 key 里，首次加载时识别并迁移。 */
// LEGACY_SCHEMA 的标识位置就是 STRUCTURE_KEY（image 字段内嵌 src）。
/** localStorage 容量无法探测时使用的保守估算。 */
export const ASSUMED_QUOTA = 5 * 1024 * 1024;

/** 计算字符串写入 localStorage 后占用的近似字节数（UTF-8）。 */
export function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  let bytes = value.length;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0xffff) bytes += 3;
    else if (code > 0x7f) bytes += 1;
  }
  return bytes;
}

/** 浏览器在写入超出配额时抛出的错误（不同浏览器文案不一，用 code 判断最稳）。 */
export class StorageQuotaError extends Error {
  constructor() {
    super('本地存储空间不足');
    this.name = 'StorageQuotaError';
  }
}

export function isQuotaError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014;
  return error instanceof StorageQuotaError;
}

export interface StorageEntry {
  key: string;
  label: string;
  bytes: number;
  appOwned: boolean;
}

export interface StorageService {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
  /** 列出同一 localStorage 下全部条目及占用，quota 取不到时给保守估算。 */
  stats(): { entries: StorageEntry[]; quota: number };
}

export class BrowserStorageService implements StorageService {
  read(key: string): string | null {
    return window.localStorage.getItem(key);
  }

  write(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      if (isQuotaError(error)) throw new StorageQuotaError();
      throw error;
    }
  }

  remove(key: string): void {
    window.localStorage.removeItem(key);
  }

  stats(): { entries: StorageEntry[]; quota: number } {
    const store = window.localStorage;
    const entries: StorageEntry[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key) continue;
      const value = store.getItem(key) ?? '';
      entries.push({ key, bytes: byteLength(key) + byteLength(value), appOwned: key.startsWith('framesense.'), label: labelFor(key) });
    }
    return { entries, quota: ASSUMED_QUOTA };
  }
}

function labelFor(key: string): string {
  if (key === STRUCTURE_KEY) return '构图方案与设置';
  if (key === IMAGE_KEY) return '图片数据';
  if (key.startsWith('framesense.')) return 'FrameSense 其他数据';
  return '其他网页/扩展的数据';
}

export interface ImageService {
  readFile(file: File): Promise<ImageAsset>;
  demo(): ImageAsset;
  createId(): string;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class BrowserImageService implements ImageService {
  readFile(file: File): Promise<ImageAsset> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败，请换一张图片重试。'));
      reader.onload = () => {
        const src = typeof reader.result === 'string' ? reader.result : '';
        const image = new Image();
        image.onerror = () => reject(new Error('图片格式无法识别。'));
        image.onload = () => resolve({ id: randomId(), src, width: image.naturalWidth, height: image.naturalHeight, name: file.name, stored: false });
        image.src = src;
      };
      reader.readAsDataURL(file);
    });
  }

  createId(): string {
    return randomId();
  }

  demo(): ImageAsset {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#f9c86b"/><stop offset=".56" stop-color="#e88965"/><stop offset="1" stop-color="#39485f"/></linearGradient></defs><rect width="1200" height="800" fill="url(#sky)"/><circle cx="820" cy="260" r="115" fill="#ffe4a1" opacity=".9"/><path d="M0 650 260 430l180 110 190-250 420 360 150-90v240H0Z" fill="#233344"/><path d="M0 715 230 560l145 72 238-178 280 230 140-95 167 126H0Z" fill="#15232e" opacity=".9"/><text x="70" y="120" fill="#fff4dd" font-family="sans-serif" font-size="34" letter-spacing="8">FRAME STUDY 01</text></svg>`;
    return { id: 'demo-frame-study-01', src: `data:image/svg+xml,${encodeURIComponent(svg)}`, width: 1200, height: 800, name: 'FrameSense 示例风景.svg', stored: false };
  }
}

/** 把当前裁切窗口渲染成 PNG 并触发下载，标记方案“已导出”。 */
export interface ExportService {
  exportVariant(image: ImageAsset, variant: CropVariant, index: number): void;
}

export class BrowserExportService implements ExportService {
  exportVariant(image: ImageAsset, variant: CropVariant, index: number): void {
    const canvas = document.createElement('canvas');
    const sx = Math.round(variant.x * image.width);
    const sy = Math.round(variant.y * image.height);
    const sw = Math.round(variant.width * image.width);
    const sh = Math.round(variant.height * image.height);
    canvas.width = sw;
    canvas.height = sh;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持导出图片。');
    const element = new Image();
    element.src = image.src;
    context.drawImage(element, sx, sy, sw, sh, 0, 0, sw, sh);
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    const base = image.name.replace(/\.[^.]+$/, '') || 'framesense';
    link.href = url;
    link.download = `${base}-方案${String(index + 1).padStart(2, '0')}.png`;
    link.click();
  }
}
