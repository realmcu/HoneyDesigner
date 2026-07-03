import { HmlParser } from '../../hml/HmlParser';

/**
 * HmlParser 确定性 fallback id 回归测试（对应设计文档 T2a）。
 *
 * 覆盖三条验收点：
 *   1. 同一文件（同内容 + 同路径）反复 parse，所有组件 id 逐一相同。
 *   2. 跨文件（不同 basename 种子）解析相同内容，fallback id 不同（不撞车）。
 *   3. 显式 id 与将会生成的 fallback id 冲突时，两个组件不会被静默合并
 *      （HmlParser.ts:355-356 的 componentMap.has 合并逻辑只应对"同一个 id
 *      被解析到两次"生效，不应误伤"显式 id 恰好撞上 fallback 序号"）。
 */
describe('HmlParser deterministic fallback ids', () => {
  const NO_ID_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <title>T</title>
  </meta>
  <view>
    <hg_view x="0" y="0" w="240" h="240" entry="true">
      <hg_button x="0" y="0" w="10" h="10" text="a" />
      <hg_button x="0" y="0" w="10" h="10" text="b" />
    </hg_view>
  </view>
</hml>`;

  function ids(content: string, filePath?: string): string[] {
    const doc = new HmlParser().parse(content, filePath);
    return (doc.view.components || []).map(c => c.id);
  }

  it('produces identical ids across repeated parses of the same file (no path)', () => {
    const first = ids(NO_ID_CONTENT);
    const second = ids(NO_ID_CONTENT);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it('produces identical ids across repeated parses of the same file (with path)', () => {
    const first = ids(NO_ID_CONTENT, '/project/ui/home.hml');
    const second = ids(NO_ID_CONTENT, '/project/ui/home.hml');
    const third = ids(NO_ID_CONTENT, '/project/ui/home.hml');
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('derives different fallback ids for identical content parsed under different file paths (basename seed)', () => {
    const idsA = ids(NO_ID_CONTENT, '/project/ui/fileA.hml');
    const idsB = ids(NO_ID_CONTENT, '/project/ui/fileB.hml');
    expect(idsA.length).toBe(idsB.length);
    // 每个位置上的 id 都应携带各自 basename 前缀，逐一不同
    for (let i = 0; i < idsA.length; i++) {
      expect(idsA[i]).not.toBe(idsB[i]);
      expect(idsA[i]).toMatch(/^fileA_/);
      expect(idsB[i]).toMatch(/^fileB_/);
    }
  });

  it('does not silently merge an explicit id that collides with a would-be fallback id', () => {
    // 第二个 hg_button 显式声明的 id 恰好等于第一个无 id 组件将生成的 fallback id
    // （无路径场景下第一个 hg_button 的 fallback id 应为 hg_button_auto_0）。
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta><title>T</title></meta>
  <view>
    <hg_view id="view_x" x="0" y="0" w="240" h="240" entry="true">
      <hg_button x="0" y="0" w="10" h="10" text="auto" />
      <hg_button id="hg_button_auto_0" x="0" y="0" w="10" h="10" text="explicit" />
    </hg_view>
  </view>
</hml>`;

    const doc = new HmlParser().parse(content);
    const buttons = (doc.view.components || []).filter(c => c.type === 'hg_button');

    // 两个按钮都必须存在（未被合并成一个），且 id 互不相同
    expect(buttons.length).toBe(2);
    const idSet = new Set(buttons.map(b => b.id));
    expect(idSet.size).toBe(2);
    expect(idSet.has('hg_button_auto_0')).toBe(true);

    // 显式声明的按钮必须保留它自己的 text，未被另一个按钮的数据覆盖
    const explicitBtn = buttons.find(b => b.id === 'hg_button_auto_0')!;
    expect((explicitBtn.data as any)?.text).toBe('explicit');
  });

  it('reuses the same id when the same explicit id legitimately appears once (sanity: no over-splitting)', () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta><title>T</title></meta>
  <view>
    <hg_view id="view_only" x="0" y="0" w="240" h="240" entry="true" />
  </view>
</hml>`;
    const doc = new HmlParser().parse(content);
    expect((doc.view.components || []).map(c => c.id)).toEqual(['view_only']);
  });
});
