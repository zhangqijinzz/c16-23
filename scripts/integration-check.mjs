import { JSDOM } from 'jsdom';
import { LocalFrameRepository } from './src/repository';
import { BrowserStorageService } from './src/service';
import { DEFAULT_CROP, EMPTY_DOCUMENT } from './src/model';

const dom = new JSDOM('<!doctype html><html></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;

// 用一个带小配额的 localStorage 垫片模拟手机端浏览器
class TinyStorage {
  map = new Map();
  constructor(limit = 1800) { this.limit = limit; }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    const others = [...this.map].filter(([key]) => key !== k).reduce((sum, [key, val]) => sum + key.length + val.length, 0);
    if (others + k.length + String(v).length > this.limit) {
      throw new DOMException('quota', 'QuotaExceededError');
    }
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
}
const tiny = new TinyStorage();
Object.defineProperty(dom.window, 'localStorage', { value: tiny, configurable: true });
globalThis.localStorage = tiny;
globalThis.DOMException = dom.window.DOMException;

const storage = new BrowserStorageService();
const repo = new LocalFrameRepository(storage);

// 1) 保存一份带丰富构图结构的数据
const doc = {
  ...structuredClone(EMPTY_DOCUMENT),
  image: { id: 'big-phone-photo', width: 4032, height: 3024, name: 'IMG_0423.HEIC.jpg' },
  guides: { thirds: true, center: true, diagonal: true, golden: false },
  subject: { x: 0.31, y: 0.44 },
  crop: { ...DEFAULT_CROP, id: 'current', ratio: '4:5', width: 0.75, height: 0.9 },
  variants: [
    { ...DEFAULT_CROP, id: 'v-1', exported: false, ratio: '4:5' },
    { ...DEFAULT_CROP, id: 'v-2', exported: true, ratio: '1:1' },
  ],
};

// 2) 手机原图：一个明显超过配额的 data URL
const bigSrc = 'data:image/jpeg;base64,' + 'A'.repeat(3000);

const result = repo.save(doc, { meta: doc.image, src: bigSrc });
console.log('save =>', { structureSaved: result.structureSaved, imageSaved: result.imageSaved });
if (result.imageSaved) throw new Error('应当因配额降级');

// 3) 结构必须完好
const keys = [...dom.window.localStorage.map.keys()];
console.log('keys after overflow =>', keys);
if (keys.includes('framesense.image.v1')) throw new Error('图片 key 必须已移除');

// 4) 重新打开：恢复态、结构齐全
const reopened = repo.load();
console.log('reopen =>', {
  recovery: reopened.recovery,
  imageName: reopened.document.image?.name,
  imageSize: `${reopened.document.image?.width}x${reopened.document.image?.height}`,
  guides: reopened.document.guides,
  subject: reopened.document.subject,
  variants: reopened.document.variants.map(v => `${v.id}:${v.exported ? '已导出' : '未导出'}`),
  imagePayload: reopened.image,
});
if (reopened.recovery !== 'image-missing') throw new Error('应当进入 image-missing 恢复态');
if (reopened.image) throw new Error('图片数据不应存在');
if (reopened.document.variants.length !== 2) throw new Error('方案必须保留');

// 5) 清理已导出方案，未导出的要留下
const kept = repo.pruneExportedVariants(reopened.document);
console.log('after prune =>', kept.map(v => v.id));
if (kept.length !== 1 || kept[0].id !== 'v-1') throw new Error('未导出方案被误删');

// 6) 旧版本数据迁移（小图能迁成功）
const legacy = structuredClone(doc);
legacy.variants = [];
legacy.image = { ...doc.image, src: 'data:image/jpeg;base64,' + 'B'.repeat(600) };
dom.window.localStorage.map.clear();
dom.window.localStorage.setItem('framesense.document.v1', JSON.stringify(legacy));
const migrated = repo.load();
console.log('legacy migration =>', {
  recovery: migrated.recovery,
  hasPayload: !!migrated.image,
  srcInStructure: 'src' in JSON.parse(dom.window.localStorage.getItem('framesense.document.v1')).image,
});
if (migrated.recovery || !migrated.image) throw new Error('小图应迁移成功');

// 7) 旧版本大图迁移失败 -> 结构保住、恢复态
dom.window.localStorage.map.clear();
// 直接塞底层 map，模拟“旧版本时代存下、已占满配额的大图文档”（新写入会被配额挡住）
dom.window.localStorage.map.set('framesense.document.v1', JSON.stringify({ ...legacy, image: { ...legacy.image, src: bigSrc } }));
const failedMigration = repo.load();
console.log('big legacy =>', { recovery: failedMigration.recovery, variants: failedMigration.document.subject });
if (failedMigration.recovery !== 'legacy-image-evicted') throw new Error('应标记 legacy-image-evicted');
if (!failedMigration.document.image || failedMigration.document.image.name !== 'IMG_0423.HEIC.jpg') throw new Error('结构丢失');

console.log('\n全部集成场景通过 ✔');
