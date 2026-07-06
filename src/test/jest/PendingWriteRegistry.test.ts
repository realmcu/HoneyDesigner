import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PendingWriteRegistry } from '../../designer/PendingWriteRegistry';

/**
 * PendingWriteRegistry 登记表单元测试（T8 时间窗/宽限期语义 + H3 内容校验）。
 *
 * 时间语义用注入时钟做确定性推进；内容校验（hash 比对）真实落盘到临时目录
 * 读回验证——watcher 抑制不再是纯时间盲窗：外部方在防抖窗内改写同一文件时
 * （磁盘 hash 与登记 hash 不一致），consumeIfPending 必须放行重载。
 */
describe('PendingWriteRegistry', () => {
  describe('time-window semantics (injected clock)', () => {
    function makeRegistry(startAt = 0) {
      let now = startAt;
      const registry = new PendingWriteRegistry({
        windowMs: 3000,
        graceMs: 750,
        now: () => now,
      });
      return { registry, advance: (ms: number) => { now += ms; } };
    }
    const file = path.join(os.tmpdir(), 'pwr-fake.hml'); // 纯时间窗用例不读盘

    it('consumes a registration within the window and suppresses duplicates within the grace period', () => {
      const { registry, advance } = makeRegistry();
      registry.register(file);
      expect(registry.consumeIfPending(file)).toBe(true); // 首次命中即消费
      advance(500);
      expect(registry.consumeIfPending(file)).toBe(true); // 宽限期内重复回调继续抑制
    });

    it('treats a hit after the grace period as a new external change (release + reload)', () => {
      const { registry, advance } = makeRegistry();
      registry.register(file);
      expect(registry.consumeIfPending(file)).toBe(true);
      advance(751);
      expect(registry.consumeIfPending(file)).toBe(false); // 宽限期外：删除条目并放行
      expect(registry.hasPending(file)).toBe(false);
    });

    it('expires a registration after the window', () => {
      const { registry, advance } = makeRegistry();
      registry.register(file);
      advance(3001);
      expect(registry.consumeIfPending(file)).toBe(false);
    });

    it('unregister removes the entry immediately', () => {
      const { registry } = makeRegistry();
      registry.register(file);
      registry.unregister(file);
      expect(registry.consumeIfPending(file)).toBe(false);
    });

    it('re-registering resets the window and the consumed flag', () => {
      const { registry, advance } = makeRegistry();
      registry.register(file);
      expect(registry.consumeIfPending(file)).toBe(true);
      advance(2000);
      registry.register(file); // 重登记：清除已消费标记
      advance(2000); // 距首次登记已 4s，但距重登记只 2s
      expect(registry.consumeIfPending(file)).toBe(true);
    });
  });

  describe('content-hash verification (H3, real files)', () => {
    let dir: string;
    let file: string;
    const ownContent = '<hml>written by the host transaction</hml>';

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwr-test-'));
      file = path.join(dir, 'home.hml');
      fs.writeFileSync(file, ownContent, 'utf-8');
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('consumes when the disk content is exactly what we registered', () => {
      const registry = new PendingWriteRegistry();
      registry.register(file, PendingWriteRegistry.hashContent(ownContent));
      expect(registry.consumeIfPending(file)).toBe(true);
    });

    it('releases the reload when an external party rewrote the file inside the window', () => {
      const registry = new PendingWriteRegistry();
      registry.register(file, PendingWriteRegistry.hashContent(ownContent));
      // 外部方（AI agent / git）在 watcher 防抖窗内又写了同一文件：
      // 两次写事件合并成一次回调——不得吞掉外部更新
      fs.writeFileSync(file, '<hml>rewritten externally</hml>', 'utf-8');
      expect(registry.consumeIfPending(file)).toBe(false);
      expect(registry.hasPending(file)).toBe(false); // 条目已删除
    });

    it('hash mismatch releases the reload even inside the consume grace period', () => {
      let now = 0;
      const registry = new PendingWriteRegistry({ now: () => now });
      registry.register(file, PendingWriteRegistry.hashContent(ownContent));
      expect(registry.consumeIfPending(file)).toBe(true); // 首次：磁盘一致，吞
      now += 100; // 仍在宽限期内
      fs.writeFileSync(file, '<hml>rewritten externally</hml>', 'utf-8');
      expect(registry.consumeIfPending(file)).toBe(false); // 内容校验优先于宽限期
    });

    it('treats a disk read failure as a mismatch (prefer reloading over swallowing)', () => {
      const registry = new PendingWriteRegistry({
        readFileText: () => { throw new Error('simulated read failure'); },
      });
      registry.register(file, PendingWriteRegistry.hashContent(ownContent));
      expect(registry.consumeIfPending(file)).toBe(false);
    });

    it('a hash-less registration keeps the legacy time-window behavior', () => {
      const registry = new PendingWriteRegistry();
      registry.register(file); // 不带 hash：退化为纯时间窗
      fs.writeFileSync(file, '<hml>rewritten externally</hml>', 'utf-8');
      expect(registry.consumeIfPending(file)).toBe(true); // 盲窗语义保持不变
    });
  });
});
