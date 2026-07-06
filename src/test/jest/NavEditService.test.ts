import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  NavEditService,
  NavEditHostHooks,
  NavEditPanelAdapter,
  NavEditRequest,
} from '../../designer/NavEditService';
import { HmlSerializer } from '../../hml/HmlSerializer';
import { PendingWriteRegistry } from '../../designer/PendingWriteRegistry';

/**
 * NavEditService 写事务核心测试（对应设计文档 T10）。
 *
 * NavEditService 不 import vscode/DesignerPanel（宿主钩子经依赖注入），可在
 * 纯 Node 环境直调——这里对每一步真实落盘到临时目录并读回 .hml 断言，而不是
 * 只看返回值，符合"看真实产物"的验证纪律。
 */

const CLEAN_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <title>NavEditService fixture</title>
    <project>
      <name>navedit-test</name>
      <resolution>240X240</resolution>
      <pixelMode>RGB565</pixelMode>
    </project>
  </meta>
  <view>
    <hg_view id="view_a" x="0" y="0" w="240" h="240" entry="true">
      <hg_button id="btn_a" x="10" y="10" w="80" h="30" text="Go">
        <events>
          <event type="onClick">
            <action type="switchView" target="view_b" switchOutStyle="SWITCH_OUT_TO_LEFT_USE_TRANSLATION" switchInStyle="SWITCH_IN_FROM_RIGHT_USE_TRANSLATION" />
          </event>
        </events>
      </hg_button>
    </hg_view>
    <hg_view id="view_b" x="0" y="0" w="240" h="240">
    </hg_view>
  </view>
</hml>
`;

const COMMENTED_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <title>NavEditService fixture with comment</title>
    <project>
      <name>navedit-test</name>
      <resolution>240X240</resolution>
      <pixelMode>RGB565</pixelMode>
    </project>
  </meta>
  <view>
    <!-- a human-authored note that the round-trip precheck must catch -->
    <hg_view id="view_a" x="0" y="0" w="240" h="240" entry="true">
      <hg_button id="btn_a" x="10" y="10" w="80" h="30" text="Go">
        <events>
          <event type="onClick">
            <action type="switchView" target="view_b" switchOutStyle="SWITCH_OUT_TO_LEFT_USE_TRANSLATION" switchInStyle="SWITCH_IN_FROM_RIGHT_USE_TRANSLATION" />
          </event>
        </events>
      </hg_button>
    </hg_view>
    <hg_view id="view_b" x="0" y="0" w="240" h="240">
    </hg_view>
  </view>
</hml>
`;

function sha1(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf8').digest('hex');
}

function noOpHooks(overrides: Partial<NavEditHostHooks> = {}): NavEditHostHooks {
  return {
    isFileOpenWithUnsavedChanges: () => false,
    isTextDocumentDirty: () => false,
    getPanelAdapter: () => undefined,
    ...overrides,
  };
}

describe('NavEditService.applyNavEdit', () => {
  let projectRoot: string;
  let filePath: string;
  const relPath = 'ui/home.hml';

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-edit-test-'));
    fs.mkdirSync(path.join(projectRoot, 'ui'), { recursive: true });
    filePath = path.join(projectRoot, relPath);
    fs.writeFileSync(filePath, CLEAN_CONTENT, 'utf-8');
  });

  afterEach(() => {
    // 写事务会在全局单例登记表登记本文件；清掉避免跨用例串扰
    PendingWriteRegistry.getInstance().unregister(filePath);
    fs.rmSync(projectRoot, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('retarget: rewrites the action target and the change is verifiable on disk', async () => {
    const service = new NavEditService(noOpHooks());
    const request: NavEditRequest = {
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(true);
    expect(result.usedFileHistory).toBe(true); // 无面板

    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toMatch(/target="view_a"/);
    expect(written).not.toMatch(/target="view_b"/);
  });

  it('delete: removes the sole action, and the whole eventConfig (and its <events> block) is gone', async () => {
    const service = new NavEditService(noOpHooks());
    const request: NavEditRequest = {
      op: 'delete',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(true);

    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).not.toMatch(/switchView/);
    expect(written).not.toMatch(/<events>/);
  });

  it('create: adds a new switchView action on an event the control did not previously use', async () => {
    const service = new NavEditService(noOpHooks());
    const request: NavEditRequest = {
      op: 'create',
      create: {
        sourceViewKey: `${relPath}#view_b`,
        sourceControlId: 'view_b', // 屏幕本身手势
        eventType: 'onSwipeLeft',
        target: 'view_a',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(true);

    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toMatch(/onSwipeLeft/);
    expect(written).toMatch(/target="view_a"/);
  });

  it('create: rejects when the target event already has a switchView action (eventOccupied)', async () => {
    const service = new NavEditService(noOpHooks());
    const request: NavEditRequest = {
      op: 'create',
      create: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick', // 已经配置了 switchView
        target: 'view_a',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('eventOccupied');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(CLEAN_CONTENT); // 磁盘未动
  });

  it('I1: write succeeds but flags panelResyncFailed when the panel reload throws (disk correct, panel stale)', async () => {
    const adapter: NavEditPanelAdapter = {
      pushUndoSnapshot: () => { /* noop */ },
      reloadFromContent: async () => { throw new Error('panel disposed'); },
    };
    const service = new NavEditService(noOpHooks({ getPanelAdapter: () => adapter }));
    const request: NavEditRequest = {
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(true);
    expect(result.panelResyncFailed).toBe(true);
    expect(result.usedFileHistory).toBeFalsy(); // 有面板，不是文件历史路径
    // 写事务未因面板同步失败而回滚：磁盘已是正确的新内容
    expect(fs.readFileSync(filePath, 'utf-8')).toMatch(/target="view_a"/);
  });

  it('I1: does not flag panelResyncFailed when the panel reload succeeds', async () => {
    const adapter: NavEditPanelAdapter = {
      pushUndoSnapshot: () => { /* noop */ },
      reloadFromContent: async () => { /* resolves */ },
    };
    const service = new NavEditService(noOpHooks({ getPanelAdapter: () => adapter }));
    const request: NavEditRequest = {
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(true);
    expect(result.panelResyncFailed).toBeFalsy();
  });

  it('aborts with fileDirty when the target panel has unsaved in-memory changes', async () => {
    const service = new NavEditService(noOpHooks({ isFileOpenWithUnsavedChanges: () => true }));
    const request: NavEditRequest = {
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('fileDirty');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(CLEAN_CONTENT); // 磁盘未动
  });

  it('aborts with fileDirty when the TextDocument is dirty', async () => {
    const service = new NavEditService(noOpHooks({ isTextDocumentDirty: () => true }));
    const request: NavEditRequest = {
      op: 'delete',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('fileDirty');
  });

  it('aborts with fileChanged when the snapshot hash no longer matches the disk content', async () => {
    const service = new NavEditService(noOpHooks());
    const request: NavEditRequest = {
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1('stale content that does not match disk'),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('fileChanged');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(CLEAN_CONTENT);
  });

  it('rejects timer edges as read-only (timerEdgeReadonly), regardless of other fields', async () => {
    const service = new NavEditService(noOpHooks());
    const request: NavEditRequest = {
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'lbl_timer',
        eventType: 'timer',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceIsTimer: true,
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('timerEdgeReadonly');
  });

  it('locateFailed when the actionIndex/eventConfigIndex no longer points at the expected action', async () => {
    const service = new NavEditService(noOpHooks());
    const request: NavEditRequest = {
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 5, // 越界
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('locateFailed');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(CLEAN_CONTENT);
  });

  it('locateFailed when the control does not belong to the given view (nested-view pruning)', async () => {
    const service = new NavEditService(noOpHooks());
    const request: NavEditRequest = {
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        // btn_a 真实属于 view_a，谎称属于 view_b
        sourceViewKey: `${relPath}#view_b`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('locateFailed');
  });

  it('needsConfirm on a file containing comments; confirmed=true proceeds and applies the edit', async () => {
    fs.writeFileSync(filePath, COMMENTED_CONTENT, 'utf-8');
    const service = new NavEditService(noOpHooks());
    const baseRequest: NavEditRequest = {
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(COMMENTED_CONTENT),
      },
    };

    const firstAttempt = await service.applyNavEdit(baseRequest, projectRoot);
    expect(firstAttempt.success).toBe(false);
    expect(firstAttempt.needsConfirm).toBe(true);
    expect(firstAttempt.confirmReasons).toContain('comments');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(COMMENTED_CONTENT); // 未确认前磁盘不动

    const confirmed = await service.applyNavEdit({ ...baseRequest, confirmed: true }, projectRoot);
    expect(confirmed.success).toBe(true);
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toMatch(/target="view_a"/);
  });

  it('rolls back to the exact original content when the disk write step fails', async () => {
    const service = new NavEditService(noOpHooks());
    // 模拟第 7 步写盘失败：先把磁盘写成垃圾内容，再抛错，验证第 9 步回滚
    // 真的把内容恢复成写前的原文，而不只是"没有进一步破坏"。
    jest
      .spyOn(HmlSerializer.prototype, 'serializeToFile')
      .mockImplementation(async (_doc: any, targetPath: string) => {
        fs.writeFileSync(targetPath, 'CORRUPTED-BY-SIMULATED-FAILURE', 'utf-8');
        throw new Error('simulated disk write failure');
      });

    const request: NavEditRequest = {
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('writeFailed');

    const afterRollback = fs.readFileSync(filePath, 'utf-8');
    expect(afterRollback).toBe(CLEAN_CONTENT); // 逐字节恢复到写前原文
  });

  it("needsConfirm(nameAttributes) still fires when an attribute value containing '>' precedes the name attribute (H2)", async () => {
    // 老实现用 /<tag([^>]*)/ 提取属性，text="a > b" 的 '>' 截断标签，
    // 其后的 name 检测漏报 → 不弹确认直接写盘，静默斩断跨文件 name 引用
    const content = CLEAN_CONTENT.replace(
      '<hg_button id="btn_a" x="10" y="10" w="80" h="30" text="Go">',
      '<hg_button id="btn_a" x="10" y="10" w="80" h="30" text="a > b" name="named_target">'
    );
    fs.writeFileSync(filePath, content, 'utf-8');
    const service = new NavEditService(noOpHooks());

    const result = await service.applyNavEdit({
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(content),
      },
    }, projectRoot);

    expect(result.success).toBe(false);
    expect(result.needsConfirm).toBe(true);
    expect(result.confirmReasons).toContain('nameAttributes');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(content); // 未确认前磁盘不动
  });

  it("needsConfirm(nameAttributes) fires when the name attribute precedes an attribute value containing '>' (H2)", async () => {
    const content = CLEAN_CONTENT.replace(
      '<hg_button id="btn_a" x="10" y="10" w="80" h="30" text="Go">',
      '<hg_button id="btn_a" name="named_target" x="10" y="10" w="80" h="30" text="a > b">'
    );
    fs.writeFileSync(filePath, content, 'utf-8');
    const service = new NavEditService(noOpHooks());

    const result = await service.applyNavEdit({
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(content),
      },
    }, projectRoot);

    expect(result.success).toBe(false);
    expect(result.needsConfirm).toBe(true);
    expect(result.confirmReasons).toContain('nameAttributes');
  });

  it("an attribute value containing '>' alone (no name attribute) does not trigger needsConfirm and the edit applies (H2)", async () => {
    const content = CLEAN_CONTENT.replace(
      'text="Go"',
      'text="a > b"'
    );
    fs.writeFileSync(filePath, content, 'utf-8');
    const service = new NavEditService(noOpHooks());

    const result = await service.applyNavEdit({
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(content),
      },
    }, projectRoot);

    // 不应因引号内容触发 needsConfirm，直接写盘成功
    expect(result.needsConfirm).toBeUndefined();
    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toMatch(/target="view_a"/);
  });

  it('unregisters the pending-write registration when the disk write fails (H1)', async () => {
    const service = new NavEditService(noOpHooks());
    jest
      .spyOn(HmlSerializer.prototype, 'serializeToFile')
      .mockImplementation(async () => {
        throw new Error('simulated disk write failure');
      });

    const result = await service.applyNavEdit({
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    }, projectRoot);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('writeFailed');
    // 失败后登记必须被注销：3s 窗口内真实外部编辑不得被 consumeIfPending 吞掉
    expect(PendingWriteRegistry.getInstance().hasPending(filePath)).toBe(false);
    expect(PendingWriteRegistry.getInstance().consumeIfPending(filePath)).toBe(false);
  });

  it('unregisters the pending-write registration even when the rollback also fails (H1)', async () => {
    const service = new NavEditService(noOpHooks());
    jest
      .spyOn(HmlSerializer.prototype, 'serializeToFile')
      .mockImplementation(async () => {
        throw new Error('simulated disk write failure');
      });
    // 回滚也失败（fs.writeFileSync 在新版 Node 不可 spy，mock 私有 _rollback 返回失败原因）
    jest
      .spyOn(NavEditService.prototype as any, '_rollback')
      .mockReturnValue('simulated rollback failure');

    const result = await service.applyNavEdit({
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    }, projectRoot);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('rollbackFailed');
    expect(PendingWriteRegistry.getInstance().hasPending(filePath)).toBe(false);
  });

  it('keeps the pending-write registration after a successful write (watcher suppression window)', async () => {
    const service = new NavEditService(noOpHooks());
    const result = await service.applyNavEdit({
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    }, projectRoot);

    expect(result.success).toBe(true);
    expect(PendingWriteRegistry.getInstance().hasPending(filePath)).toBe(true);
    // 登记带内容 hash：磁盘就是我们写的内容 → 消费成功（吞掉自写回调）
    expect(PendingWriteRegistry.getInstance().consumeIfPending(filePath)).toBe(true);
  });

  it('releases the watcher reload when an external party rewrites the file after our write (H3)', async () => {
    const service = new NavEditService(noOpHooks());
    const result = await service.applyNavEdit({
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    }, projectRoot);
    expect(result.success).toBe(true);

    // 外部方在 watcher 防抖窗内又写了同一文件（写事务成功后、回调到达前）：
    // 纯时间盲窗会连外部更新一起吞掉；内容校验必须放行重载
    fs.writeFileSync(filePath, CLEAN_CONTENT.replace('text="Go"', 'text="External"'), 'utf-8');
    expect(PendingWriteRegistry.getInstance().consumeIfPending(filePath)).toBe(false);
    expect(PendingWriteRegistry.getInstance().hasPending(filePath)).toBe(false);
  });

  it('aborts with fileDirty when the panel becomes dirty between precheck and write (TOCTOU recheck)', async () => {
    // 第一次（第 1 步前置校验）返回干净，第二次（写盘前紧邻复查）返回 dirty
    const dirtyAnswers = [false, true];
    const service = new NavEditService(noOpHooks({
      isFileOpenWithUnsavedChanges: () => dirtyAnswers.shift() ?? true,
    }));

    const result = await service.applyNavEdit({
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    }, projectRoot);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('fileDirty');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(CLEAN_CONTENT); // 磁盘未动
    expect(PendingWriteRegistry.getInstance().hasPending(filePath)).toBe(false); // 未走到登记
  });

  it('pushes the pre-write snapshot into the panel undo stack and reloads the panel when a panel adapter exists', async () => {
    const pushUndoSnapshot = jest.fn((_content: string) => undefined);
    const reloadFromContent = jest.fn(async (_content: string) => undefined);
    const adapter: NavEditPanelAdapter = { pushUndoSnapshot, reloadFromContent };
    const service = new NavEditService(noOpHooks({ getPanelAdapter: () => adapter }));

    const request: NavEditRequest = {
      op: 'retarget',
      newTarget: 'view_a',
      edge: {
        sourceViewKey: `${relPath}#view_a`,
        sourceControlId: 'btn_a',
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: 'view_b',
        sourceFileHash: sha1(CLEAN_CONTENT),
      },
    };

    const result = await service.applyNavEdit(request, projectRoot);
    expect(result.success).toBe(true);
    expect(result.usedFileHistory).toBe(false); // 有面板，不需要用文件历史撤销
    expect(pushUndoSnapshot).toHaveBeenCalledWith(CLEAN_CONTENT); // 压入的是写前原文
    expect(reloadFromContent).toHaveBeenCalledTimes(1);
    const reloadedWith = reloadFromContent.mock.calls[0][0];
    expect(reloadedWith).toMatch(/target="view_a"/); // 同步内容是写盘后的新内容
  });
});

describe('NavEditService.undoLast', () => {
  let projectRoot: string;
  let filePath: string;
  const relPath = 'ui/home.hml';

  const retargetRequest = (): NavEditRequest => ({
    op: 'retarget',
    newTarget: 'view_a',
    edge: {
      sourceViewKey: `${relPath}#view_a`,
      sourceControlId: 'btn_a',
      eventType: 'onClick',
      eventConfigIndex: 0,
      actionIndex: 0,
      target: 'view_b',
      sourceFileHash: sha1(CLEAN_CONTENT),
    },
  });

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-undo-test-'));
    fs.mkdirSync(path.join(projectRoot, 'ui'), { recursive: true });
    filePath = path.join(projectRoot, relPath);
    fs.writeFileSync(filePath, CLEAN_CONTENT, 'utf-8');
    NavEditService.clearUndoStackForTest();
  });

  afterEach(() => {
    PendingWriteRegistry.getInstance().unregister(filePath);
    fs.rmSync(projectRoot, { recursive: true, force: true });
    NavEditService.clearUndoStackForTest();
    jest.restoreAllMocks();
  });

  it('undo after a successful edit restores the exact original bytes and drains the stack', async () => {
    const service = new NavEditService(noOpHooks());
    const applied = await service.applyNavEdit(retargetRequest(), projectRoot);
    expect(applied.success).toBe(true);
    expect(applied.undoCount).toBe(1);
    expect(fs.readFileSync(filePath, 'utf-8')).toMatch(/target="view_a"/);

    const undone = await service.undoLast();
    expect(undone.success).toBe(true);
    expect(undone.op).toBe('undo');
    expect(undone.undoCount).toBe(0);
    // 逐字节还原（撤销不经序列化器，原文写回）
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(CLEAN_CONTENT);

    // 栈空后再撤销 → invalidRequest
    const again = await service.undoLast();
    expect(again.success).toBe(false);
    expect(again.errorCode).toBe('invalidRequest');
  });

  it('undo aborts with fileChanged and discards the entry when the disk was modified after the edit', async () => {
    const service = new NavEditService(noOpHooks());
    const applied = await service.applyNavEdit(retargetRequest(), projectRoot);
    expect(applied.success).toBe(true);

    // 他方（外部编辑器/AI agent）改动了文件
    const external = fs.readFileSync(filePath, 'utf-8').replace('text="Go"', 'text="Changed"');
    fs.writeFileSync(filePath, external, 'utf-8');

    const undone = await service.undoLast();
    expect(undone.success).toBe(false);
    expect(undone.errorCode).toBe('fileChanged');
    expect(undone.undoCount).toBe(0); // 条目作废，不反复撞同一条
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(external); // 磁盘未被动过
  });

  it('undo aborts with fileDirty without popping when the target panel has unsaved changes', async () => {
    const service = new NavEditService(noOpHooks());
    const applied = await service.applyNavEdit(retargetRequest(), projectRoot);
    expect(applied.success).toBe(true);

    const dirtyService = new NavEditService(noOpHooks({ isFileOpenWithUnsavedChanges: () => true }));
    const undone = await dirtyService.undoLast();
    expect(undone.success).toBe(false);
    expect(undone.errorCode).toBe('fileDirty');
    expect(undone.undoCount).toBe(1); // 不弹栈，保存/放弃后可重试

    // 保存后重试成功
    const retry = await service.undoLast();
    expect(retry.success).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(CLEAN_CONTENT);
  });
});

/**
 * 评审 I9：跨文件写事务 + 撤销栈边界。撤销栈是类级静态全局（跨面板/跨文件），
 * 每条 beforeEach 必须 clearUndoStackForTest 避免串扰。全部真实落盘、读回断言。
 */
describe('NavEditService multi-file transactions & undo stack (I9)', () => {
  let projectRoot: string;
  const relA = 'ui/home.hml';
  const relB = 'ui/settings.hml';

  // 第二个干净文件（无注释/未知标签/name 属性，避免 round-trip 需确认），
  // 自带一条可编辑边 btn_c.onClick → view_d。
  const FILE_B = `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <title>NavEditService fixture B</title>
    <project>
      <name>navedit-test</name>
      <resolution>240X240</resolution>
      <pixelMode>RGB565</pixelMode>
    </project>
  </meta>
  <view>
    <hg_view id="view_c" x="0" y="0" w="240" h="240" entry="true">
      <hg_button id="btn_c" x="10" y="10" w="80" h="30" text="Go">
        <events>
          <event type="onClick">
            <action type="switchView" target="view_d" switchOutStyle="SWITCH_OUT_TO_LEFT_USE_TRANSLATION" switchInStyle="SWITCH_IN_FROM_RIGHT_USE_TRANSLATION" />
          </event>
        </events>
      </hg_button>
    </hg_view>
    <hg_view id="view_d" x="0" y="0" w="240" h="240">
    </hg_view>
  </view>
</hml>
`;

  const absA = () => path.join(projectRoot, relA);
  const absB = () => path.join(projectRoot, relB);

  // 读当前磁盘内容算 hash 构造一条 retarget（快照校验以真实磁盘为准，可链式连续编辑）
  const retargetOn = (
    rel: string, viewId: string, controlId: string, from: string, to: string
  ): NavEditRequest => {
    const content = fs.readFileSync(path.join(projectRoot, rel), 'utf-8');
    return {
      op: 'retarget',
      newTarget: to,
      edge: {
        sourceViewKey: `${rel}#${viewId}`,
        sourceControlId: controlId,
        eventType: 'onClick',
        eventConfigIndex: 0,
        actionIndex: 0,
        target: from,
        sourceFileHash: sha1(content),
      },
    };
  };

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-multi-test-'));
    fs.mkdirSync(path.join(projectRoot, 'ui'), { recursive: true });
    fs.writeFileSync(absA(), CLEAN_CONTENT, 'utf-8');
    fs.writeFileSync(absB(), FILE_B, 'utf-8');
    NavEditService.clearUndoStackForTest();
  });

  afterEach(() => {
    PendingWriteRegistry.getInstance().unregister(absA());
    PendingWriteRegistry.getInstance().unregister(absB());
    fs.rmSync(projectRoot, { recursive: true, force: true });
    NavEditService.clearUndoStackForTest();
    jest.restoreAllMocks();
  });

  it('retarget edits across two different files each land on their own file and share one undo stack', async () => {
    const service = new NavEditService(noOpHooks());

    const editA = await service.applyNavEdit(retargetOn(relA, 'view_a', 'btn_a', 'view_b', 'view_a'), projectRoot);
    const editB = await service.applyNavEdit(retargetOn(relB, 'view_c', 'btn_c', 'view_d', 'view_c'), projectRoot);

    expect(editA.success).toBe(true);
    expect(editB.success).toBe(true);
    // 各写各的文件，互不串扰（A 的 target 变了、B 的没被 A 动过，反之亦然）
    expect(fs.readFileSync(absA(), 'utf-8')).toMatch(/target="view_a"/);
    expect(fs.readFileSync(absA(), 'utf-8')).not.toMatch(/target="view_b"/);
    expect(fs.readFileSync(absB(), 'utf-8')).toMatch(/target="view_c"/);
    expect(fs.readFileSync(absB(), 'utf-8')).not.toMatch(/target="view_d"/);
    // 跨文件共用一个全局撤销栈
    expect(editB.undoCount).toBe(2);
  });

  it('undoes multi-file edits one by one in LIFO order, restoring each file byte-for-byte', async () => {
    const service = new NavEditService(noOpHooks());
    await service.applyNavEdit(retargetOn(relA, 'view_a', 'btn_a', 'view_b', 'view_a'), projectRoot);
    await service.applyNavEdit(retargetOn(relB, 'view_c', 'btn_c', 'view_d', 'view_c'), projectRoot);

    // LIFO：先撤最后一次（B），A 不受影响
    const undo1 = await service.undoLast();
    expect(undo1.success).toBe(true);
    expect(undo1.undoCount).toBe(1);
    expect(fs.readFileSync(absB(), 'utf-8')).toBe(FILE_B);              // B 逐字节还原
    expect(fs.readFileSync(absA(), 'utf-8')).toMatch(/target="view_a"/); // A 仍是编辑后

    // 再撤 A
    const undo2 = await service.undoLast();
    expect(undo2.success).toBe(true);
    expect(undo2.undoCount).toBe(0);
    expect(fs.readFileSync(absA(), 'utf-8')).toBe(CLEAN_CONTENT);       // A 逐字节还原

    // 栈空后再撤失败
    const undo3 = await service.undoLast();
    expect(undo3.success).toBe(false);
    expect(undo3.errorCode).toBe('invalidRequest');
  });

  it('caps the undo stack at 20: the 21st edit evicts the oldest, whose edit is no longer undoable', async () => {
    const service = new NavEditService(noOpHooks());
    // 链式 21 次 retarget（target 递增），栈上限 UNDO_STACK_MAX=20，第 21 次 push 后挤掉最旧
    let current = 'view_b';
    for (let i = 1; i <= 21; i++) {
      const next = `view_t${i}`;
      const res = await service.applyNavEdit(retargetOn(relA, 'view_a', 'btn_a', current, next), projectRoot);
      expect(res.success).toBe(true);
      current = next;
    }
    expect(NavEditService.undoCount).toBe(20);
    expect(fs.readFileSync(absA(), 'utf-8')).toMatch(/target="view_t21"/);

    // 逐个撤销 20 次都成功（LIFO 依次回退 view_t21→…→view_t1）
    for (let i = 0; i < 20; i++) {
      const undo = await service.undoLast();
      expect(undo.success).toBe(true);
    }
    // 第 21 次撤销失败：最旧那条（view_b→view_t1）已被挤掉，无法回到最初的 view_b
    const overflow = await service.undoLast();
    expect(overflow.success).toBe(false);
    expect(overflow.errorCode).toBe('invalidRequest');
    // 文件停在「第 1 次编辑的结果 view_t1」，而非原始 view_b（最旧条目已丢）
    expect(fs.readFileSync(absA(), 'utf-8')).toMatch(/target="view_t1"/);
    expect(fs.readFileSync(absA(), 'utf-8')).not.toMatch(/target="view_b"/);
  });
});
