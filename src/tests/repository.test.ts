import { describe, expect, it } from 'vitest';
import { LocalFrameRepository } from '../repository';
import { DEFAULT_CROP, EMPTY_DOCUMENT, type FrameDocument, type ImageRef, type StoredImage } from '../model';
import { byteLength, IMAGE_KEY, STRUCTURE_KEY, StorageQuotaError, type StorageEntry, type StorageService } from '../service';

class MemoryStorage implements StorageService {
  values = new Map<string, string>();
  quota = Infinity;
  quotaKeys: string[] | null = null;

  read(key: string) { return this.values.has(key) ? this.values.get(key)! : null; }

  write(key: string, value: string) {
    if (this.quota !== Infinity) {
      const target = this.quotaKeys ?? [key];
      if (target.includes(key)) {
        const others = [...this.values.entries()].filter(([k]) => k !== key).reduce((sum, [k, v]) => sum + byteLength(k) + byteLength(v), 0);
        const current = this.values.has(key) ? byteLength(key) + byteLength(this.values.get(key)!) : 0;
        // 浏览器写入需要事务余量：即使是同 key 覆盖，旧值在提交前仍占位。
        const required = others + current + byteLength(key) + byteLength(value);
        if (required > this.quota) throw new StorageQuotaError();
      }
    }
    this.values.set(key, value);
  }

  remove(key: string) { this.values.delete(key); }

  stats() {
    const entries: StorageEntry[] = [...this.values.entries()].map(([key, value]) => ({
      key,
      label: key === STRUCTURE_KEY ? '构图方案与设置' : key === IMAGE_KEY ? '图片数据' : '其他',
      bytes: byteLength(key) + byteLength(value),
      appOwned: key.startsWith('framesense.'),
    }));
    return { entries, quota: 5 * 1024 * 1024 };
  }

  totalBytes() {
    let total = 0;
    for (const [key, value] of this.values) total += byteLength(key) + byteLength(value);
    return total;
  }
}

const meta: ImageRef = { id: 'img-1', width: 1200, height: 800, name: 'phone.jpg' };
const image: StoredImage = { meta, src: 'data:image/jpeg;base64,AAAA' };

function documentWithImage(): FrameDocument {
  return {
    ...structuredClone(EMPTY_DOCUMENT),
    image: { ...meta },
    subject: { x: 0.4, y: 0.6 },
    variants: [{ ...DEFAULT_CROP, id: 'variant-1', exported: true }],
  };
}

describe('LocalFrameRepository', () => {
  it('saves structure and image payload in separate keys', () => {
    const storage = new MemoryStorage();
    const repository = new LocalFrameRepository(storage);
    repository.save(documentWithImage(), image);

    expect(storage.values.has(STRUCTURE_KEY)).toBe(true);
    expect(storage.values.has(IMAGE_KEY)).toBe(true);
    const reloaded = repository.load();
    expect(reloaded.document.subject).toEqual({ x: 0.4, y: 0.6 });
    expect(reloaded.image?.src).toBe(image.src);
    expect(reloaded.recovery).toBeNull();
  });

  it('keeps the composition when the image exceeds quota and marks recovery on reload', () => {
    const storage = new MemoryStorage();
    const repository = new LocalFrameRepository(storage);
    // 结构可以写入，图片 key 一律拒绝。
    storage.quotaKeys = [IMAGE_KEY];
    storage.quota = 1;

    const result = repository.save(documentWithImage(), image);
    expect(result.structureSaved).toBe(true);
    expect(result.imageSaved).toBe(false);
    expect(storage.values.has(IMAGE_KEY)).toBe(false);

    // 结构完好无损：辅助线、裁切、主体、方案都在。
    const reloaded = repository.load();
    expect(reloaded.document.image).toEqual(meta);
    expect(reloaded.document.subject).toEqual({ x: 0.4, y: 0.6 });
    expect(reloaded.document.variants[0].id).toBe('variant-1');
    expect(reloaded.image).toBeNull();
    expect(reloaded.recovery).toBe('image-missing');
  });

  it('migrates the legacy embedded-image document into split keys', () => {
    const storage = new MemoryStorage();
    const legacy = { ...documentWithImage(), image: { ...meta, src: image.src } };
    storage.write(STRUCTURE_KEY, JSON.stringify(legacy));

    const reloaded = new LocalFrameRepository(storage).load();
    expect(reloaded.image?.src).toBe(image.src);
    expect(reloaded.recovery).toBeNull();
    const migratedDoc = JSON.parse(storage.read(STRUCTURE_KEY)!);
    expect(migratedDoc.image.src).toBeUndefined();
  });

  it('reports recovery when the legacy image cannot be migrated due to quota', () => {
    const storage = new MemoryStorage();
    storage.quotaKeys = [IMAGE_KEY];
    storage.quota = 1;
    const legacy = { ...documentWithImage(), image: { ...meta, src: image.src } };
    storage.write(STRUCTURE_KEY, JSON.stringify(legacy));

    const reloaded = new LocalFrameRepository(storage).load();
    expect(reloaded.document.image).toEqual(meta);
    expect(reloaded.image).toBeNull();
    expect(reloaded.recovery).toBe('legacy-image-evicted');
  });

  it('still writes the slim structure when the fat legacy document fills the quota', () => {
    const storage = new MemoryStorage();
    const fatSrc = 'data:image/jpeg;base64,' + 'Z'.repeat(800);
    const legacy = { ...documentWithImage(), image: { ...meta, src: fatSrc } };
    const fatBytes = byteLength(STRUCTURE_KEY) + byteLength(JSON.stringify(legacy));
    // 配额刚好容纳旧胖文档：直接覆盖瘦结构的写入会因旧值占住而失败，
    // 迁移逻辑必须先删除臃肿旧值，再写瘦结构。
    storage.quota = fatBytes;
    storage.write(STRUCTURE_KEY, JSON.stringify(legacy));

    const reloaded = new LocalFrameRepository(storage).load();
    expect(reloaded.recovery).toBe('legacy-image-evicted');
    expect(reloaded.document.image).toEqual(meta);
    expect(reloaded.document.subject).toEqual({ x: 0.4, y: 0.6 });
    // 瘦结构确实写回了存储，再次加载仍是同一份结构
    const again = new LocalFrameRepository(storage).load();
    expect(again.document.image).toEqual(meta);
    expect(again.recovery).toBe('image-missing');
  });

  it('falls back to a usable empty document for damaged data', () => {
    const storage = new MemoryStorage();
    storage.write(STRUCTURE_KEY, '{ damaged');
    const loaded = new LocalFrameRepository(storage).load();
    expect(loaded.document.version).toBe(1);
    expect(loaded.document.image).toBeNull();
    expect(loaded.document.variants).toEqual([]);
    expect(loaded.recovery).toBeNull();
  });

  it('discardImage only removes the image payload and keeps structure', () => {
    const storage = new MemoryStorage();
    const repository = new LocalFrameRepository(storage);
    repository.save(documentWithImage(), image);
    repository.discardImage();
    expect(storage.values.has(IMAGE_KEY)).toBe(false);
    const loaded = repository.load();
    expect(loaded.document.image).toEqual(meta);
    expect(loaded.recovery).toBe('image-missing');
  });

  it('pruneExportedVariants only removes exported variants', () => {
    const storage = new MemoryStorage();
    const repository = new LocalFrameRepository(storage);
    const document = documentWithImage();
    document.variants = [
      { ...DEFAULT_CROP, id: 'exported-1', exported: true },
      { ...DEFAULT_CROP, id: 'kept-1', exported: false },
      { ...DEFAULT_CROP, id: 'exported-2', exported: true },
    ];
    const kept = repository.pruneExportedVariants(document);
    expect(kept.map((variant) => variant.id)).toEqual(['kept-1']);
    const reloaded = repository.load();
    expect(reloaded.document.variants.map((variant) => variant.id)).toEqual(['kept-1']);
  });

  it('reports usage split by structure and image', () => {
    const storage = new MemoryStorage();
    storage.write('other-site.preference', 'x'.repeat(500));
    const repository = new LocalFrameRepository(storage);
    repository.save(documentWithImage(), image);
    const usage = repository.usage();
    expect(usage.structureBytes).toBeGreaterThan(0);
    expect(usage.imageBytes).toBeGreaterThan(0);
    expect(usage.used).toBe(usage.structureBytes + usage.imageBytes);
    expect(usage.foreignBytes).toBeGreaterThan(0);
  });
});
