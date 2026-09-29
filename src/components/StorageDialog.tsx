import { useState } from 'react';
import type { StorageInfo } from '../model';

interface StorageDialogProps {
  info: StorageInfo;
  onClose: () => void;
  onClearImage: () => void;
  onClearAll: () => void;
}

type Confirming = 'image' | 'all' | null;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function StorageDialog({ info, onClose, onClearImage, onClearAll }: StorageDialogProps) {
  const [confirming, setConfirming] = useState<Confirming>(null);
  const ratio = Math.min(1, info.appUsed / info.quota);
  const percent = Math.round(ratio * 100);

  return (
    <div className="storage-overlay" onClick={onClose}>
      <div className="storage-dialog" role="dialog" aria-modal="true" aria-label="本地存储管理" onClick={(event) => event.stopPropagation()}>
        <div className="storage-header">
          <div>
            <p className="eyebrow">LOCAL STORAGE</p>
            <h2>本地存储</h2>
          </div>
          <button className="storage-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="storage-usage">
          <div className="storage-bar"><span style={{ width: `${percent}%` }} className={percent > 85 ? 'danger' : percent > 60 ? 'warn' : ''} /></div>
          <div className="storage-usage-label"><span>本应用占用 {formatBytes(info.appUsed)}</span><span>约 {formatBytes(info.quota)} 上限 · {percent}%</span></div>
        </div>

        <ul className="storage-breakdown">
          <li><span className="dot composition" /><span>构图与设置</span><b>{formatBytes(info.documentSize)}</b><small>辅助线 · 主体 · 裁切框 · {info.variantCount} 个方案</small></li>
          <li><span className="dot image" /><span>图片数据</span><b>{formatBytes(info.imageSize)}</b><small>{info.imagePresent ? '已保存在本地' : info.imageMissing ? '未保存（降级）' : '暂无图片'}</small></li>
        </ul>

        <p className="storage-note">图片数据可以随时从原图重新读取；构图方案是你调整的成果，不会被自动删除。</p>

        <div className="storage-actions">
          {confirming !== 'image' ? (
            <button className="storage-action" disabled={!info.imagePresent} onClick={() => setConfirming('image')}>
              <strong>清除图片数据</strong><small>保留构图方案，重新选择图片即可恢复</small>
            </button>
          ) : (
            <div className="storage-confirm">
              <p>将删除本地图片数据，构图方案保留。下次打开需重新选择原图，确认清除？</p>
              <div className="storage-confirm-row">
                <button className="danger" onClick={onClearImage}>确认清除图片</button>
                <button onClick={() => setConfirming(null)}>取消</button>
              </div>
            </div>
          )}

          {confirming !== 'all' ? (
            <button className="storage-action danger-ghost" onClick={() => setConfirming('all')}>
              <strong>清除全部数据</strong><small>删除图片与全部构图方案，且无法恢复</small>
            </button>
          ) : (
            <div className="storage-confirm danger">
              <p>将删除图片与全部 {info.variantCount} 个构图方案。这些方案尚未导出，清除后无法找回，确认全部清除？</p>
              <div className="storage-confirm-row">
                <button className="danger" onClick={onClearAll}>确认全部清除</button>
                <button onClick={() => setConfirming(null)}>取消</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
