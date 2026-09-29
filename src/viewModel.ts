import { useState, useSyncExternalStore } from 'react';
import { cropForRatio, makeVariant, moveCrop, resizeCrop } from './domain';
import { EMPTY_DOCUMENT, type FrameDocument, type GuideKey, type Ratio, type ViewState } from './model';
import type { FrameRepository, StorageInfo } from './repository';
import type { ImageService } from './service';

type Listener = () => void;

export class FrameSenseViewModel {
  private state: ViewState = { phase: 'loading', document: structuredClone(EMPTY_DOCUMENT), compareOpen: false, notice: '', error: null, storageInfo: null, storageDialogOpen: false };
  private readonly listeners = new Set<Listener>();

  constructor(private readonly repository: FrameRepository, private readonly imageService: ImageService) {}

  getSnapshot = (): ViewState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private patch(next: Partial<ViewState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  private refreshStorageInfo(): void {
    try {
      const storageInfo: StorageInfo = this.repository.getStorageInfo();
      this.patch({ storageInfo });
    } catch {
      // Storage info is advisory; never block editing on it.
    }
  }

  private persist(document: FrameDocument, notice: string): void {
    const result = this.repository.save(document);
    if (!result.ok) {
      this.patch({ document, phase: 'error', error: result.error ?? '本地保存失败，但当前编辑仍保留在页面中。请检查浏览器存储权限。' });
      return;
    }
    const next: FrameDocument = result.imagePersisted ? document : { ...document, imageMissing: true };
    const fullNotice = result.imagePersisted
      ? notice
      : `${notice} 图片数据因浏览器容量限制未能保存，构图方案已保留；下次打开需重新选择原图。`;
    this.patch({ document: next, phase: 'editing', notice: fullNotice, error: null });
    this.refreshStorageInfo();
  }

  async initialize(): Promise<void> {
    this.patch({ phase: 'loading', notice: '正在恢复上次工作状态…', error: null });
    try {
      const document = this.repository.load();
      const storageInfo = this.repository.getStorageInfo();
      if (document.imageMissing) {
        this.patch({
          document,
          phase: 'ready',
          storageInfo,
          notice: `已恢复 ${document.variants.length} 个构图方案；图片数据未保存到本地，请重新选择原图。`,
        });
      } else if (document.image) {
        this.patch({ document, phase: 'editing', storageInfo, notice: '已恢复上次工作状态。' });
      } else {
        this.patch({ document, phase: 'ready', storageInfo, notice: '欢迎来到 FrameSense，先载入示例或导入图片。' });
      }
    } catch {
      this.patch({ phase: 'error', notice: '未能读取历史状态，可继续新建工作。', error: '本地数据读取失败。' });
    }
  }

  async importImage(file: File): Promise<void> {
    this.patch({ phase: 'loading', notice: '正在载入图片…', error: null });
    try {
      const image = await this.imageService.readFile(file);
      const document: FrameDocument = {
        ...this.state.document,
        image,
        imageMeta: { name: image.name, width: image.width, height: image.height },
        imageMissing: false,
      };
      this.persist(document, '图片已载入，构图方案已保留。');
    } catch (error) {
      this.patch({ phase: 'error', error: error instanceof Error ? error.message : '图片载入失败。' });
    }
  }

  loadDemo(): void {
    const image = this.imageService.demo();
    const document: FrameDocument = {
      ...this.state.document,
      image,
      imageMeta: { name: image.name, width: image.width, height: image.height },
      imageMissing: false,
    };
    this.persist(document, '示例图片已载入。');
  }

  toggleGuide(guide: GuideKey): void {
    const document = { ...this.state.document, guides: { ...this.state.document.guides, [guide]: !this.state.document.guides[guide] } };
    this.persist(document, '辅助层已更新。');
  }

  setRatio(ratio: Ratio): void {
    const image = this.state.document.image;
    if (!image) return;
    const crop = cropForRatio(ratio, image.width / image.height, this.state.document.crop);
    this.persist({ ...this.state.document, crop }, `${ratio === 'free' ? '自由' : ratio} 裁切已应用。`);
  }

  moveCrop(dx: number, dy: number): void {
    this.persist({ ...this.state.document, crop: moveCrop(this.state.document.crop, dx, dy) }, '裁切位置已调整。');
  }

  resizeCrop(width: number, height: number): void {
    this.persist({ ...this.state.document, crop: resizeCrop(this.state.document.crop, width, height) }, '裁切范围已调整。');
  }

  markSubject(x: number, y: number): void {
    this.persist({ ...this.state.document, subject: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } }, '主体标记已更新。');
  }

  saveVariant(): void {
    const id = `variant-${Date.now()}`;
    const variant = makeVariant(this.state.document.crop, id);
    const document = { ...this.state.document, variants: [...this.state.document.variants, variant].slice(-8) };
    this.persist(document, `已保存裁切方案 ${document.variants.length}。`);
  }

  selectVariant(id: string): void {
    const variant = this.state.document.variants.find((item) => item.id === id);
    if (!variant) return;
    this.persist({ ...this.state.document, crop: { ...variant, id: 'current' } }, '已切换到保存的裁切方案。');
  }

  toggleCompare(): void {
    this.patch({ compareOpen: !this.state.compareOpen });
  }

  openStorageDialog(): void {
    this.refreshStorageInfo();
    this.patch({ storageDialogOpen: true });
  }

  closeStorageDialog(): void {
    this.patch({ storageDialogOpen: false });
  }

  clearImageData(): void {
    this.repository.clearImage();
    const document: FrameDocument = { ...this.state.document, image: null, imageMissing: true };
    this.patch({ document, phase: 'ready', notice: '图片数据已清除，构图方案保留；重新选择图片即可恢复工作台。', error: null });
    this.refreshStorageInfo();
  }

  clearAllData(): void {
    this.repository.clearAll();
    this.patch({ document: structuredClone(EMPTY_DOCUMENT), phase: 'ready', compareOpen: false, notice: '本地数据已全部清除。', error: null, storageDialogOpen: false });
    this.refreshStorageInfo();
  }
}

export function useFrameSenseViewModel(repository: FrameRepository, imageService: ImageService): [FrameSenseViewModel, ViewState] {
  const [viewModel] = useState(() => new FrameSenseViewModel(repository, imageService));
  const state = useSyncExternalStore(viewModel.subscribe, viewModel.getSnapshot, viewModel.getSnapshot);
  return [viewModel, state];
}
