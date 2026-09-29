import { isFrameDocument, isImageAsset } from './domain';
import { EMPTY_DOCUMENT, type FrameDocument, type ImageMeta, type StorageInfo } from './model';
import { STORAGE_KEY_DOCUMENT, STORAGE_KEY_IMAGE, type StorageService } from './service';

/** Conservative localStorage quota estimate (most browsers allow ~5 MB). */
export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;

export interface SaveResult {
  ok: boolean;
  /** False when the image data had to be dropped; composition was still persisted. */
  imagePersisted: boolean;
  error?: string;
}

export type { StorageInfo };

export interface FrameRepository {
  load(): FrameDocument;
  save(document: FrameDocument): SaveResult;
  clearImage(): void;
  clearAll(): void;
  getStorageInfo(): StorageInfo;
}

function byteSize(value: string): number {
  return new Blob([value]).size;
}

interface PersistedComposition {
  version: 1;
  imageMeta: ImageMeta | null;
  imageMissing: boolean;
  guides: FrameDocument['guides'];
  subject: FrameDocument['subject'];
  crop: FrameDocument['crop'];
  variants: FrameDocument['variants'];
}

export class LocalFrameRepository implements FrameRepository {
  constructor(private readonly storage: StorageService) {}

  load(): FrameDocument {
    const document = structuredClone(EMPTY_DOCUMENT);
    const rawDocument = this.storage.read(STORAGE_KEY_DOCUMENT);
    if (rawDocument) {
      try {
        const parsed: unknown = JSON.parse(rawDocument);
        if (isFrameDocument(parsed)) {
          document.imageMeta = parsed.imageMeta ?? null;
          document.imageMissing = parsed.imageMissing === true;
          document.guides = parsed.guides;
          document.subject = parsed.subject ?? null;
          document.crop = parsed.crop;
          document.variants = parsed.variants;
        }
      } catch {
        // Damaged composition: fall through to empty document.
      }
    }

    const rawImage = this.storage.read(STORAGE_KEY_IMAGE);
    if (rawImage) {
      try {
        const parsed: unknown = JSON.parse(rawImage);
        if (isImageAsset(parsed)) {
          document.image = parsed;
          document.imageMeta = { name: parsed.name, width: parsed.width, height: parsed.height };
          document.imageMissing = false;
        }
      } catch {
        // Image data corrupt: treat as missing below.
      }
    }

    if (!document.image && document.imageMeta) {
      document.imageMissing = true;
    }
    return document;
  }

  save(document: FrameDocument): SaveResult {
    const composition: PersistedComposition = {
      version: 1,
      imageMeta: document.imageMeta,
      imageMissing: document.imageMissing,
      guides: document.guides,
      subject: document.subject,
      crop: document.crop,
      variants: document.variants,
    };

    // Priority 1: composition and settings always persist first.
    try {
      this.storage.write(STORAGE_KEY_DOCUMENT, JSON.stringify(composition));
    } catch {
      return { ok: false, imagePersisted: false, error: '构图方案写入浏览器存储失败，请清理存储空间后重试。' };
    }

    // Priority 2: image data is stored separately and may be dropped.
    if (document.image) {
      try {
        this.storage.write(STORAGE_KEY_IMAGE, JSON.stringify(document.image));
        return { ok: true, imagePersisted: true };
      } catch {
        // Quota exceeded: keep the composition and mark the image as missing.
        try {
          this.storage.write(STORAGE_KEY_DOCUMENT, JSON.stringify({ ...composition, imageMissing: true }));
        } catch {
          // Composition was already written above; nothing more we can do.
        }
        return { ok: true, imagePersisted: false };
      }
    }

    this.storage.remove(STORAGE_KEY_IMAGE);
    return { ok: true, imagePersisted: true };
  }

  clearImage(): void {
    this.storage.remove(STORAGE_KEY_IMAGE);
  }

  clearAll(): void {
    this.storage.remove(STORAGE_KEY_DOCUMENT);
    this.storage.remove(STORAGE_KEY_IMAGE);
  }

  getStorageInfo(): StorageInfo {
    const rawDocument = this.storage.read(STORAGE_KEY_DOCUMENT);
    const rawImage = this.storage.read(STORAGE_KEY_IMAGE);
    const documentSize = rawDocument ? byteSize(rawDocument) : 0;
    const imageSize = rawImage ? byteSize(rawImage) : 0;

    let totalUsed = 0;
    for (const key of this.storage.keys()) {
      totalUsed += byteSize(key) + byteSize(this.storage.read(key) ?? '');
    }

    const document = this.load();
    return {
      appUsed: documentSize + imageSize,
      documentSize,
      imageSize,
      totalUsed,
      quota: STORAGE_QUOTA_BYTES,
      imagePresent: !!rawImage,
      imageMissing: document.imageMissing,
      variantCount: document.variants.length,
    };
  }
}
