import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { filterPanelsByProject } from '../../designer/projectPanelFilter';

interface FakePanel {
  name: string;
  filePath: string | undefined;
}

describe('filterPanelsByProject', () => {
  let tmp: string;
  let projectA: string;
  let projectB: string;

  const makeProject = (name: string): string => {
    const root = path.join(tmp, name);
    fs.mkdirSync(path.join(root, 'ui'), { recursive: true });
    fs.writeFileSync(path.join(root, 'project.json'), '{}', 'utf-8');
    return root;
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-filter-test-'));
    projectA = makeProject('projA');
    projectB = makeProject('projB');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const pick = (panels: FakePanel[], root: string, exclude?: string) =>
    filterPanelsByProject(panels, p => p.filePath, root, exclude).map(p => p.name);

  it('同项目的其他面板被选中，发起面板被排除', () => {
    const panels: FakePanel[] = [
      { name: 'home', filePath: path.join(projectA, 'ui', 'home.hml') },
      { name: 'settings', filePath: path.join(projectA, 'ui', 'settings.hml') },
    ];
    expect(pick(panels, projectA, panels[0].filePath)).toEqual(['settings']);
  });

  it('不属于该项目的面板不会被选中', () => {
    const panels: FakePanel[] = [
      { name: 'a', filePath: path.join(projectA, 'ui', 'a.hml') },
      { name: 'b', filePath: path.join(projectB, 'ui', 'b.hml') },
    ];
    expect(pick(panels, projectA)).toEqual(['a']);
    expect(pick(panels, projectB)).toEqual(['b']);
  });

  it('无文件路径或找不到项目根的面板被忽略', () => {
    const orphanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-filter-orphan-'));
    try {
      const panels: FakePanel[] = [
        { name: 'blank', filePath: undefined },
        { name: 'orphan', filePath: path.join(orphanDir, 'x.hml') },
        { name: 'ok', filePath: path.join(projectA, 'ui', 'ok.hml') },
      ];
      expect(pick(panels, projectA)).toEqual(['ok']);
    } finally {
      fs.rmSync(orphanDir, { recursive: true, force: true });
    }
  });

  it('路径大小写/分隔符差异下仍能匹配（Windows 规范化）', () => {
    if (process.platform !== 'win32') { return; }
    const panels: FakePanel[] = [
      { name: 'a', filePath: path.join(projectA, 'ui', 'a.hml').toUpperCase() },
    ];
    expect(pick(panels, projectA.toLowerCase())).toEqual(['a']);
  });
});
