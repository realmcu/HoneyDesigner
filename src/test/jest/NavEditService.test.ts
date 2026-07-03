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
