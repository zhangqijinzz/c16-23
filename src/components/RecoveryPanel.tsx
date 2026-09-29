import type { FrameDocument } from '../model';

interface RecoveryPanelProps {
  document: FrameDocument;
  reason: 'image-missing' | 'legacy-image-evicted' | null;
  onRestore: (file: File) => void;
  onDemo: () => void;
}

export function RecoveryPanel({ document, reason, onRestore, onDemo }: RecoveryPanelProps) {
  const image = document.image;
  const enabledGuides = Object.values(document.guides).filter(Boolean).length;
  return (
    <section className="recovery-state" role="alert">
      <div className="recovery-badge"><span>◨</span></div>
      <p className="eyebrow">WORKSPACE / RECOVERY</p>
      <h2>构图还在，原图需要重新选择</h2>
      <p className="recovery-lead">
        本地存储空间不足，图片数据已按优先级让出位置；<b>构图方案与设置完整保留</b>。
        {reason === 'legacy-image-evicted' ? '这是升级存储结构时发现原图过大、未能一并搬迁导致的。' : '重新选择同一张原图即可完整恢复工作台。'}
      </p>

      <div className="recovery-meta">
        {image && <div className="recovery-meta-item"><small>原图文件</small><strong title={image.name}>{image.name}</strong></div>}
        {image && <div className="recovery-meta-item"><small>原始尺寸</small><strong>{image.width} × {image.height}px</strong></div>}
        <div className="recovery-meta-item"><small>当前裁切</small><strong>{document.crop.ratio === 'free' ? '自由裁切' : document.crop.ratio}</strong></div>
        <div className="recovery-meta-item"><small>辅助层</small><strong>{enabledGuides} 个开启</strong></div>
        <div className="recovery-meta-item"><small>主体标记</small><strong>{document.subject ? '已保留' : '未标记'}</strong></div>
        <div className="recovery-meta-item"><small>已保存方案</small><strong>{document.variants.length} 个</strong></div>
      </div>

      <div className="recovery-actions">
        <label className="primary-button restore-button">
          重新选择原图
          <input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) onRestore(file); event.target.value = ''; }} />
        </label>
        <button className="quiet-button" onClick={onDemo}>先用示例图看看</button>
      </div>
      <span className="empty-hint">请尽量选择同一张原图；尺寸不同时裁切位置可能需要微调</span>
    </section>
  );
}
