import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NavLayoutService } from '../../services/NavLayoutService';

/**
 * NavLayoutService 合并写测试（对应设计文档 T7）。
 *
 * 覆盖设计任务点名的两条：
 *   1. 只覆盖 patch 携带的 key（read-modify-write 合并，不因某次只发部分节点
 *      就抹掉其余节点已保存的坐标 —— 防多面板互相覆盖）。
 *   2. 并发写入串行化（同一 projectRoot 的多次 saveLayoutPatch 即便并发发起，
 *      也不会互相踩踏丢更新）。
 *
 * NavLayoutService 是单例（getInstance），第二个用例通过临时替换实例上的
 * 私有 writeMerge 方法注入人为延迟，制造真实的"若无串行化就会竞态"窗口，
 * 而不仅仅依赖 Node 同步 fs 调用天然不交织这一点。
 */
describe('NavLayoutService merge writes', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-layout-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('only overwrites the keys present in the patch (sequential)', async () => {
    const svc = NavLayoutService.getInstance();

    await svc.saveLayoutPatch(tmpRoot, {
      'ui/home.hml#view_a': { x: 10, y: 20 },
      'ui/home.hml#view_b': { x: 30, y: 40 },
    });
    let layout = svc.loadLayout(tmpRoot);
    expect(layout).toEqual({
      'ui/home.hml#view_a': { x: 10, y: 20 },
      'ui/home.hml#view_b': { x: 30, y: 40 },
    });

    // 第二次只发一个 key 的变更 —— view_b 的坐标必须原样保留
    await svc.saveLayoutPatch(tmpRoot, {
      'ui/home.hml#view_a': { x: 99, y: 99 },
    });
    layout = svc.loadLayout(tmpRoot);
    expect(layout).toEqual({
      'ui/home.hml#view_a': { x: 99, y: 99 },
      'ui/home.hml#view_b': { x: 30, y: 40 },
    });
  });

  it('drops malformed entries on write while keeping the rest of the merge intact', async () => {
    const svc = NavLayoutService.getInstance();
    await svc.saveLayoutPatch(tmpRoot, { 'ui/home.hml#view_a': { x: 1, y: 2 } });
    // 故意构造非法条目（x 非 number），验证 sanitize 过滤而不是整体写入失败
    const patchWithGarbage: any = {
      'ui/home.hml#view_b': { x: 3, y: 4 },
      'ui/home.hml#view_bad': { x: 'nope', y: 5 },
    };
    await svc.saveLayoutPatch(tmpRoot, patchWithGarbage);
    const layout = svc.loadLayout(tmpRoot);
    expect(layout).toEqual({
      'ui/home.hml#view_a': { x: 1, y: 2 },
      'ui/home.hml#view_b': { x: 3, y: 4 },
    });
  });

  it('serializes concurrent saveLayoutPatch calls for the same projectRoot (no lost updates, no interleaving)', async () => {
    const svc = NavLayoutService.getInstance();
    const originalWriteMerge = (svc as any).writeMerge.bind(svc);

    let inFlight = 0;
    let maxInFlight = 0;
    (svc as any).writeMerge = async (root: string, patch: any) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // 人为延迟，制造"若无串行化就会产生交织读-改-写竞态"的窗口
      await new Promise(resolve => setTimeout(resolve, 15));
      try {
        await originalWriteMerge(root, patch);
      } finally {
        inFlight--;
      }
    };

    try {
      const keys = Array.from({ length: 8 }, (_, i) => `ui/home.hml#view_${i}`);
      // 全部并发发起（不逐个 await），模拟多面板同时各拖各的节点
      const writes = keys.map(key =>
        svc.saveLayoutPatch(tmpRoot, { [key]: { x: keys.indexOf(key), y: keys.indexOf(key) * 10 } })
      );
      await Promise.all(writes);

      // 证据 1：任意时刻同一 projectRoot 至多一个 writeMerge 在执行（串行化生效）
      expect(maxInFlight).toBe(1);

      // 证据 2：8 次并发 patch 全部合并进最终文件，没有互相覆盖丢更新
      const layout = svc.loadLayout(tmpRoot);
      expect(Object.keys(layout).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        expect(layout[key]).toEqual({ x: keys.indexOf(key), y: keys.indexOf(key) * 10 });
      }
    } finally {
      (svc as any).writeMerge = originalWriteMerge;
    }
  });

  it('two different projectRoots do not block each other and each gets its own file', async () => {
    const svc = NavLayoutService.getInstance();
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-layout-test-b-'));
    try {
      await Promise.all([
        svc.saveLayoutPatch(tmpRoot, { 'ui/home.hml#view_a': { x: 1, y: 1 } }),
        svc.saveLayoutPatch(rootB, { 'ui/home.hml#view_a': { x: 2, y: 2 } }),
      ]);
      expect(svc.loadLayout(tmpRoot)).toEqual({ 'ui/home.hml#view_a': { x: 1, y: 1 } });
      expect(svc.loadLayout(rootB)).toEqual({ 'ui/home.hml#view_a': { x: 2, y: 2 } });
    } finally {
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });

  it('loadLayout returns an empty object for a project with no layout file', () => {
    const svc = NavLayoutService.getInstance();
    expect(svc.loadLayout(tmpRoot)).toEqual({});
  });

  it('saveLayoutPatch is a no-op for an empty patch (does not create the layout file)', async () => {
    const svc = NavLayoutService.getInstance();
    await svc.saveLayoutPatch(tmpRoot, {});
    expect(fs.existsSync(svc.getLayoutPath(tmpRoot))).toBe(false);
  });
});
