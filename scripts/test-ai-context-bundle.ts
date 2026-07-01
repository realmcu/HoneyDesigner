import assert from 'assert';
import { composeAiBundle, absolutePositionOf } from '../src/designer/aiContextBundle';
import type { Component } from '../src/hml/types';
import type { I18nCatalog } from '../src/project-i18n/types';

function comp(partial: Partial<Component>): Component {
  return {
    id: 'x', type: 'hg_view', name: 'x',
    position: { x: 0, y: 0, width: 10, height: 10 },
    visible: true, enabled: true, locked: false, zIndex: 0,
    ...partial,
  } as Component;
}

const catalog: I18nCatalog = {
  version: 1, defaultLocale: 'zh-CN', locales: ['zh-CN', 'en-US'],
  strings: { greeting: { 'zh-CN': '你好', 'en-US': 'Hello' } },
};

// 1) 绝对坐标：子组件叠加父容器偏移
const view = comp({ id: 'MainView', type: 'hg_view', position: { x: 0, y: 0, width: 200, height: 200 } });
const label = comp({
  id: 'lbl_title', type: 'hg_label', name: 'lbl_title', parent: 'MainView',
  position: { x: 27, y: 40, width: 120, height: 30 },
  data: { i18nKey: 'greeting', fontSize: 24, color: '#FFFFFF' } as any,
});
const components = [view, label];
assert.deepStrictEqual(absolutePositionOf(components, label), { x: 27, y: 40 });

// 2) 选中项：英文文案 + 绝对几何 + 关键属性
const selected = composeAiBundle({
  components, selectedIds: ['lbl_title'],
  hmlRelPath: 'ui/Main.hml', screenshotAbsPath: 'C:\\p\\.honeygui\\ai-context\\selection-1.png',
  catalog,
});
assert.ok(selected.includes('file: ui/Main.hml'), 'has hml path');
assert.ok(selected.includes('selection-1.png'), 'has screenshot path');
assert.ok(selected.includes('Pointed controls:'), 'has pointed header');
assert.ok(selected.includes('lbl_title (hg_label)'), 'has id/type');
assert.ok(selected.includes('parent=MainView'), 'has parent');
assert.ok(selected.includes('x=27 y=40 w=120 h=30'), 'has geometry');
assert.ok(selected.includes('text="Hello"'), 'resolves english text');
assert.ok(selected.includes('fontSize=24'), 'has salient prop');

// 3) 空选中：整颗组件树
const whole = composeAiBundle({
  components, selectedIds: [],
  hmlRelPath: 'ui/Main.hml', screenshotAbsPath: 'C:\\p\\shot.png', catalog,
});
assert.ok(whole.includes('Full component tree:'), 'whole-tree header');
assert.ok(whole.includes('MainView (hg_view)'), 'lists root');
assert.ok(whole.includes('lbl_title (hg_label)'), 'lists child');

console.log('OK test-ai-context-bundle');
