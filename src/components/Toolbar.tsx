import type { GuideKey, Ratio } from '../model';
import { formatBytes } from '../format';

interface ToolbarProps {
  guides: Record<GuideKey, boolean>;
  ratio: string;
  disabled: boolean;
  usedBytes: number;
  onImport: (file: File) => void;
  onDemo: () => void;
  onToggleGuide: (guide: GuideKey) => void;
  onRatio: (ratio: Ratio) => void;
  onCompare: () => void;
  onStorage: () => void;
  compareOpen: boolean;
}

const guideLabels: Array<[GuideKey, string, string]> = [
  ['thirds', '三分网格', '▦'],
  ['center', '中心线', '＋'],
  ['diagonal', '对角线', '／'],
  ['golden', '黄金区域', '◌'],
];

export function Toolbar(props: ToolbarProps) {
  return (
    <aside className="toolbar">
      <div className="toolbar-top">
        <label className="import-button">
          <span className="button-icon">＋</span> 导入图片
          <input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onImport(file); event.target.value = ''; }} />
        </label>
        <button className="quiet-button" onClick={props.onDemo}>示例图</button>
      </div>

      <div className="control-group">
        <div className="section-label"><span>辅助层</span><small>GUIDES</small></div>
        <div className="guide-grid">
          {guideLabels.map(([key, label, icon]) => (
            <button key={key} className={`guide-button ${props.guides[key] ? 'active' : ''}`} disabled={props.disabled} onClick={() => props.onToggleGuide(key)} aria-pressed={props.guides[key]}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <div className="section-label"><span>裁切比例</span><small>FORMAT</small></div>
        <div className="ratio-row">
          {(['free', '1:1', '4:5', '16:9'] as Ratio[]).map((item) => <button key={item} className={props.ratio === item ? 'active' : ''} disabled={props.disabled} onClick={() => props.onRatio(item)}>{item === 'free' ? '自由' : item}</button>)}
        </div>
      </div>

      <button className={`compare-button ${props.compareOpen ? 'active' : ''}`} disabled={props.disabled} onClick={props.onCompare}><span>◫</span> {props.compareOpen ? '返回工作台' : '打开前后对比'}</button>
      <button className="storage-button" onClick={props.onStorage}><span>▰</span> 本地存储<small>{formatBytes(props.usedBytes)}</small></button>
    </aside>
  );
}
