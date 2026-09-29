import { beforeEach, describe, expect, it } from 'vitest';
import { FrameSenseViewModel } from '../viewModel';
import { LocalFrameRepository, type FrameRepository, type SaveResult } from '../repository';
import { EMPTY_DOCUMENT, type FrameDocument, type ImageAsset } from '../model';
import type { ImageService, StorageService } from '../service';

class MemoryStorage implements StorageService {
  private store = new Map<string, string>();
  read(key: string) { return this.store.get(key) ?? null; }
  write(key: string, value: string) { this.store.set(key, value); }
  remove(key: string) { this.store.delete(key); }
  keys() { return [...this.store.keys()]; }
}

class QuotaStorage extends MemoryStorage {
  constructor(private readonly maxBytes: number) { super(); }
  write(key: string, value: string) {
    if (new Blob([value]).size > this.maxBytes) throw new Error('quota exceeded');
    super.write(key, value);
  }
}

class MemoryRepository implements FrameRepository {
  document: FrameDocument = structuredClone(EMPTY_DOCUMENT);
  fail = false;
  load() { return structuredClone(this.document); }
  save(document: FrameDocument): SaveResult {
    if (this.fail) return { ok: false, imagePersisted: false, error: '本地保存失败（模拟）' };
    this.document = structuredClone(document);
    return { ok: true, imagePersisted: true };
  }
  clearImage() { this.document.image = null; this.document.imageMissing = true; }
  clearAll() { this.document = structuredClone(EMPTY_DOCUMENT); }
  getStorageInfo() {
    return { appUsed: 0, documentSize: 0, imageSize: 0, totalUsed: 0, quota: 5 * 1024 * 1024, imagePresent: !!this.document.image, imageMissing: this.document.imageMissing, variantCount: this.document.variants.length };
  }
}

class FakeImageService implements ImageService {
  asset: ImageAsset = { src: `data:image/jpeg;base64,${'A'.repeat(20000)}`, width: 4032, height: 3024, name: 'test.jpg' };
  readFile() { return Promise.resolve(this.asset); }
  demo() { return this.asset; }
}

describe('FrameSenseViewModel', () => {
  let repository: MemoryRepository;
  let vm: FrameSenseViewModel;
  beforeEach(() => { repository = new MemoryRepository(); vm = new FrameSenseViewModel(repository, new FakeImageService()); });

  it('initializes empty and loads a demo image', async () => {
    await vm.initialize();
    expect(vm.getSnapshot().phase).toBe('ready');
    vm.loadDemo();
    expect(vm.getSnapshot().document.image?.name).toBe('test.jpg');
    expect(repository.document.image).not.toBeNull();
  });

  it('updates guides, subject, ratio, and variants', () => {
    vm.loadDemo();
    vm.toggleGuide('center');
    vm.markSubject(0.2, 0.8);
    vm.setRatio('1:1');
    vm.saveVariant();
    expect(vm.getSnapshot().document.guides.center).toBe(true);
    expect(vm.getSnapshot().document.subject).toEqual({ x: 0.2, y: 0.8 });
    expect(vm.getSnapshot().document.crop.ratio).toBe('1:1');
    expect(vm.getSnapshot().document.variants).toHaveLength(1);
  });

  it('keeps edits in memory and reports persistence failure', () => {
    repository.fail = true;
    vm.loadDemo();
    expect(vm.getSnapshot().phase).toBe('error');
    expect(vm.getSnapshot().document.image).not.toBeNull();
    expect(vm.getSnapshot().error).toContain('本地保存失败');
  });

  it('preserves composition when the image cannot be persisted, and recovers on reload', async () => {
    // Composition (~300 B) fits; the phone photo (~20 KB) does not.
    const limitedRepository = new LocalFrameRepository(new QuotaStorage(1000));
    const limitedVm = new FrameSenseViewModel(limitedRepository, new FakeImageService());
    await limitedVm.initialize();
    limitedVm.loadDemo();
    limitedVm.toggleGuide('golden');
    limitedVm.saveVariant();

    const state = limitedVm.getSnapshot();
    expect(state.document.image).not.toBeNull();
    expect(state.document.imageMissing).toBe(true);
    expect(state.document.variants).toHaveLength(1);
    expect(state.notice).toContain('容量限制');

    // Reopen: composition is restored, image is reported missing.
    const reloaded = new FrameSenseViewModel(limitedRepository, new FakeImageService());
    await reloaded.initialize();
    const reloadedState = reloaded.getSnapshot();
    expect(reloadedState.document.image).toBeNull();
    expect(reloadedState.document.imageMissing).toBe(true);
    expect(reloadedState.document.guides.golden).toBe(true);
    expect(reloadedState.document.variants).toHaveLength(1);
    expect(reloadedState.notice).toContain('重新选择原图');
  });

  it('clears only image data on request, keeping composition', () => {
    vm.loadDemo();
    vm.saveVariant();
    vm.clearImageData();
    const state = vm.getSnapshot();
    expect(state.document.image).toBeNull();
    expect(state.document.imageMissing).toBe(true);
    expect(state.document.variants).toHaveLength(1);
  });

  it('clears all data on request', () => {
    vm.loadDemo();
    vm.saveVariant();
    vm.clearAllData();
    const state = vm.getSnapshot();
    expect(state.document.image).toBeNull();
    expect(state.document.variants).toHaveLength(0);
    expect(state.document.imageMissing).toBe(false);
  });
});
