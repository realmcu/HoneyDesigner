import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  clearNavGraphScanCache,
  normalizeHmlFilePath,
  scanAllViews,
  scanProjectHml,
  ViewNavNode,
} from '../../designer/navGraphScanner';

/**
 * 导航图边采集 / 跨文件 target 解析 读路径回归（评审 I8）。
 *
 * 用 src/test/fixtures/nav-graph-project 这套刻意构造的最难场景直接驱动
 * scanAllViews：跨文件同名 view、name≠id（按 name 注册）、跨 id/name 歧义、
 * 悬空 target、嵌套 hg_view 剪枝、定时器 segments/actions 仲裁、定时器谓词
 * （enabled/mode/旧字符串形式）过滤。这些 fixture 原先零测试引用，属死资产。
 */
const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'nav-graph-project');
const ENTRY = path.join(FIXTURE_ROOT, 'ui', 'home.hml');

describe('navGraphScanner.scanAllViews (I8 边采集读路径)', () => {
  let views: ViewNavNode[];

  beforeAll(async () => {
    views = await scanAllViews(ENTRY);
  });

  const byKey = (k: string): ViewNavNode | undefined => views.find(v => v.viewKey === k);
  const edgesOf = (k: string) => byKey(k)?.edges ?? [];
  const edgesFrom = (k: string, controlId: string) =>
    edgesOf(k).filter(e => e.sourceControlId === controlId);
  const oneEdge = (k: string, controlId: string) => {
    const es = edgesFrom(k, controlId);
    expect(es).toHaveLength(1);
    return es[0];
  };

  it('collects every hg_view (incl. nested + no-id fallback + cross-file same-name) as a node', () => {
    const keys = views.map(v => v.viewKey).sort();
    expect(keys).toEqual([
      'ui/home.hml#view_home',
      'ui/home.hml#view_nested',
      'ui/settings.hml#settings_hg_view_auto_0', // 无 id 的 view → 带 basename 种子的确定性 fallback id
      'ui/settings.hml#view_extra_id',
      'ui/settings.hml#view_legacy_timer',
      'ui/settings.hml#view_settings',
      'ui/settings.hml#view_timer_filter',
      'ui/sub/dup_a.hml#mixed_alias',
      'ui/sub/dup_a.hml#view_dup',        // 与 dup_b#view_dup 跨文件撞名
      'ui/sub/dup_b.hml#view_dup',
    ]);
  });

  it('view-self gesture edge is attributed to the view with sourceIsView, resolves cross-file', () => {
    const gesture = oneEdge('ui/home.hml#view_home', 'view_home');
    expect(gesture.kind).toBe('control');
    expect(gesture.event).toBe('onSwipeLeft');
    expect(gesture.sourceIsView).toBe(true);
    expect(gesture.target).toBe('view_settings');
    expect(gesture.isValid).toBe(true);
    expect(gesture.targetAmbiguous).toBe(false);
    expect(gesture.targetViewKey).toBe('ui/settings.hml#view_settings');
  });

  it('resolves a target written as another view NAME (codegen registers views by name)', () => {
    const e = oneEdge('ui/home.hml#view_home', 'btn_go_extra');
    expect(e.target).toBe('ExtraScreen');
    expect(e.isValid).toBe(true);
    expect(e.targetAmbiguous).toBe(false);
    expect(e.targetViewKey).toBe('ui/settings.hml#view_extra_id');
  });

  it('flags a cross-file same-name id collision as ambiguous (timer edge → view_dup)', () => {
    const e = oneEdge('ui/home.hml#view_home', 'lbl_timer_jump');
    expect(e.kind).toBe('timer');
    expect(e.target).toBe('view_dup');
    expect(e.isValid).toBe(true);          // 至少命中一个已知 view
    expect(e.targetAmbiguous).toBe(true);  // dup_a#view_dup 与 dup_b#view_dup 撞名
    expect(e.targetViewKey).toBeUndefined();
  });

  it('flags cross id/name ambiguity (target hits one view by id and another by name)', () => {
    const e = oneEdge('ui/home.hml#view_home', 'btn_go_mixed');
    expect(e.target).toBe('mixed_alias');  // dup_a#mixed_alias(id) + dup_b#view_dup(name="mixed_alias")
    expect(e.isValid).toBe(true);
    expect(e.targetAmbiguous).toBe(true);
    expect(e.targetViewKey).toBeUndefined();
  });

  it('marks a dangling target (no view has that id/name) as invalid', () => {
    const e = oneEdge('ui/settings.hml#view_settings', 'btn_broken');
    expect(e.target).toBe('view_missing');
    expect(e.isValid).toBe(false);
    expect(e.targetViewKey).toBeUndefined();
  });

  it('prunes at nested hg_view: descendant edges belong to the child screen, not the parent', () => {
    // 嵌套按钮的边不得出现在 view_home 上
    expect(edgesFrom('ui/home.hml#view_home', 'btn_nested_back')).toHaveLength(0);
    // 而应归属 view_nested
    const nested = oneEdge('ui/home.hml#view_nested', 'btn_nested_back');
    expect(nested.target).toBe('view_home');
    expect(nested.isValid).toBe(true);
    expect(nested.targetViewKey).toBe('ui/home.hml#view_home');
  });

  it('timer with both actions and segments: codegen prefers segments, so only the segment edge is collected', () => {
    const both = edgesFrom('ui/home.hml#view_home', 'lbl_timer_both');
    expect(both).toHaveLength(1);
    expect(both[0].kind).toBe('timer');
    expect(both[0].target).toBe('view_settings');       // 来自 segments
    expect(both.some(e => e.target === 'view_missing')).toBe(false); // actions 的目标不得成边
  });

  it('does not collect edges for timers codegen would not bind (disabled / no-mode / legacy string form)', () => {
    // enabled:false 与缺 mode 都不出边（谓词与 codegen 绑定对齐，评审 I2）
    expect(edgesOf('ui/settings.hml#view_timer_filter')).toHaveLength(0);
    // 旧字符串形式 timerEnabled="true" 在 master 上从不生成 timer 代码，导航图也不采集
    expect(edgesOf('ui/settings.hml#view_legacy_timer')).toHaveLength(0);
  });

  it('cross-file same-name views are distinct nodes keyed by relPath#viewId', () => {
    const a = byKey('ui/sub/dup_a.hml#view_dup');
    const b = byKey('ui/sub/dup_b.hml#view_dup');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.filePath).not.toBe(b!.filePath);
    // dup_a#view_dup 有一条出边（btn_dup_home → view_home），dup_b#view_dup 无出边
    expect(edgesOf('ui/sub/dup_a.hml#view_dup')).toHaveLength(1);
    expect(edgesOf('ui/sub/dup_b.hml#view_dup')).toHaveLength(0);
  });

  it('returns files, views and component ids from the same parse pass', async () => {
    const result = await scanProjectHml(ENTRY);
    expect(result.hmlFiles).toHaveLength(4);
    expect(result.views).toHaveLength(views.length);
    expect(result.errors).toEqual([]);
    expect(result.componentIdsByFile.size).toBe(4);
    expect(result.componentIds).toEqual(expect.arrayContaining([
      'view_home',
      'btn_go_extra',
      'view_settings',
      'view_dup',
    ]));
    expect(result.duplicateIds).toContain('view_dup');

    const homeIds = result.componentIdsByFile.get(normalizeHmlFilePath(ENTRY));
    expect(homeIds).toEqual(expect.arrayContaining(['view_home', 'btn_go_extra']));
  });
});

/**
 * 单文件解析结果缓存（避免每次打开/切换面板都全量 read + sha1 + parse）。
 *
 * 重点是"命中缓存后结果与全量扫描逐字一致"，以及 target 解析阶段对 edge 的
 * 就地写入不会污染缓存 —— 后者若失守，第二次扫描会读到上一次的判定结果。
 */
describe('navGraphScanner 扫描缓存', () => {
  beforeEach(() => {
    clearNavGraphScanCache();
  });

  const stripVolatile = (result: Awaited<ReturnType<typeof scanProjectHml>>) =>
    JSON.stringify({
      views: result.views,
      componentIds: result.componentIds,
      duplicateIds: result.duplicateIds,
      componentIdsByFile: [...result.componentIdsByFile.entries()],
      errors: result.errors,
    });

  it('第二次扫描不再读盘与解析，且结果与首次完全一致', async () => {
    const cold = { hmlReads: 0, hmlParses: 0 };
    const first = await scanProjectHml(ENTRY, cold);
    expect(cold.hmlReads).toBe(4);
    expect(cold.hmlParses).toBe(4);

    const warm = { hmlReads: 0, hmlParses: 0 };
    const second = await scanProjectHml(ENTRY, warm);
    expect(warm.hmlReads).toBe(0);
    expect(warm.hmlParses).toBe(0);

    expect(stripVolatile(second)).toEqual(stripVolatile(first));
  });

  it('返回的 edges 是副本，调用方改动不会污染后续扫描', async () => {
    const first = await scanProjectHml(ENTRY);
    const gesture = first.views
      .find(v => v.viewKey === 'ui/home.hml#view_home')!
      .edges.find(e => e.sourceControlId === 'view_home')!;
    const originalValidity = gesture.isValid;

    // 模拟调用方就地篡改（target 解析阶段正是这么写的）
    gesture.isValid = !originalValidity;
    gesture.target = 'mutated_by_caller';

    const second = await scanProjectHml(ENTRY);
    const sameEdge = second.views
      .find(v => v.viewKey === 'ui/home.hml#view_home')!
      .edges.find(e => e.sourceControlId === 'view_home')!;
    expect(sameEdge.target).not.toBe('mutated_by_caller');
    expect(sameEdge.isValid).toBe(originalValidity);
  });

  it('文件内容变化后缓存失效并重新解析', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-cache-'));
    const hmlWith = (viewId: string) =>
      `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <view id="main">
    <hg_view id="${viewId}" x="0" y="0" w="240" h="240"></hg_view>
  </view>
</hml>
`;
    try {
      fs.writeFileSync(
        path.join(tmpRoot, 'project.json'),
        JSON.stringify({ $schema: 'HoneyGUI', type: 'Designer', name: 'nav-cache', uiDir: 'ui' })
      );
      const uiDir = path.join(tmpRoot, 'ui');
      fs.mkdirSync(uiDir);
      const entry = path.join(uiDir, 'main.hml');
      fs.writeFileSync(entry, hmlWith('view_one'));

      const before = await scanProjectHml(entry);
      expect(before.views.map(v => v.id)).toEqual(['view_one']);

      // 改写为不同 id：内容长度也不同，mtime 与 size 均变化
      fs.writeFileSync(entry, hmlWith('view_two_renamed'));

      const after = await scanProjectHml(entry);
      expect(after.views.map(v => v.id)).toEqual(['view_two_renamed']);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
