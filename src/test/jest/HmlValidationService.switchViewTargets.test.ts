import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HmlValidationService } from '../../services/HmlValidationService';

/**
 * 规则 10：switchView 悬空跳转目标警告。
 * 语义须与运行时/导航图一致：target 按 view 的 id 或 name 解析,跨文件有效。
 */

const fileWith = (viewId: string, target?: string, viewName?: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <title>t</title>
    <project><name>p</name><resolution>240X240</resolution><pixelMode>RGB565</pixelMode></project>
  </meta>
  <view>
    <hg_view id="${viewId}"${viewName ? ` name="${viewName}"` : ''} x="0" y="0" w="240" h="240" entry="true">
      ${target ? `<hg_button id="btn_go" x="0" y="0" w="10" h="10" text="go">
        <events><event type="onClick"><action type="switchView" target="${target}" /></event></events>
      </hg_button>` : ''}
    </hg_view>
  </view>
</hml>
`;

describe('HmlValidationService switchView dangling-target warnings (rule 10)', () => {
  let projectRoot: string;
  const service = new HmlValidationService();

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hml-target-test-'));
    fs.mkdirSync(path.join(projectRoot, 'ui'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  const targetWarnings = (result: { warnings: Array<{ message: string }> }) =>
    result.warnings.filter(w => w.message.includes('switchView target'));

  it('warns when the target matches no view id or name anywhere in the project', () => {
    const content = fileWith('view_home', 'view_ghost');
    const filePath = path.join(projectRoot, 'ui', 'home.hml');
    fs.writeFileSync(filePath, content, 'utf-8');

    const result = service.validateHml(content, { projectRoot, filePath });
    const warns = targetWarnings(result);
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain('"view_ghost"');
    expect(warns[0].message).toContain('btn_go');
  });

  it('does not warn when the target exists as a view id in another file', () => {
    const content = fileWith('view_home', 'view_other');
    const filePath = path.join(projectRoot, 'ui', 'home.hml');
    fs.writeFileSync(filePath, content, 'utf-8');
    fs.writeFileSync(path.join(projectRoot, 'ui', 'other.hml'),
      fileWith('view_other'), 'utf-8');

    const result = service.validateHml(content, { projectRoot, filePath });
    expect(targetWarnings(result)).toHaveLength(0);
  });

  it('does not warn when the target matches another view by NAME (runtime resolves by registered name)', () => {
    const content = fileWith('view_home', 'ScreenB');
    const filePath = path.join(projectRoot, 'ui', 'home.hml');
    fs.writeFileSync(filePath, content, 'utf-8');
    fs.writeFileSync(path.join(projectRoot, 'ui', 'b.hml'),
      fileWith('view_b_id', undefined, 'ScreenB'), 'utf-8');

    const result = service.validateHml(content, { projectRoot, filePath });
    expect(targetWarnings(result)).toHaveLength(0);
  });

  it('resolves same-file targets without needing projectRoot', () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <title>t</title>
    <project><name>p</name><resolution>240X240</resolution><pixelMode>RGB565</pixelMode></project>
  </meta>
  <view>
    <hg_view id="view_a" x="0" y="0" w="240" h="240" entry="true">
      <hg_button id="btn_go" x="0" y="0" w="10" h="10" text="go">
        <events><event type="onClick"><action type="switchView" target="view_b" /></event></events>
      </hg_button>
    </hg_view>
    <hg_view id="view_b" x="0" y="0" w="240" h="240"></hg_view>
  </view>
</hml>
`;
    const result = service.validateHml(content, {});
    expect(targetWarnings(result)).toHaveLength(0);
  });

  it('warns for dangling switchView targets inside timers too', () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <title>t</title>
    <project><name>p</name><resolution>240X240</resolution><pixelMode>RGB565</pixelMode></project>
  </meta>
  <view>
    <hg_view id="view_a" x="0" y="0" w="240" h="240" entry="true">
      <hg_label id="lbl_t" x="0" y="0" w="10" h="10" text="x" timers='[{"id":"t1","enabled":true,"mode":"preset","interval":1000,"actions":[{"type":"switchView","target":"view_ghost"}]}]' />
    </hg_view>
  </view>
</hml>
`;
    const result = service.validateHml(content, {});
    const warns = targetWarnings(result);
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain('"view_ghost"');
    expect(warns[0].message).toContain('timer');
  });
});
