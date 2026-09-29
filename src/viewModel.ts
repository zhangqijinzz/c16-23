import { useState, useSyncExternalStore } from 'react';
import { cropForRatio, makeVariant, moveCrop, resizeCrop } from './domain';
import {
  EMPTY_DOCUMENT,
  type CleanupKind,
  type ConfirmRequest,
  type FrameDocument,
  type GuideKey,
  type ImageAsset,
  type Ratio,
  type StorageUsage,
  type ViewState,
} from './model';
import type { FrameRepository } from './repository';
import type { ExportService, ImageService } from './service';

type Listener = () => void;

export class FrameSenseViewModel {
  private state: ViewState = {
    phase: 'loading',
    document: structuredClone(EMPTY_DOCUMENT),
    image: null,
    recovery: null,
    compareOpen: false,
    notice: '',
    error: null,
    storage: null,
    storageOpen: false,
    confirm: null,
  };
  private readonly listeners = new Set<Listener>();
  private variantSeq = 0;

  constructor(
    private readonly repository: FrameRepository,
    private readonly imageService: ImageService,
    private readonly exportService: ExportService,
  ) {}

  getSnapshot = (): ViewState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private patch(next: Partial<ViewState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  private refreshUsage(): StorageUsage {
    const storage = this.repository.usage();
    this.patch({ storage });
    return storage;
  }

  /**
   * 持久化的统一入口。
   * 结构始终先保存；图片数据按降级策略处理：
   * - 新图片/被丢弃过的图片会再尝试写一次；
   * - 写不进就只保结构，图片留存在本次会话内存里，并提示重开需重选。
   */
  private persist(document: FrameDocument, notice: string, imageOverride?: ImageAsset | null): void {
    const image = imageOverride === undefined ? this.state.image : imageOverride;
    const wantsImageWrite = !!image && !image.stored;

    const storedImage = image
      ? { meta: { id: image.id, width: image.width, height: image.height, name: image.name }, src: image.src }
      : null;

    try {
      const result = this.repository.save(document, wantsImageWrite ? storedImage : undefined);
      const nextImage = image ? { ...image, stored: image.stored || result.imageSaved } : null;
      const recovery = document.image && !nextImage?.stored ? ('image-missing' as const) : null;
      const phase: ViewState['phase'] = document.image ? 'editing' : 'ready';
      const warning =
        document.image && !result.imageSaved && wantsImageWrite
          ? '存储空间不足：构图方案与设置已保存，但图片数据未能写入。本次操作仍可继续，重新打开页面后请重新选择原图。'
          : '';
      this.patch({
        document,
        image: nextImage,
        recovery,
        phase,
        notice,
        error: warning || null,
      });
      this.refreshUsage();
    } catch {
      // 连结构都写不进（如存储被禁用）：编辑保留在内存中，绝不丢用户的调整。
      this.patch({
        document,
        image,
        phase: 'error',
        notice,
        error: '本地保存失败，但当前调整仍保留在页面中。可在“存储”中清理空间后重试，或先导出方案备份。',
      });
    }
  }

  async initialize(): Promise<void> {
    this.patch({ phase: 'loading', notice: '正在恢复上次工作状态…', error: null });
    try {
      const { document, image, recovery } = this.repository.load();
      const runtimeImage: ImageAsset | null = image
        ? { ...image.meta, src: image.src, stored: true }
        : null;

      if (document.image && recovery) {
        const legacy = recovery === 'legacy-image-evicted';
        this.patch({
          document,
          image: null,
          recovery,
          phase: 'recovery',
          notice: '',
          error: legacy
            ? '已保留构图方案与设置。升级存储结构时原图数据超出容量，未能搬迁，请重新选择原图。'
            : '已保留构图方案与设置，但原图数据缺失，请重新选择原图。',
        });
      } else {
        this.patch({
          document,
          image: runtimeImage,
          recovery: null,
          phase: document.image ? 'editing' : 'ready',
          notice: document.image ? '已恢复上次工作状态' : '欢迎来到 FrameSense，先载入示例或导入图片。',
          error: null,
        });
      }
      this.refreshUsage();
    } catch {
      this.patch({ phase: 'error', notice: '未能读取历史状态，可继续新建工作。', error: '本地数据读取失败。' });
    }
  }

  /** 导入新图片：开始一套全新构图（旧结构已保存，不影响历史）。 */
  async importImage(file: File): Promise<void> {
    this.patch({ phase: 'loading', notice: '正在载入图片…', error: null });
    try {
      const image = await this.imageService.readFile(file);
      const document: FrameDocument = { ...structuredClone(EMPTY_DOCUMENT), image: { id: image.id, width: image.width, height: image.height, name: image.name } };
      this.persist(document, '图片已载入，可以开始构图。', image);
    } catch (error) {
      this.patch({ phase: 'error', error: error instanceof Error ? error.message : '图片载入失败。' });
    }
  }

  /** 缺图恢复：用重新选择的原图接回已保留的构图结构。 */
  async restoreImage(file: File): Promise<void> {
    const preserved = this.state.document;
    const preservedImage = preserved.image;
    if (!preservedImage) return;
    this.patch({ phase: 'loading', notice: '正在接回原图…', error: null });
    try {
      const image = await this.imageService.readFile(file);
      const mismatch = image.width !== preservedImage.width || image.height !== preservedImage.height;
      const document: FrameDocument = {
        ...preserved,
        image: { id: image.id, width: image.width, height: image.height, name: image.name },
      };
      this.persist(document, mismatch ? '原图已接回，构图方案已恢复。注意：所选图片尺寸与原图不同，裁切位置可能需要微调。' : '原图已接回，构图方案已完整恢复。', image);
    } catch (error) {
      this.patch({ phase: 'recovery', error: error instanceof Error ? error.message : '图片载入失败。' });
    }
  }

  loadDemo(): void {
    const image = this.imageService.demo();
    const document: FrameDocument = {
      ...structuredClone(EMPTY_DOCUMENT),
      image: { id: image.id, width: image.width, height: image.height, name: image.name },
    };
    this.persist(document, '示例图片已载入。', image);
  }

  /** 缺图状态下构图编辑不可用（避免只看到辅助线没有画面）。 */
  private canEdit(): boolean {
    return !!this.state.image && this.state.phase !== 'recovery';
  }

  toggleGuide(guide: GuideKey): void {
    if (!this.canEdit()) return;
    const document = { ...this.state.document, guides: { ...this.state.document.guides, [guide]: !this.state.document.guides[guide] } };
    this.persist(document, '辅助层已更新。');
  }

  setRatio(ratio: Ratio): void {
    const image = this.state.image;
    if (!image || !this.canEdit()) return;
    const crop = cropForRatio(ratio, image.width / image.height, this.state.document.crop);
    this.persist({ ...this.state.document, crop }, `${ratio === 'free' ? '自由' : ratio} 裁切已应用。`);
  }

  moveCrop(dx: number, dy: number): void {
    if (!this.canEdit()) return;
    this.persist({ ...this.state.document, crop: moveCrop(this.state.document.crop, dx, dy) }, '裁切位置已调整。');
  }

  resizeCrop(width: number, height: number): void {
    if (!this.canEdit()) return;
    this.persist({ ...this.state.document, crop: resizeCrop(this.state.document.crop, width, height) }, '裁切范围已调整。');
  }

  markSubject(x: number, y: number): void {
    if (!this.canEdit()) return;
    this.persist({ ...this.state.document, subject: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } }, '主体标记已更新。');
  }

  saveVariant(): void {
    if (!this.canEdit()) return;
    this.variantSeq += 1;
    const id = `variant-${Date.now()}-${this.variantSeq}`;
    const variant = makeVariant({ ...this.state.document.crop, exported: false }, id);
    const document = { ...this.state.document, variants: [...this.state.document.variants, variant].slice(-8) };
    this.persist(document, `已保存裁切方案 ${document.variants.length}。导出后该方案才允许被清理。`);
  }

  selectVariant(id: string): void {
    if (!this.canEdit()) return;
    const variant = this.state.document.variants.find((item) => item.id === id);
    if (!variant) return;
    this.persist({ ...this.state.document, crop: { ...variant, id: 'current' } }, '已切换到保存的裁切方案。');
  }

  exportVariant(id: string): void {
    const image = this.state.image;
    if (!image || !this.canEdit()) return;
    const index = this.state.document.variants.findIndex((item) => item.id === id);
    if (index < 0) return;
    const target = this.state.document.variants[index];
    this.exportService.exportVariant(image, target, index);
    const variants = this.state.document.variants.map((item) => (item.id === id ? { ...item, exported: true } : item));
    const crop = this.state.document.crop.id === id ? { ...this.state.document.crop, exported: true } : this.state.document.crop;
    this.persist({ ...this.state.document, variants, crop }, `方案 ${String(index + 1).padStart(2, '0')} 已导出 PNG。`);
  }

  toggleCompare(): void {
    if (!this.state.image && !this.state.compareOpen) return;
    this.patch({ compareOpen: !this.state.compareOpen });
  }

  // —— 存储占用与清理 ——

  openStorage(): void {
    const storage = this.repository.usage();
    this.patch({ storageOpen: true, storage });
  }

  closeStorage(): void {
    this.patch({ storageOpen: false, confirm: null });
  }

  /** 弹出二次确认；真正的删除只发生在 confirmCleanup 之后。 */
  requestCleanup(kind: CleanupKind): void {
    const storage = this.repository.usage();
    const exportedCount = this.state.document.variants.filter((variant) => variant.exported).length;
    let confirm: ConfirmRequest | null = null;
    if (kind === 'image') {
      if (!storage.imageBytes) return;
      confirm = {
        kind: 'image',
        title: '清理图片数据？',
        detail: '将删除已缓存的原图数据，构图方案、辅助层和设置全部保留。当前页面仍可继续编辑；重新打开页面后需要重新选择原图。',
        bytesToFree: storage.imageBytes,
      };
    } else {
      if (exportedCount === 0) return;
      confirm = {
        kind: 'exported',
        title: `清理 ${exportedCount} 个已导出方案？`,
        detail: '只会删除已经导出过 PNG 的方案。未导出的方案不受影响，仍会保留。',
        bytesToFree: 0,
      };
    }
    this.patch({ storage, confirm });
  }

  cancelCleanup(): void {
    this.patch({ confirm: null });
  }

  confirmCleanup(): void {
    const request = this.state.confirm;
    if (!request) return;
    if (request.kind === 'image') {
      // 只删图片数据；元信息随结构保留。本次会话仍可用内存中的图片继续编辑，
      // 重新打开页面后才进入缺图恢复态。
      this.repository.discardImage();
      const nextImage = this.state.image ? { ...this.state.image, stored: false } : null;
      this.patch({
        image: nextImage,
        recovery: this.state.document.image ? 'image-missing' : null,
        phase: this.state.document.image ? 'editing' : this.state.phase,
        compareOpen: false,
        confirm: null,
        notice: '图片数据已清理，构图方案与设置完好。本次仍可继续编辑；重新打开页面后需要重新选择原图。',
        error: null,
      });
    } else {
      const kept = this.repository.pruneExportedVariants(this.state.document);
      this.patch({
        document: { ...this.state.document, variants: kept },
        confirm: null,
        notice: `已清理已导出的方案，保留 ${kept.length} 个未导出方案。`,
        error: null,
      });
    }
    this.refreshUsage();
  }
}

export function useFrameSenseViewModel(
  repository: FrameRepository,
  imageService: ImageService,
  exportService: ExportService,
): [FrameSenseViewModel, ViewState] {
  const [viewModel] = useState(() => new FrameSenseViewModel(repository, imageService, exportService));
  const state = useSyncExternalStore(viewModel.subscribe, viewModel.getSnapshot, viewModel.getSnapshot);
  return [viewModel, state];
}
