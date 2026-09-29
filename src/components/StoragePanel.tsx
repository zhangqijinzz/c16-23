import type { ConfirmRequest, FrameDocument, StorageUsage } from '../model';
import { formatBytes } from '../format';

interface StoragePanelProps {
  open: boolean;
  usage: StorageUsage | null;
  document: FrameDocument;
  confirm: ConfirmRequest | null;
  onClose: () => void;
  onRequest: (kind: 'image' | 'exported') => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function StoragePanel({ open, usage, document, confirm, onClose, onRequest, onConfirm, onCancel }: StoragePanelProps) {
  if (!open) return null;
  const used = usage?.used ?? 0;
  const quota = usage?.quota ?? 0;
  const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const tight = percent > 70;
  const exportedCount = document.variants.filter((variant) => variant.exported).length;
  const unexportedCount = document.variants.length - exportedCount;

  return (
    <div className="storage-backdrop" onClick={onClose}>
      <aside className="storage-panel" role="dialog" aria-modal="true" aria-label="本地存储占用" onClick={(event) => event.stopPropagation()}>
        <div className="storage-head">
          <div><p className="eyebrow">LOCAL STORAGE</p><h3>本地存储占用</h3></div>
          <button className="storage-close" aria-label="关闭存储面板" onClick={onClose}>×</button>
        </div>

        <div className={`storage-gauge ${tight ? 'tight' : ''}`}>
          <div className="gauge-bar"><i style={{ width: `${percent}%` }} /></div>
          <div className="gauge-text"><strong>{formatBytes(used)}</strong><span> / 约 {formatBytes(quota)}（浏览器估算上限）</span></div>
        </div>

        <p className="storage-note">图片数据与构图方案分开保存：容量不足时优先保住构图方案与设置。所有清理都需要你确认，未导出过的方案不会被删除。</p>

        <ul className="storage-list">
          <li className="storage-row protected">
            <span className="row-icon">▣</span>
            <div><strong>构图方案与设置</strong><small>辅助层、裁切、主体标记 · {document.variants.length} 个方案 · 始终保留</small></div>
            <em className="row-size">{formatBytes(usage?.structureBytes ?? 0)}</em>
          </li>
          <li className="storage-row">
            <span className="row-icon">◧</span>
            <div><strong>图片数据</strong><small>{document.image ? document.image.name : '暂无缓存图片'} · 可单独清理，重选原图即可恢复</small></div>
            <em className="row-size">{formatBytes(usage?.imageBytes ?? 0)}</em>
            <button className="row-action" disabled={(usage?.imageBytes ?? 0) === 0} onClick={() => onRequest('image')}>清理</button>
          </li>
          <li className="storage-row protected" data-locked={unexportedCount > 0}>
            <span className="row-icon">✦</span>
            <div><strong>未导出的方案</strong><small>{unexportedCount} 个 · 尚未导出，受保护不可清理</small></div>
            <em className="row-lock">{unexportedCount > 0 ? '受保护' : '—'}</em>
          </li>
          <li className="storage-row">
            <span className="row-icon">↓</span>
            <div><strong>已导出的方案</strong><small>{exportedCount} 个 · 已导出为 PNG，可安全清理</small></div>
            <button className="row-action" disabled={exportedCount === 0} onClick={() => onRequest('exported')}>清理</button>
          </li>
          {(usage?.foreignBytes ?? 0) > 0 && (
            <li className="storage-row foreign">
              <span className="row-icon">⋯</span>
              <div><strong>其他网页/扩展的数据</strong><small>{formatBytes(usage?.foreignBytes ?? 0)} · FrameSense 无法也不会清理，需到浏览器设置中管理</small></div>
            </li>
          )}
        </ul>

        {confirm && (
          <div className="confirm-card" role="alertdialog" aria-label={confirm.title}>
            <strong>{confirm.title}</strong>
            <p>{confirm.detail}{confirm.bytesToFree > 0 ? ` 预计释放 ${formatBytes(confirm.bytesToFree)}。` : ''}</p>
            <div className="confirm-actions">
              <button className="danger-button" onClick={onConfirm}>确认清理</button>
              <button className="quiet-button" onClick={onCancel}>取消</button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
