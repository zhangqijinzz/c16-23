import { describe, expect, it } from 'vitest';
import { LocalFrameRepository } from '../repository';
import { EMPTY_DOCUMENT, type FrameDocument } from '../model';
import type { StorageService } from '../service';

class MemoryStorage implements StorageService {
  private store = new Map<string, string>();
  read(key: string) { return this.store.get(key) ?? null; }
  write(key: string, value: string) { this.store.set(key, value); }
  remove(key: string) { this.store.delete(key); }
  keys() { return [...this.store.keys()]; }
}

/** Storage that throws once a single key's value exceeds the given byte budget. */
class QuotaStorage extends MemoryStorage {
  constructor(private readonly maxBytes: number) { super(); }
  write(key: string, value: string) {
    if (new Blob([value]).size > this.maxBytes) throw new Error('quota exceeded');
    super.write(key, value);
  }
}

function documentWithImage(overrides: Partial<FrameDocument> = {}): FrameDocument {
  return {
    ...structuredClone(EMPTY_DOCUMENT),
    image: { src: `data:image/jpeg;base64,${'A'.repeat(20000)}`, width: 4032, height: 3024, name: 'photo.jpg' },
    imageMeta: { name: 'photo.jpg', width: 4032, height: 3024 },
    ...overrides,
  };
}

describe('LocalFrameRepository', () => {
  it('splits composition and image data into separate keys', () => {
    const storage = new MemoryStorage();
    const repository = new LocalFrameRepository(storage);
    repository.save(documentWithImage());

    const rawDocument = storage.read('framesense.document.v1');
    const rawImage = storage.read('framesense.image.v1');
    expect(rawDocument).not.toBeNull();
    expect(rawImage).not.toBeNull();
    expect(rawDocument).not.toContain('data:image/jpeg');
    expect(rawImage).toContain('data:image/jpeg');
  });

  it('reloads the composition without image data when the image key is absent', () => {
    const storage = new MemoryStorage();
    const repository = new LocalFrameRepository(storage);
    const document = documentWithImage({ subject: { x: 0.4, y: 0.6 }, guides: { thirds: true, center: true, diagonal: false, golden: false } });
    repository.save(document);
    storage.remove('framesense.image.v1');

    const reloaded = repository.load();
    expect(reloaded.image).toBeNull();
    expect(reloaded.imageMissing).toBe(true);
    expect(reloaded.imageMeta).toEqual({ name: 'photo.jpg', width: 4032, height: 3024 });
    expect(reloaded.subject).toEqual({ x: 0.4, y: 0.6 });
    expect(reloaded.guides.center).toBe(true);
  });

  it('degrades gracefully when the image exceeds quota: composition survives', () => {
    // Composition (~300 B) fits; the phone photo (~20 KB) does not.
    const storage = new QuotaStorage(1000);
    const repository = new LocalFrameRepository(storage);
    const document = documentWithImage({ variants: [{ id: 'v1', x: 0.1, y: 0.1, width: 0.5, height: 0.5, ratio: 'free' }] });

    const result = repository.save(document);
    expect(result.ok).toBe(true);
    expect(result.imagePersisted).toBe(false);

    const reloaded = repository.load();
    expect(reloaded.image).toBeNull();
    expect(reloaded.imageMissing).toBe(true);
    expect(reloaded.variants).toHaveLength(1);
    expect(reloaded.variants[0].id).toBe('v1');
  });

  it('restores the image when it fits within quota', () => {
    const storage = new QuotaStorage(5_000_000);
    const repository = new LocalFrameRepository(storage);
    repository.save(documentWithImage());

    const reloaded = repository.load();
    expect(reloaded.image?.src).toContain('data:image/jpeg');
    expect(reloaded.imageMissing).toBe(false);
  });

  it('falls back to a usable empty document for damaged composition data', () => {
    const storage = new MemoryStorage();
    storage.write('framesense.document.v1', '{ damaged');
    const document = new LocalFrameRepository(storage).load();
    expect(document.version).toBe(1);
    expect(document.image).toBeNull();
    expect(document.variants).toEqual([]);
  });

  it('clears image data only, or all data, on demand', () => {
    const storage = new MemoryStorage();
    const repository = new LocalFrameRepository(storage);
    repository.save(documentWithImage());

    repository.clearImage();
    expect(storage.read('framesense.image.v1')).toBeNull();
    expect(storage.read('framesense.document.v1')).not.toBeNull();

    repository.clearAll();
    expect(storage.read('framesense.image.v1')).toBeNull();
    expect(storage.read('framesense.document.v1')).toBeNull();
  });

  it('reports storage usage split between composition and image', () => {
    const storage = new MemoryStorage();
    const repository = new LocalFrameRepository(storage);
    repository.save(documentWithImage());

    const info = repository.getStorageInfo();
    expect(info.imagePresent).toBe(true);
    expect(info.imageSize).toBeGreaterThan(0);
    expect(info.documentSize).toBeGreaterThan(0);
    expect(info.appUsed).toBe(info.documentSize + info.imageSize);
    expect(info.quota).toBeGreaterThan(0);
  });
});
