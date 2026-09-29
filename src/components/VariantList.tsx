import type { CropVariant, ImageAsset } from '../model';

interface VariantListProps {
  variants: CropVariant[];
  image: ImageAsset | null;
  current: CropVariant;
  onSave: () => void;
  onSelect: (id: string) => void;
  onExport: (id: string) => void;
}

export function VariantList({ variants, image, current, onSave, onSelect, onExport }: VariantListProps) {
  return (
    <section className="variants-panel">
      <div className="panel-heading"><div><p className="eyebrow">SAVED FRAMES</p><h3>裁切方案 <span>{variants.length}</span></h3></div><button className="save-button" onClick={onSave} disabled={!image}>保存当前</button></div>
      {variants.length === 0 ? <div className="variant-empty"><span>◇</span><p>还没有保存的方案</p><small>调整画框后保存，比较不同构图取舍。<br />导出过的方案才能被清理。</small></div> : <div className="variant-list">{variants.map((variant, index) => {
        const selected = current.x === variant.x && current.y === variant.y && current.width === variant.width;
        return (
          <div className={`variant-card ${selected ? 'selected' : ''}`} key={variant.id}>
            <button className="variant-main" onClick={() => onSelect(variant.id)} disabled={!image} title={image ? '应用该方案' : '重新选择原图后才能应用'}>
              <span className="variant-thumb">{image ? <img src={image.src} alt="" style={{ objectPosition: `${variant.x * 100}% ${variant.y * 100}%` }} /> : <span className="thumb-missing">◨</span>}</span>
              <span className="variant-info"><strong>方案 {String(index + 1).padStart(2, '0')} {variant.exported && <em className="export-badge">已导出</em>}</strong><small>{variant.ratio === 'free' ? '自由裁切' : variant.ratio} · {Math.round(variant.width * 100)}%{!image && ' · 待重选原图'}</small></span>
              <em className="variant-arrow">→</em>
            </button>
            <button className="export-button" onClick={() => onExport(variant.id)} disabled={!image} title={variant.exported ? '重新导出 PNG' : '导出为 PNG，之后该方案可被清理'}>{variant.exported ? '↺' : '↓'}</button>
          </div>
        );
      })}</div>}
      <div className="variant-tip"><span>✦</span><p>建议保存至少 3 个版本：<br />保守、平衡、实验性。<br />导出 PNG 后方案才允许被清理。</p></div>
    </section>
  );
}
