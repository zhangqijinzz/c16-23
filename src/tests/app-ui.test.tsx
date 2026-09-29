// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { STRUCTURE_KEY, IMAGE_KEY } from '../service';
import { DEFAULT_CROP, EMPTY_DOCUMENT } from '../model';

async function mountFreshApp(): Promise<HTMLElement> {
  vi.resetModules();
  const { default: FreshApp } = await import('../App');
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<FreshApp />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

function click(container: HTMLElement, predicate: (button: HTMLButtonElement) => boolean): void {
  const button = [...container.querySelectorAll('button')].find((item): item is HTMLButtonElement => {
    const candidate = item as HTMLButtonElement;
    return predicate(candidate);
  });
  if (!button) throw new Error('未找到目标按钮');
  act(() => { button.click(); });
}

describe('App 存储相关界面', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  it('图片数据缺失时显示恢复面板，而不是只有辅助线的半残画布', async () => {
    const doc = {
      ...structuredClone(EMPTY_DOCUMENT),
      image: { id: 'gone', width: 1080, height: 1920, name: '手机原图.jpg' },
      guides: { thirds: true, center: true, diagonal: false, golden: false },
      subject: { x: 0.5, y: 0.5 },
      variants: [{ ...DEFAULT_CROP, id: 'v-1', exported: false }],
    };
    window.localStorage.setItem(STRUCTURE_KEY, JSON.stringify(doc));

    const container = await mountFreshApp();
    expect(container.textContent).toContain('构图还在，原图需要重新选择');
    expect(container.textContent).toContain('手机原图.jpg');
    expect(container.textContent).toContain('1080 × 1920px');
    expect(container.textContent).toContain('重新选择原图');
    expect(container.querySelector('.canvas-stage')).toBeNull();
    expect(container.textContent).toContain('裁切方案');
  });

  it('打开存储面板可看到占用，清理图片需要二次确认，确认后只删图片保结构', async () => {
    window.localStorage.setItem(
      STRUCTURE_KEY,
      JSON.stringify({ ...structuredClone(EMPTY_DOCUMENT), image: { id: 'i1', width: 100, height: 100, name: 'a.jpg' } }),
    );
    window.localStorage.setItem(IMAGE_KEY, JSON.stringify({ id: 'i1', src: 'data:image/png;base64,AAA' }));

    const container = await mountFreshApp();
    expect(window.localStorage.getItem(IMAGE_KEY)).not.toBeNull();

    click(container, (button) => button.textContent?.includes('本地存储') ?? false);
    expect(container.textContent).toContain('本地存储占用');
    expect(container.textContent).toContain('构图方案与设置');

    // 第一张可点的“清理”是图片数据行
    click(container, (button) => button.textContent?.trim() === '清理' && !button.disabled);
    expect(container.textContent).toContain('清理图片数据？');
    expect(window.localStorage.getItem(IMAGE_KEY)).not.toBeNull();

    click(container, (button) => button.textContent?.includes('确认清理') ?? false);
    expect(window.localStorage.getItem(IMAGE_KEY)).toBeNull();
    const structure = JSON.parse(window.localStorage.getItem(STRUCTURE_KEY)!);
    expect(structure.image.name).toBe('a.jpg');
    // 本次会话仍可继续编辑（内存里有图），明确提示重开需重选
    expect(container.querySelector('.canvas-stage')).not.toBeNull();
    expect(container.textContent).toContain('重新打开页面后需要重新选择原图');

    // 重新打开（清空 DOM、用同一份 localStorage 重新挂载）：进入恢复态
    document.body.innerHTML = '';
    const reopened = await mountFreshApp();
    expect(reopened.querySelector('.canvas-stage')).toBeNull();
    expect(reopened.textContent).toContain('构图还在，原图需要重新选择');
  });

  it('没有已导出方案时，方案清理按钮禁用，未导出方案无法被删除', async () => {
    const doc = {
      ...structuredClone(EMPTY_DOCUMENT),
      image: { id: 'i2', width: 200, height: 200, name: 'b.jpg' },
      variants: [{ ...DEFAULT_CROP, id: 'v-x', exported: false }],
    };
    window.localStorage.setItem(STRUCTURE_KEY, JSON.stringify(doc));
    window.localStorage.setItem(IMAGE_KEY, JSON.stringify({ id: 'i2', src: 'data:image/png;base64,BBB' }));

    const container = await mountFreshApp();
    click(container, (button) => button.textContent?.includes('本地存储') ?? false);
    const cleanupButtons = [...container.querySelectorAll('button')].filter((button) => button.textContent?.trim() === '清理') as HTMLButtonElement[];
    // 图片清理可用；方案清理因没有已导出方案而禁用
    expect(cleanupButtons[0].disabled).toBe(false);
    expect(cleanupButtons[1].disabled).toBe(true);
    expect(container.textContent).toContain('受保护');
  });
});
