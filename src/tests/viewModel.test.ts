import { beforeEach, describe, expect, it } from 'vitest';
import { FrameSenseViewModel } from '../viewModel';
import { DEFAULT_CROP, EMPTY_DOCUMENT, type FrameDocument, type ImageAsset, type StoredImage } from '../model';
import type { FrameRepository, LoadedState, SaveResult } from '../repository';
import type { ExportService, ImageService } from '../service';

class MemoryRepository implements FrameRepository {
  document: FrameDocument = structuredClone(EMPTY_DOCUMENT);
  image: StoredImage | null = null;
  recovery: LoadedState['recovery'] = null;
  failStructure = false;
  failImage = false;
  exported: Array<{ id: string }> = [];

  load(): LoadedState {
    return { document: structuredClone(this.document), image: this.image ? structuredClone(this.image) : null, recovery: this.recovery };
  }

  save(document: FrameDocument, image?: StoredImage | null): SaveResult {
    if (this.failStructure) throw new Error('no storage');
    this.document = structuredClone(document);
    if (image === undefined) return { structureSaved: true, imageSaved: !!this.image, migrated: false };
    if (image === null) {
      this.image = null;
      return { structureSaved: true, imageSaved: false, migrated: false };
    }
    if (this.failImage) {
      this.image = null;
      return { structureSaved: true, imageSaved: false, migrated: false };
    }
    this.image = structuredClone(image);
    return { structureSaved: true, imageSaved: true, migrated: false };
  }

  discardImage() { this.image = null; }

  pruneExportedVariants(document: FrameDocument) {
    const kept = document.variants.filter((variant) => !variant.exported);
    this.document = { ...this.document, variants: kept };
    return kept;
  }

  usage() {
    return {
      used: 100,
      quota: 5 * 1024 * 1024,
      segments: [],
      structureBytes: 60,
      imageBytes: this.image ? 40 : 0,
      foreignBytes: 0,
    };
  }
}

class FakeImageService implements ImageService {
  asset: ImageAsset = { id: 'img-1', src: 'data:image/svg+xml,test', width: 1200, height: 800, name: 'test.svg', stored: false };
  readFile() { return Promise.resolve({ ...this.asset, stored: false }); }
  demo() { return this.asset; }
  createId() { return 'img-1'; }
}

class FakeExportService implements ExportService {
  calls: Array<{ id: string }> = [];
  exportVariant(_image: ImageAsset, variant: { id: string }) { this.calls.push({ id: variant.id }); }
}

describe('FrameSenseViewModel', () => {
  let repository: MemoryRepository;
  let vm: FrameSenseViewModel;
  beforeEach(() => { repository = new MemoryRepository(); vm = new FrameSenseViewModel(repository, new FakeImageService(), new FakeExportService()); });

  it('initializes empty and loads a demo image', async () => {
    await vm.initialize();
    expect(vm.getSnapshot().phase).toBe('ready');
    vm.loadDemo();
    expect(vm.getSnapshot().image?.name).toBe('test.svg');
    expect(repository.document.image).not.toBeNull();
    expect(repository.image).not.toBeNull();
  });

  it('updates guides, subject, ratio, and variants', () => {
    vm.loadDemo();
    vm.toggleGuide('center');
    vm.markSubject(0.2, 0.8);
    vm.setRatio('1:1');
    vm.saveVariant();
    const state = vm.getSnapshot();
    expect(state.document.guides.center).toBe(true);
    expect(state.document.subject).toEqual({ x: 0.2, y: 0.8 });
    expect(state.document.crop.ratio).toBe('1:1');
    expect(state.document.variants).toHaveLength(1);
  });

  it('keeps edits in memory and reports persistence failure', () => {
    repository.failStructure = true;
    vm.loadDemo();
    expect(vm.getSnapshot().phase).toBe('error');
    expect(vm.getSnapshot().image).not.toBeNull();
    expect(vm.getSnapshot().error).toContain('本地保存失败');
  });

  it('degrades: saves composition without the image when image storage overflows', () => {
    repository.failImage = true;
    vm.loadDemo();
    const state = vm.getSnapshot();
    // 结构已经保存：方案元信息在仓库里
    expect(repository.document.image).toEqual({ id: 'img-1', width: 1200, height: 800, name: 'test.svg' });
    expect(repository.image).toBeNull();
    // 当前会话仍能继续编辑（内存里有图）
    expect(state.image?.src).toBeTruthy();
    expect(state.error).toContain('图片数据未能写入');
    // 本次编辑依然可用
    vm.toggleGuide('center');
    expect(vm.getSnapshot().document.guides.center).toBe(true);
  });

  it('enters recovery state when structure exists but image payload is missing', async () => {
    repository.document = { ...structuredClone(EMPTY_DOCUMENT), image: { id: 'img-9', width: 1000, height: 600, name: 'lost.jpg' } };
    repository.image = null;
    repository.recovery = 'image-missing';
    await vm.initialize();
    const state = vm.getSnapshot();
    expect(state.phase).toBe('recovery');
    expect(state.image).toBeNull();
    expect(state.document.image?.name).toBe('lost.jpg');
    expect(state.error).toContain('重新选择原图');
    // recovery 态下编辑动作一律忽略，不会产生“只有辅助线”的状态
    vm.toggleGuide('center');
    vm.setRatio('1:1');
    vm.saveVariant();
    expect(vm.getSnapshot().document.guides.center).toBe(false);
    expect(vm.getSnapshot().document.variants).toHaveLength(0);
  });

  it('restores the preserved composition after reselecting the original image', async () => {
    repository.document = {
      ...structuredClone(EMPTY_DOCUMENT),
      image: { id: 'img-old', width: 1200, height: 800, name: 'lost.jpg' },
      guides: { thirds: true, center: true, diagonal: false, golden: false },
      subject: { x: 0.3, y: 0.7 },
      crop: { ...DEFAULT_CROP, id: 'current', ratio: '1:1', width: 2 / 3 },
      variants: [{ ...DEFAULT_CROP, id: 'variant-1', exported: false }],
    };
    repository.recovery = 'image-missing';
    await vm.initialize();
    await vm.restoreImage(new File(['x'], 'lost.jpg', { type: 'image/jpeg' }));
    const state = vm.getSnapshot();
    expect(state.phase).toBe('editing');
    expect(state.image?.id).toBe('img-1');
    expect(state.document.guides.center).toBe(true);
    expect(state.document.subject).toEqual({ x: 0.3, y: 0.7 });
    expect(state.document.variants[0].id).toBe('variant-1');
    expect(state.error).toBeNull();
  });

  it('requires confirmation and only clears the image payload', () => {
    vm.loadDemo();
    vm.requestCleanup('image');
    expect(vm.getSnapshot().confirm?.kind).toBe('image');
    // 还没确认：图片仍在
    expect(repository.image).not.toBeNull();
    vm.confirmCleanup();
    expect(repository.image).toBeNull();
    expect(repository.document.image).not.toBeNull();
    // 本次会话仍可编辑（内存里有图），但已标记重开需重选
    const after = vm.getSnapshot();
    expect(after.phase).toBe('editing');
    expect(after.image?.src).toBeTruthy();
    expect(after.recovery).toBe('image-missing');
    expect(after.notice).toContain('重新打开页面后需要重新选择原图');

    // 重新初始化：进入恢复态
    repository.recovery = 'image-missing';
    void vm.initialize();
    expect(vm.getSnapshot().phase).toBe('recovery');
  });

  it('cleanup never removes unexported variants', () => {
    vm.loadDemo();
    vm.saveVariant();
    const variantId = vm.getSnapshot().document.variants[0].id;
    // 未导出：请求被忽略
    vm.requestCleanup('exported');
    expect(vm.getSnapshot().confirm).toBeNull();
    // 导出后才允许清理
    vm.exportVariant(variantId);
    expect(vm.getSnapshot().document.variants[0].exported).toBe(true);
    vm.requestCleanup('exported');
    expect(vm.getSnapshot().confirm).not.toBeNull();
    vm.confirmCleanup();
    // 该方案已导出，已被清理；未导出方案始终保留（此例全部已导出）
    expect(vm.getSnapshot().document.variants).toHaveLength(0);
  });

  it('preserves unexported variants while removing exported ones', () => {
    vm.loadDemo();
    vm.saveVariant();
    vm.saveVariant();
    const variants = vm.getSnapshot().document.variants;
    vm.exportVariant(variants[0].id);
    vm.requestCleanup('exported');
    vm.confirmCleanup();
    const remaining = vm.getSnapshot().document.variants;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].exported).toBe(false);
  });
});
