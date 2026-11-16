/**
 * hg_view 页面入场动画：弹簧曲线、分组，以及 HoneyGUI / LVGL 生成代码的契约
 */
import { Component } from '../../hml/types';
import {
  EntranceOptions,
  ENTRANCE_DEFAULTS,
  groupEntrancePieces,
  planEntrance,
  readEntranceOptions,
  toFixedOffset,
} from '../../shared/entranceAnimation';
import { ViewGenerator } from '../../codegen/honeygui/components/ViewGenerator';
import { generateHoneyGuiViewEntrance } from '../../codegen/honeygui/components/ViewEntranceGenerator';
import { generateLvglEntranceHelpers, generateLvglEntranceRegistration } from '../../codegen/lvgl/LvglEntranceGenerator';
// index 先加载：ListGenerator 与 index 互相引用
import { ComponentGeneratorFactory } from '../../codegen/honeygui/components';
import { ListGenerator } from '../../codegen/honeygui/components/ListGenerator';

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

/** 通知页：两张卡片，每张卡片上有一个文字 */
function makeNotificationView(data: Record<string, any> = { entranceAnim: 'fromBottom' }) {
  const view = makeComponent('notify_view', 'hg_view', 0, 0, 410, 502, { data, children: ['card1', 'title1', 'card2', 'title2'] });
  const children = [
    makeComponent('card1', 'hg_rect', 20, 40, 370, 120, { parent: 'notify_view' }),
    makeComponent('title1', 'hg_label', 40, 60, 200, 30, { parent: 'notify_view' }),
    makeComponent('card2', 'hg_rect', 20, 180, 370, 120, { parent: 'notify_view' }),
    makeComponent('title2', 'hg_label', 40, 200, 200, 30, { parent: 'notify_view' }),
  ];
  const componentMap = new Map<string, Component>([view, ...children].map(c => [c.id, c]));
  return { view, componentMap };
}

const options = (direction: EntranceOptions['direction'], extra: Partial<EntranceOptions> = {}): EntranceOptions =>
  ({ direction, ...ENTRANCE_DEFAULTS, ...extra });

describe('readEntranceOptions', () => {
  it('returns null when the entrance is not enabled', () => {
    expect(readEntranceOptions(undefined)).toBeNull();
    expect(readEntranceOptions({})).toBeNull();
    expect(readEntranceOptions({ entranceAnim: 'none' })).toBeNull();
    expect(readEntranceOptions({ entranceAnim: 'sideways' })).toBeNull();
  });

  it('fills defaults and clamps out-of-range values', () => {
    expect(readEntranceOptions({ entranceAnim: 'fromLeft' })).toEqual(options('fromLeft'));
    const clamped = readEntranceOptions({ entranceAnim: 'fromTop', entranceDuration: 99999, entranceStagger: -5, entranceBounce: '150', entranceFade: 'false' });
    expect(clamped).toEqual({ direction: 'fromTop', duration: 3000, stagger: 0, bounce: 100, fade: false });
  });
});

describe('groupEntrancePieces', () => {
  const pieces = [
    { id: 'card2', x: 0, y: 200, width: 300, height: 100 },
    { id: 'text2', x: 10, y: 210, width: 100, height: 20 },
    { id: 'card1', x: 0, y: 0, width: 300, height: 100 },
    { id: 'icon1', x: 10, y: 10, width: 20, height: 20 },
  ];

  it('moves contained pieces with the card that contains them, top to bottom', () => {
    const groups = groupEntrancePieces(pieces, 'fromBottom').map(g => g.map(p => p.id));
    expect(groups).toEqual([['card1', 'icon1'], ['card2', 'text2']]);
  });

  it('starts from the bottom card when entering from the top', () => {
    const groups = groupEntrancePieces(pieces, 'fromTop').map(g => g[0].id);
    expect(groups).toEqual(['card2', 'card1']);
  });
});

describe('planEntrance', () => {
  const pieces = [
    { id: 'a', x: 20, y: 40, width: 370, height: 120 },
    { id: 'b', x: 20, y: 180, width: 370, height: 120 },
  ];

  const cases: Array<[EntranceOptions['direction'], 'dx' | 'dy', number]> = [
    ['fromBottom', 'dy', 1],
    ['fromTop', 'dy', -1],
    ['fromLeft', 'dx', -1],
    ['fromRight', 'dx', 1],
  ];
  for (const [direction, axis, sign] of cases) {
    it(`${direction} starts outside the chosen edge and settles at 0`, () => {
      const plan = planEntrance(410, 502, pieces, options(direction));
      for (const group of plan.groups) {
        expect(Math.sign(group[axis][0])).toBe(sign);
        expect(group.dx[group.dx.length - 1]).toBe(0);
        expect(group.dy[group.dy.length - 1]).toBe(0);
      }
    });
  }

  it('overshoots with bounce and does not without it', () => {
    const springy = planEntrance(410, 502, pieces, options('fromBottom', { bounce: 100 }));
    const stiff = planEntrance(410, 502, pieces, options('fromBottom', { bounce: 0 }));
    expect(Math.min(...springy.groups[0].dy)).toBeLessThan(-1);
    expect(Math.min(...stiff.groups[0].dy)).toBeGreaterThan(-1);
  });

  it('staggers groups and reports the total duration', () => {
    const plan = planEntrance(410, 502, pieces, options('fromBottom', { stagger: 100 }));
    expect(plan.groups.map(g => g.delay)).toEqual([0, 100]);
    const last = plan.groups[1];
    expect(plan.totalMs).toBeGreaterThanOrEqual(100 + Math.round((last.dx.length - 1) * 1000 / 60));
  });

  it('slows down when the duration grows', () => {
    const fast = planEntrance(410, 502, pieces, options('fromBottom', { duration: 400 }));
    const slow = planEntrance(410, 502, pieces, options('fromBottom', { duration: 1600 }));
    expect(slow.groups[0].dy.length).toBeGreaterThan(fast.groups[0].dy.length);
  });

  it('tilts and scales each card, then settles flat at full size', () => {
    const plan = planEntrance(410, 502, pieces, options('fromBottom'));
    for (const group of plan.groups) {
      expect(Math.abs(group.rot[0])).toBeGreaterThanOrEqual(3);
      expect(group.rot[group.rot.length - 1]).toBe(0);
      expect(group.scale[0]).toBeCloseTo(0.9);
      expect(group.scale[group.scale.length - 1]).toBe(1);
    }
    // 正对抛出点的卡片左右交替倾斜
    expect(Math.sign(plan.groups[0].rot[0])).not.toBe(Math.sign(plan.groups[1].rot[0]));
    const flat = planEntrance(410, 502, pieces, options('fromBottom', { bounce: 0 }));
    expect(flat.groups.every(g => g.rot.every(r => r === 0))).toBe(true);
  });

  it('is deterministic', () => {
    expect(planEntrance(410, 502, pieces, options('fromRight'))).toEqual(planEntrance(410, 502, pieces, options('fromRight')));
  });

  it('stores offsets as 1/8 px fixed point within int16', () => {
    expect(toFixedOffset(1.5)).toBe(12);
    expect(toFixedOffset(1e6)).toBe(32767);
    expect(toFixedOffset(-1e6)).toBe(-32768);
  });
});

describe('HoneyGUI view entrance', () => {
  it('emits nothing when the entrance is off', () => {
    const { view, componentMap } = makeNotificationView({});
    expect(generateHoneyGuiViewEntrance(view, componentMap, '')).toBeNull();
    const code = new ViewGenerator().generateCreation(view, 0, { componentMap } as any);
    expect(code).not.toContain('_entrance');
  });

  it('bakes the tables before switch_in and starts the timer at its end', () => {
    const { view, componentMap } = makeNotificationView();
    const code = new ViewGenerator().generateCreation(view, 0, { componentMap } as any);

    const tablesAt = code.indexOf('static const int16_t notify_view_entrance_track0[][4]');
    const switchInAt = code.indexOf('static void notify_view_switch_in(gui_view_t *view)');
    const setupAt = code.indexOf('// Page entrance animation: fromBottom');
    const endOfSwitchIn = code.indexOf('}\n', code.indexOf('__EVENT_BINDINGS_PLACEHOLDER__'));
    expect(tablesAt).toBeGreaterThanOrEqual(0);
    expect(tablesAt).toBeLessThan(switchInAt);
    expect(setupAt).toBeGreaterThan(code.indexOf('__EVENT_BINDINGS_PLACEHOLDER__'));
    expect(setupAt).toBeLessThan(endOfSwitchIn);

    // 两张卡片 → 两组，文字随卡片
    expect(code).toContain('static const uint16_t notify_view_entrance_obj_group[] = { 0, 0, 1, 1 };');
    expect(code).toContain('notify_view_entrance_wrap(1, GUI_BASE(title1));');
    expect(code).toContain('obj->obj_cb = notify_view_entrance_obj_cb;');
    expect(code).toContain('if (gui_view_get_current() != notify_view_entrance_view)');
    expect(code).toContain('gui_rect_set_opacity((gui_rounded_rect_t *)card1, opacity);');
    // 绕卡片中心倾斜、缩放：title1 的中心点是 card1 的中心相对 title1 左上角
    expect(code).toContain('static const int16_t notify_view_entrance_obj_pivot[][2] = { {185, 60}, {165, 40}, {185, 60}, {165, 40} };');
    expect(code).toContain('matrix_rotate((float)v[2] / 10.0f, obj->matrix);');
    expect(code).toContain('matrix_scale(s, s, obj->matrix);');
  });

  it('animates each list note through the generated note_design', () => {
    const view = makeComponent('feed', 'hg_view', 0, 0, 480, 320, { data: { entranceAnim: 'fromTop' }, children: ['list'] });
    const list = makeComponent('list', 'hg_list', 0, 0, 480, 320, { parent: 'feed', children: ['item0', 'item1', 'item2', 'item3', 'item4'] });
    const items = [0, 1, 2, 3, 4].map(i => makeComponent(`item${i}`, 'hg_list_item', 0, i * 90, 480, 85, { parent: 'list', data: { index: i } }));
    const componentMap = new Map<string, Component>([view, list, ...items].map(c => [c.id, c]));

    const entrance = generateHoneyGuiViewEntrance(view, componentMap, '')!;
    // item4 (y 360) 在列表可视区外，不参与
    expect(entrance.helpers).toContain('static const int16_t feed_entrance_note_index[] = { 0, 1, 2, 3 };');
    expect(entrance.helpers).toContain('static void feed_entrance_note_created(gui_obj_t *obj)');
    expect(entrance.setup).toContain('feed_entrance_note_list[0] = GUI_BASE(list);');
    // 创建列表时已建好的 note 在 setup 里补挂
    expect(entrance.setup).toContain('gui_list_for_each(node, &GUI_BASE(list)->child_list)');
    expect(entrance.setup).toContain('feed_entrance_note_created(note);');

    const note = new ListGenerator().generateNoteDesignCallback(list, { componentMap } as any, type => ComponentGeneratorFactory.getGenerator(type));
    expect(note).toContain('static void feed_entrance_note_created(gui_obj_t *obj);');
    expect(note).toMatch(/default:\n {8}break;\n {4}}\n {4}feed_entrance_note_created\(obj\);\n}/);

    // 卡片堆叠样式：超出列表的项叠在底部显示，也要一起弹入
    componentMap.set('list', { ...list, style: { style: 'LIST_CARD' } });
    const stacked = generateHoneyGuiViewEntrance(view, componentMap, '')!;
    expect(stacked.helpers).toContain('static const int16_t feed_entrance_note_index[] = { 0, 1, 2, 3, 4 };');

    // 用户自己写 note_design：整个列表作为一张卡片
    componentMap.set('list', { ...list, data: { useUserNoteDesign: true, userNoteDesignFunc: 'my_design' } });
    const whole = generateHoneyGuiViewEntrance(view, componentMap, '')!;
    expect(whole.setup).toContain('feed_entrance_wrap(0, GUI_BASE(list));');
    expect(whole.helpers).not.toContain('note_created');
  });

  it('drops the fade helpers when fading is off', () => {
    const { view, componentMap } = makeNotificationView({ entranceAnim: 'fromLeft', entranceFade: false });
    const entrance = generateHoneyGuiViewEntrance(view, componentMap, '')!;
    expect(entrance.helpers).not.toContain('_set_opacity');
    expect(entrance.helpers).not.toContain('_obj_opacity');
    expect(entrance.helpers).not.toContain('uint32_t fade');
  });

  it('skips children that cannot be moved on their own', () => {
    const { view, componentMap } = makeNotificationView();
    componentMap.set('card1', { ...componentMap.get('card1')!, visible: false });
    componentMap.set('card2', { ...componentMap.get('card2')!, type: 'hg_3d' as any });
    const entrance = generateHoneyGuiViewEntrance(view, componentMap, '')!;
    expect(entrance.helpers).toContain('static gui_obj_t *notify_view_entrance_objs[2];');
    expect(entrance.setup).not.toContain('GUI_BASE(card1)');
    expect(entrance.setup).not.toContain('GUI_BASE(card2)');
  });
});

describe('LVGL view entrance', () => {
  it('drives translate and opa from lv_anim on screen load', () => {
    const { view, componentMap } = makeNotificationView({ entranceAnim: 'fromRight' });
    const helpers = generateLvglEntranceHelpers(view, componentMap);
    expect(helpers).toContain('static const uint16_t notify_view_entrance_durations[]');
    expect(helpers).toContain('lv_obj_set_style_translate_x(obj, v[0] / 8, 0);');
    expect(helpers).toContain('lv_obj_set_style_transform_rotation(obj, v[2], 0);');
    expect(helpers).toContain('lv_obj_set_style_transform_pivot_x(obj, notify_view_entrance_obj_pivot[i][0], 0);');
    expect(helpers).toContain('lv_anim_set_exec_cb(&a, notify_view_entrance_exec_cb);');
    expect(helpers).toContain('if (code == LV_EVENT_SCREEN_LOAD_START)');

    const registration = generateLvglEntranceRegistration(view, componentMap);
    expect(registration).toContain('lv_obj_add_event_cb(notify_view, notify_view_entrance_event_cb, LV_EVENT_SCREEN_LOADED, NULL);');
    expect(registration).toContain('if (lv_screen_active() == notify_view)');
  });

  it('emits nothing when the entrance is off', () => {
    const { view, componentMap } = makeNotificationView({});
    expect(generateLvglEntranceHelpers(view, componentMap)).toBe('');
    expect(generateLvglEntranceRegistration(view, componentMap)).toBe('');
  });
});
