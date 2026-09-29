import { isFrameDocument, isLegacyDocument, normalizeDocument } from './domain';
import { EMPTY_DOCUMENT, type CropVariant, type FrameDocument, type ImageRef, type StoredImage, type StorageUsage } from './model';
import { IMAGE_KEY, STRUCTURE_KEY, type StorageService } from './service';

export interface LoadedState {
  document: FrameDocument;
  /** 找到的图片数据；结构在但图片缺失时为 null。 */
  image: StoredImage | null;
  /** 图片缺失原因，供工作台说明“缺了什么”。 */
  recovery: 'image-missing' | 'legacy-image-evicted' | null;
}

export interface SaveResult {
  /** 结构（构图方案与设置）是否已写入。 */
  structureSaved: boolean;
  /** 图片数据是否已写入；false 表示图片已按优先级被舍弃。 */
  imageSaved: boolean;
  /** 本次写入过程中完成了旧数据迁移。 */
  migrated: boolean;
}

export interface FrameRepository {
  load(): LoadedState;
  /**
   * 优先保证结构落盘；图片超容量时自动降级，只丢弃图片数据。
   * image: 数据对象=写入；null=移除图片数据；undefined=保留图片 key 不动。
   */
  save(document: FrameDocument, image?: StoredImage | null): SaveResult;
  /** 丢弃图片数据，构图结构（含图片元信息）原样保留，重开后进入缺图恢复态。 */
  discardImage(): void;
  /** 只允许删除已导出的方案；未导出方案原样保留。 */
  pruneExportedVariants(document: FrameDocument): CropVariant[];
  usage(): StorageUsage;
}

export class LocalFrameRepository implements FrameRepository {
  constructor(private readonly storage: StorageService) {}

  load(): LoadedState {
    const raw = this.storage.read(STRUCTURE_KEY);
    if (!raw) return { document: structuredClone(EMPTY_DOCUMENT), image: null, recovery: null };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { document: structuredClone(EMPTY_DOCUMENT), image: null, recovery: null };
    }
    if (!isFrameDocument(parsed)) {
      return { document: structuredClone(EMPTY_DOCUMENT), image: null, recovery: null };
    }

    // 旧版本：图片内嵌在文档里。把图片数据迁到独立 key，文档只留元信息。
    if (isLegacyDocument(parsed)) {
      return this.migrateLegacy(parsed as FrameDocument & { image: ImageRef & { src: string } });
    }

    const document = normalizeDocument(parsed);
    if (!document.image) {
      this.storage.remove(IMAGE_KEY);
      return { document, image: null, recovery: null };
    }
    const stored = this.readImage(document.image);
    return {
      document,
      image: stored,
      recovery: stored ? null : 'image-missing',
    };
  }

  private migrateLegacy(legacy: FrameDocument & { image: ImageRef & { src: string } }): LoadedState {
    const { src, ...meta } = legacy.image;
    const document: FrameDocument = normalizeDocument({ ...legacy, image: meta });
    // 旧数据把大图内嵌在结构 key 里，可能已经占满容量。先直接覆盖瘦结构；
    // 若被臃肿旧值占住导致配额失败，删掉旧值后重试（数据已解析在内存，不会丢）。
    let structureSaved = this.tryWriteStructure(document);
    if (!structureSaved) {
      this.removeStructureSafely();
      structureSaved = this.tryWriteStructure(document);
    }
    let image: StoredImage | null = null;
    let recovery: LoadedState['recovery'] = 'legacy-image-evicted';
    try {
      this.storage.write(IMAGE_KEY, JSON.stringify({ id: meta.id, src } satisfies StoredImageEnvelope));
      image = { meta, src };
      recovery = null;
    } catch (error) {
      if ((error as Error)?.name === 'StorageQuotaError') {
        this.removeImageSafely();
        recovery = 'legacy-image-evicted';
      }
    }
    if (!structureSaved && recovery === null) recovery = 'legacy-image-evicted';
    return { document, image, recovery };
  }

  save(document: FrameDocument, image: StoredImage | null | undefined = undefined): SaveResult {
    // 先写体积小、优先级最高的结构。
    this.storage.write(STRUCTURE_KEY, JSON.stringify(document));

    if (image === undefined) {
      return { structureSaved: true, imageSaved: this.storage.read(IMAGE_KEY) !== null, migrated: false };
    }
    if (image === null) {
      this.removeImageSafely();
      return { structureSaved: true, imageSaved: false, migrated: false };
    }

    try {
      this.storage.write(IMAGE_KEY, JSON.stringify({ id: image.meta.id, src: image.src } satisfies StoredImageEnvelope));
      return { structureSaved: true, imageSaved: true, migrated: false };
    } catch (error) {
      if ((error as Error)?.name !== 'StorageQuotaError') throw error;
      // 明确的降级优先级：保结构与设置，丢弃图片数据。
      this.removeImageSafely();
      return { structureSaved: true, imageSaved: false, migrated: false };
    }
  }

  discardImage(): void {
    this.removeImageSafely();
  }

  pruneExportedVariants(document: FrameDocument): CropVariant[] {
    const kept = document.variants.filter((variant) => !variant.exported);
    this.storage.write(STRUCTURE_KEY, JSON.stringify({ ...document, variants: kept }));
    return kept;
  }

  usage(): StorageUsage {
    const { entries, quota } = this.storage.stats();
    let structureBytes = 0;
    let imageBytes = 0;
    let foreignBytes = 0;
    for (const entry of entries) {
      if (entry.key === STRUCTURE_KEY) structureBytes = entry.bytes;
      else if (entry.key === IMAGE_KEY) imageBytes = entry.bytes;
      else if (!entry.appOwned) foreignBytes += entry.bytes;
    }
    return {
      used: structureBytes + imageBytes,
      quota,
      segments: entries,
      structureBytes,
      imageBytes,
      foreignBytes,
    };
  }

  private readImage(ref: ImageRef): StoredImage | null {
    const raw = this.storage.read(IMAGE_KEY);
    if (!raw) return null;
    try {
      const envelope = JSON.parse(raw) as StoredImageEnvelope;
      if (typeof envelope?.src !== 'string' || envelope.id !== ref.id) return null;
      return { meta: ref, src: envelope.src };
    } catch {
      return null;
    }
  }

  private removeImageSafely(): void {
    try {
      this.storage.remove(IMAGE_KEY);
    } catch {
      // 删除一般不会失败；即便失败也不影响结构保存。
    }
  }

  private removeStructureSafely(): void {
    try {
      this.storage.remove(STRUCTURE_KEY);
    } catch {
      // 删除失败时保留旧值，交由后续保存流程再试。
    }
  }

  private tryWriteStructure(document: FrameDocument): boolean {
    try {
      this.storage.write(STRUCTURE_KEY, JSON.stringify(document));
      return true;
    } catch (error) {
      if ((error as Error)?.name === 'StorageQuotaError') return false;
      throw error;
    }
  }
}

interface StoredImageEnvelope {
  id: string;
  src: string;
}
