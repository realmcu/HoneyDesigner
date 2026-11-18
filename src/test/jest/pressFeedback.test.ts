/**
 * 按下反馈（组件属性 pressEffect）：曲线参数与 HoneyGUI / LVGL 生成代码的契约
 */
import { Component } from '../../hml/types';
import { collectPressTargets, pressOpacityAt, pressScaleAt, readPressFeedback } from '../../shared/pressFeedback';
import { generateHoneyGuiPressFeedback } from '../../codegen/honeygui/components/PressFeedbackGenerator';
import { generateLvglPressFeedbackHelpers, generateLvglPressFeedbackRegistration } from '../../codegen/lvgl/LvglPressFeedbackGenerator';
import { ViewGenerator } from '../../codegen/honeygui/components/ViewGenerator';

function makeComponent(id: string, type: string, x: number, y: number, width: number, height: number, extra: Partial<Component> = {}): Component {
  return {
    id,
    type: type as any,
    name: id,
    position: { x, y, width, height },
    style: {},
    data: {},
    visible: true,
    enabled: true,
    locked: false,
    zIndex: 0,
    ...extra,
  };
}

/**
 * 宫格：tile1 是开了 pop 的整块卡片，icon2 单独开 press，icon1 / decor 关着。
 * 页面本身没开——开关在组件上。
 */
function makeGrid(viewData: Record<string, any> = {}, overrides: Record<string, Partial<Component>> = {}) {
  const view = makeComponent('apps', 'hg_view', 0, 0, 480, 320, { data: viewData, children: ['tile1', 'icon1', 'tile2', 'icon2', 'decor'] });
  const children = [
    makeComponent('tile1', 'hg_rect', 20, 40, 72, 72, { parent: 'apps', data: { pressEffect: 'pop' } }),
    makeComponent('icon1', 'hg_image', 30, 50, 52, 52, { parent: 'apps' }),
    makeComponent('tile2', 'hg_rect', 120, 40, 72, 72, { parent: 'apps' }),
    makeComponent('icon2', 'hg_image', 130, 50, 44, 30, { parent: 'apps', data: { pressEffect: 'press' } }),
    makeComponent('decor', 'hg_circle', 300, 200, 40, 40, { parent: 'apps' }),
  ].map(c => (overrides[c.id] ? { ...c, ...overrides[c.id] } : c));
  const componentMap = new Map<string, Component>([view, ...children].map(c => [c.id, c]));
  return { view, componentMap };
}

describe('readPressFeedback', () => {
  it('returns null when off or unknown', () => {
    expect(readPressFeedback(undefined)).toBeNull();
    expect(readPressFeedback({})).toBeNull();
    expect(readPressFeedback({ pressEffect: 'none' })).toBeNull();
    expect(readPressFeedback({ pressEffect: 'wobble' })).toBeNull();
  });

  it('defines the two press profiles', () => {
    expect(readPressFeedback({ pressEffect: 'pop' })).toMatchObject({ mode: 'pop', scale: 1.5, opacity: 153, downMs: 80, upMs: 180 });
    expect(readPressFeedback({ pressEffect: 'press' })).toMatchObject({ mode: 'press', scale: 0.96, opacity: 255 });
  });
});

describe('press curves', () => {
  const pop = readPressFeedback({ pressEffect: 'pop' })!;
  const press = readPressFeedback({ pressEffect: 'press' })!;

  it('starts at rest and reaches the pressed look', () => {
    expect(pressScaleAt(pop, 0)).toBe(1);
    expect(pressScaleAt(pop, 255)).toBeCloseTo(1.5);
    expect(pressOpacityAt(pop, 0)).toBe(255);
    expect(pressOpacityAt(pop, 255)).toBe(153);
    expect(pressScaleAt(press, 255)).toBeCloseTo(0.96);
    expect(pressOpacityAt(press, 255)).toBe(255);
  });

  it('eases out and clamps out-of-range progress', () => {
    expect(pressScaleAt(pop, 128)).toBeGreaterThan(1.25);
    expect(pressScaleAt(pop, -50)).toBe(1);
    expect(pressScaleAt(pop, 999)).toBeCloseTo(1.5);
  });
});

describe('collectPressTargets', () => {
  it('takes only the components that opted in, around their own centre', () => {
    const { view, componentMap } = makeGrid();
    const targets = collectPressTargets(view, componentMap.values());
    expect(targets.map(t => t.component.id)).toEqual(['tile1', 'icon2']);
    expect(targets[1].pivot).toEqual([22, 15]);
  });

  it('skips containers even when they carry the flag', () => {
    const { view, componentMap } = makeGrid({ pressEffect: 'pop' });
    expect(collectPressTargets(view, componentMap.values()).map(t => t.component.id)).toEqual(['tile1', 'icon2']);
  });

  it('skips hidden components and components of another view', () => {
    const { view, componentMap } = makeGrid({}, { tile1: { visible: false } });
    componentMap.set('other_icon', makeComponent('other_icon', 'hg_image', 0, 0, 10, 10, { parent: 'other', data: { pressEffect: 'pop' } }));
    expect(collectPressTargets(view, componentMap.values()).map(t => t.component.id)).toEqual(['icon2']);
  });

  it('can skip list entries and engine-unsupported children', () => {
    const { view, componentMap } = makeGrid();
    componentMap.set('row', makeComponent('row', 'hg_list_item', 0, 0, 300, 60, { parent: 'apps' }));
    componentMap.set('row_icon', makeComponent('row_icon', 'hg_image', 0, 0, 30, 30, { parent: 'row', data: { pressEffect: 'pop' } }));
    componentMap.set('chart', makeComponent('chart', 'hg_3d', 0, 0, 30, 30, { parent: 'apps', data: { pressEffect: 'pop' } }));

    const all = collectPressTargets(view, componentMap.values()).map(t => t.component.id);
    expect(all).toEqual(expect.arrayContaining(['row_icon', 'chart']));

    const filtered = collectPressTargets(view, componentMap.values(), {
      skip: c => c.type === 'hg_3d',
      skipInsideListItems: true,
    }).map(t => t.component.id);
    expect(filtered).toEqual(['tile1', 'icon2']);
  });
});

describe('HoneyGUI press feedback', () => {
  it('emits nothing when no component opted in', () => {
    const { view, componentMap } = makeGrid({ pressEffect: 'pop' }, { tile1: { data: {} }, icon2: { data: {} } });
    expect(generateHoneyGuiPressFeedback(view, componentMap, '')).toBeNull();
  });

  it('wraps each opted-in component with its own parameters', () => {
    const { view, componentMap } = makeGrid();
    const code = generateHoneyGuiPressFeedback(view, componentMap, '')!;
    expect(code.helpers).toContain('static const int16_t apps_entrance_press_pivot[][2] = { {36, 36}, {22, 15} };');
    expect(code.helpers).toContain('static const float apps_entrance_press_scale[] = { 1.5000f, 0.9600f };');
    expect(code.helpers).toContain('static const float apps_entrance_press_opa[] = { 0.6000f, 1.0000f };');
    expect(code.helpers).toContain('if (e->code == GUI_EVENT_TOUCH_PRESSED)');

    expect(code.setup).toContain('apps_entrance_press_wrap(0, GUI_BASE(tile1));');
    expect(code.setup).toContain('apps_entrance_press_wrap(1, GUI_BASE(icon2));');
    expect(code.setup).not.toContain('GUI_BASE(icon1)');
    expect(code.setup).not.toContain('GUI_BASE(tile2)');
    expect(code.setup).not.toContain('GUI_BASE(decor)');
    expect(code.setup).toContain('(gui_event_cb_t)apps_entrance_press_touch_cb, GUI_EVENT_TOUCH_RELEASED, NULL);');
  });

  it('runs one time-driven down/hold/up sequence per tap', () => {
    const { view, componentMap } = makeGrid();
    const code = generateHoneyGuiPressFeedback(view, componentMap, '')!;
    // 边沿触发：动画没走完时忽略重复的按下事件（绘制裁剪变化时事件会重复进队）
    expect(code.helpers).toContain('if (apps_entrance_press_state[i] == 0U && apps_entrance_press_armed[i])');
    // 一次触摸只用一次按下：重复进队的 PRESSED 不会再把动画从头拉起
    expect(code.helpers).toContain('apps_entrance_press_armed[i] = 0U;');
    expect(code.helpers).toContain('apps_entrance_press_armed[i] = 1U;');
    // 时间驱动，不靠每帧累加，事件重复也不会来回抖
    expect(code.helpers).toContain('uint32_t t = now - apps_entrance_press_t0[i];');
    expect(code.helpers).toContain('apps_entrance_press_progress[i] = (uint8_t)(t * 255U / apps_entrance_press_down[i]);');
    // 抬手早也先把上升段走完再回落
    expect(code.helpers).toContain('if (apps_entrance_press_released[i])');
    expect(code.helpers).toContain('apps_entrance_press_state[i] = 3U;');
    // 图形控件只认自己的 opacity_value，写回自己的字段才会有变淡
    expect(code.helpers).toContain('((gui_rounded_rect_t *)obj)->opacity_value');
    expect(code.helpers).toContain('((gui_circle_t *)obj)->opacity_value');
    expect(code.helpers).toContain('((gui_img_t *)obj)->opacity_value');
    expect(code.helpers).toContain('apps_entrance_press_set_opa(obj, (uint8_t)((float)apps_entrance_press_opa0[i] * opa));');
    // 落回静止时恢复原透明度（通过 wrap 记录）
    expect(code.helpers).toContain('apps_entrance_press_opa0[i] = apps_entrance_press_get_opa(obj);');
    // 按下时压住邻居：挪到 child_list 队尾（最后画 = 最上层），抬手放回原位
    expect(code.helpers).toContain('gui_list_insert_before(&obj->parent->child_list, &obj->brother_list);');
    expect(code.helpers).toContain('apps_entrance_press_raise(i, (gui_obj_t *)obj);');
    expect(code.helpers).toContain('apps_entrance_press_unraise(i, (gui_obj_t *)obj);');
    expect(code.helpers).toContain('gui_list_insert_before(apps_entrance_press_raised[i], &obj->brother_list);');
    // 切页回来时复位，不会留下放大的图标
    expect(code.setup).toContain('apps_entrance_press_state[0] = 0;');
    expect(code.setup).toContain('apps_entrance_press_released[0] = 0;');
    expect(code.setup).toContain('apps_entrance_press_armed[0] = 1;');
    expect(code.setup).toContain('apps_entrance_press_progress[0] = 0;');
  });

  it('is installed before the entrance wrapper so the entrance can restore it', () => {
    const { view, componentMap } = makeGrid({ entranceAnim: 'fromCenter' });
    const code = new ViewGenerator().generateCreation(view, 0, { componentMap } as any);
    const pressAt = code.indexOf('apps_entrance_press_wrap(0, GUI_BASE(tile1));');
    const entranceAt = code.indexOf('apps_entrance_wrap(0, GUI_BASE(tile1));');
    expect(pressAt).toBeGreaterThanOrEqual(0);
    expect(entranceAt).toBeGreaterThan(pressAt);
  });
});

describe('LVGL press feedback', () => {
  it('uses a style transition on the pressed state', () => {
    const { view, componentMap } = makeGrid();
    const helpers = generateLvglPressFeedbackHelpers(view, componentMap);
    expect(helpers).toContain('static const lv_style_prop_t apps_entrance_press_props[] = { LV_STYLE_TRANSFORM_SCALE, LV_STYLE_OPA, 0 };');

    const registration = generateLvglPressFeedbackRegistration(view, componentMap);
    expect(registration).toContain('lv_style_transition_dsc_init(&apps_entrance_press_tr, apps_entrance_press_props, lv_anim_path_ease_out, 120, 0, NULL);');
    expect(registration).toContain('lv_obj_set_style_transform_scale(tile1, 384, LV_STATE_PRESSED);');
    expect(registration).toContain('lv_obj_set_style_opa(tile1, 153, LV_STATE_PRESSED);');
    expect(registration).toContain('lv_obj_add_flag(tile1, LV_OBJ_FLAG_OVERFLOW_VISIBLE);');
    // press 档不淡出、也不放大，所以没有 opa / overflow
    expect(registration).toContain('lv_obj_set_style_transform_scale(icon2, 246, LV_STATE_PRESSED);');
    expect(registration).not.toContain('lv_obj_set_style_opa(icon2,');
    expect(registration).not.toContain('lv_obj_add_flag(icon2, LV_OBJ_FLAG_OVERFLOW_VISIBLE);');
    expect(registration).not.toContain('icon1');
  });

  it('emits nothing when no component opted in', () => {
    const { view, componentMap } = makeGrid({ pressEffect: 'pop' }, { tile1: { data: {} }, icon2: { data: {} } });
    expect(generateLvglPressFeedbackHelpers(view, componentMap)).toBe('');
    expect(generateLvglPressFeedbackRegistration(view, componentMap)).toBe('');
  });
});
