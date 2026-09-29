import type { ImageMeta } from '../model';

interface MissingImagePanelProps {
  meta: ImageMeta | null;
  variantCount: number;
  onImport: (file: File) => void;
  onDemo: () => void;
  onOpenStorage: () => void;
}

export function MissingImagePanel({ meta, variantCount, onImport, onDemo, onOpenStorage }: MissingImagePanelProps) {
  return (
    <section className="missing-panel">
      <div className="missing-orbit" aria-hidden="true"><span>◈</span></div>
      <p className="eyebrow">IMAGE NOT SAVED / 图片未恢复</p>
      <h2>构图方案已保留，重新选择原图</h2>
      <p>
        {variantCount > 0
          ? `已恢复 ${variantCount} 个裁切方案，辅助层、主体标记与裁切设置都在。`
          : '辅助层、主体标记与裁切设置都已保留。'}
        图片数据因浏览器容量限制未保存到本地
        {meta ? `（原图：${meta.name} · ${meta.width} × ${meta.height}）` : ''}
        ，重新选择同一张图片即可继续构图。
      </p>
      <div className="missing-actions">
        <label className="primary-button">
          重新选择图片
          <input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ''; }} />
        </label>
        <button className="quiet-button" onClick={onDemo}>载入示例图片</button>
      </div>
      <button className="missing-storage-link" onClick={onOpenStorage}>管理本地存储，清理空间后可再次保存图片 →</button>
    </section>
  );
}
