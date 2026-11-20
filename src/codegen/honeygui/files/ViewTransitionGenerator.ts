/**
 * 自定义页面转场（纵深缩放 / 底部弹层 / 圆形揭示）的 HoneyGUI 代码
 *
 * 共享元素：两个页面里标记了同一个名字的控件，切换时旧页那个先藏起来，新页那个从旧页
 * 控件的位置、大小飞到自己该在的位置（飞行在页面自身的基础上叠加，页面缩放时跟着一起动）。
 *
 * 引擎切换时旧页、新页都用 SWITCH_INIT_STATE：引擎不动两页，新页插在旧页后面盖住它。
 * 然后把两页的 obj_cb 包一层，每帧按时间改写各自的 matrix 和透明度：
 * - matrix 在原回调之前改：gui_view_prepare 会把 obj->matrix 拷给背景图（bg_img）；
 * - 透明度在原回调之后改：gui_view_prepare 每帧把 opacity_value 重置成 view->opacity。
 *
 * 引擎按帧推进切换（每帧 g_Release += animate_step），帧率不同完成时机就不同。这里在动画
 * 播完之前把旧页的 animate_step 压成 0，播完那一帧再给满屏高，引擎在同一帧完成切换、释放旧页，
 * 动画和切换严格对齐。
 *
 * 动画时钟从第一帧开始走，每帧最多前进 HG_VT_MAX_FRAME_MS：新页第一帧要建控件、栅格化，
 * 模拟器上常常要几百毫秒；按墙钟算的话第一帧出来动画已经播完，看上去就是直接切过去。
 * 帧率低时宁可放慢，也要每一帧都看得到（和引擎自带的按帧步进一样）。
 *
 * 只在工程里用到预设时才生成，放在 generated/auto_generated_bindings.c 里，各页面共用。
 */
import {
  VIEW_TRANSITION_NAMES,
  VIEW_TRANSITION_PRESETS,
  VIEW_TRANSITION_PROFILES,
  ViewTransitionPreset,
  EASE_OUT_BACK_OVERSHOOT,
  engineSwitchStyles,
  readViewTransition,
} from '../../../shared/viewTransition';
import { collectSharedElementPairs, SharedElementCandidate } from '../../../shared/sharedElement';
import { SPRING_OMEGA, TransitionCurve } from '../../../shared/viewTransition';

/** C 里的曲线编号 */
function curveId(curve: TransitionCurve): number {
  return curve === 'spring' ? 2 : (curve === 'easeOutBack' ? 1 : 0);
}

/** 共享元素飞行占整段动画的比例：飞完再让页面收尾 */
const HERO_END = 0.8;

/** 一对共享元素在 C 里的样子：两个页面 + 各自的控件名（顺序不定，切换时按方向取） */
export interface ViewTransitionSharedPair {
  tag: string;
  viewA: string;
  objA: string;
  viewB: string;
  objB: string;
}

/** 从一个 HML 文件的所有组件里挑出跨页面的共享元素对 */
export function collectViewTransitionSharedPairs(components: readonly SharedElementCandidate[]): ViewTransitionSharedPair[] {
  return collectSharedElementPairs(components).map(pair => ({
    tag: pair.tag,
    viewA: pair.a.view.name,
    objA: pair.a.component.name,
    viewB: pair.b.view.name,
    objB: pair.b.component.name,
  }));
}

const DEFAULT_SWITCH_OUT = 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION';
const DEFAULT_SWITCH_IN = 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION';

/** C 里的预设编号宏 */
export function viewTransitionMacro(preset: ViewTransitionPreset): string {
  return `HG_VIEW_TRANSITION_${preset.replace(/^SWITCH_IN_/, '')}`;
}

/**
 * switchView 动作的切换语句（点击、消息、按键、定时器等直接切换的场景）。
 * 预设走 hg_view_transition_switch，其它照旧 gui_view_switch_direct。
 */
export function honeyGuiSwitchViewLine(
  targetName: string,
  switchOutStyle: string | undefined,
  switchInStyle: string | undefined,
  indent: string,
): string {
  const preset = readViewTransition(switchInStyle);
  if (preset) {
    return `${indent}hg_view_transition_switch("${targetName}", ${viewTransitionMacro(preset)});\n`;
  }
  const out = switchOutStyle || DEFAULT_SWITCH_OUT;
  const inStyle = switchInStyle || DEFAULT_SWITCH_IN;
  return `${indent}gui_view_switch_direct(gui_view_get_current(), "${targetName}", ${out}, ${inStyle});\n`;
}

/**
 * 滑动手势（gui_view_switch_on_event）由引擎跟手拖动，自定义播放接不进去，
 * 预设降级为最接近的引擎样式
 */
export function honeyGuiSwitchOnEventStyles(
  switchOutStyle: string | undefined,
  switchInStyle: string | undefined,
): { out: string; in: string } {
  return engineSwitchStyles(switchOutStyle || DEFAULT_SWITCH_OUT, switchInStyle || DEFAULT_SWITCH_IN);
}

/** 组件数据里任何位置写了预设（事件动作、宫格菜单图标动作、定时器动作……） */
export function usesViewTransition(components: unknown): boolean {
  const json = JSON.stringify(components ?? null);
  return VIEW_TRANSITION_NAMES.some(name => json.includes(`"${name}"`));
}

function f(value: number): string {
  return `${value.toFixed(4)}f`;
}

export function generateViewTransitionHeader(): string {
  let code = `// Designer view transitions (switchInStyle presets)\n`;
  for (const preset of VIEW_TRANSITION_PRESETS) {
    code += `#define ${viewTransitionMacro(preset)} ${VIEW_TRANSITION_PROFILES[preset].id}\n`;
  }
  code += `void hg_view_transition_switch(const char *target, uint8_t preset);\n\n`;
  return code;
}

/** 新页的子控件逐个进场：每个孩子自己的时间片，不是整页一起动 */
function generateStaggerFuncs(): string {
  return `#define HG_VT_CHILD_MAX 8

static bool hg_vt_is_hero_obj(gui_obj_t *obj);

typedef struct
{
    gui_obj_t *obj;
    void (*orig)(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type);
    uint8_t pre;
    uint8_t destroy;
    uint8_t index;
} hg_vt_child_t;

static hg_vt_child_t hg_vt_children[HG_VT_CHILD_MAX];
static uint8_t hg_vt_child_count;

static hg_vt_child_t *hg_vt_child_entry(gui_obj_t *obj)
{
    for (uint8_t i = 0; i < hg_vt_child_count; i++)
    {
        if (hg_vt_children[i].obj == obj)
        {
            return &hg_vt_children[i];
        }
    }
    return NULL;
}

/* Each child rises and fades in on its own slice, back to front */
static void hg_vt_child_cb(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type)
{
    hg_vt_child_t *entry = hg_vt_child_entry(obj);
    void (*orig)(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type) = (entry != NULL) ? entry->orig : NULL;
    if (cb_type == OBJ_DESTROY)
    {
        bool call = (entry != NULL) && (entry->destroy != 0U);
        if (entry != NULL)
        {
            entry->obj = NULL;
        }
        if (call && orig != NULL)
        {
            orig(obj, cb_type);
        }
        return;
    }
    if (cb_type != OBJ_PRE_PROCESS || entry == NULL || hg_vt_t <= 0.0f || hg_vt_t >= 1.0f)
    {
        if (orig != NULL)
        {
            orig(obj, cb_type);
        }
        return;
    }
    const hg_vt_profile_t *p = hg_vt_profile;
    float step = p->stag_step;
    if (hg_vt_child_count > 1U)
    {
        /* Squeeze the steps so the last child still lands inside the animation */
        float room = 1.0f - p->stag_start - p->stag_window;
        float fit = (room > 0.0f) ? room / (float)(hg_vt_child_count - 1U) : 0.0f;
        if (fit < step)
        {
            step = fit;
        }
    }
    float start = p->stag_start + step * (float)entry->index;
    float e = hg_vt_ease(hg_vt_window(hg_vt_t, start, start + p->stag_window), 0U);
    matrix_translate(0.0f, -(1.0f - e) * p->stag_slide, obj->matrix);
    if (orig != NULL)
    {
        orig(obj, cb_type);
    }
    obj->opacity_value = (uint8_t)((float)obj->opacity_value * e);
}

static void hg_vt_children_begin(gui_view_t *page)
{
    gui_node_list_t *node = NULL;
    hg_vt_child_count = 0U;
    if (hg_vt_profile == NULL || hg_vt_profile->stag_step <= 0.0f)
    {
        return;
    }
    gui_list_for_each(node, &GUI_BASE(page)->child_list)
    {
        if (hg_vt_child_count >= HG_VT_CHILD_MAX)
        {
            break;
        }
        gui_obj_t *obj = gui_list_entry(node, gui_obj_t, brother_list);
        if (hg_vt_is_hero_obj(obj))
        {
            continue;
        }
        hg_vt_child_t *entry = &hg_vt_children[hg_vt_child_count];
        entry->obj = obj;
        entry->orig = obj->obj_cb;
        entry->pre = (uint8_t)obj->has_pre_process_cb;
        entry->destroy = (uint8_t)obj->has_destroy_cb;
        entry->index = hg_vt_child_count;
        obj->obj_cb = hg_vt_child_cb;
        obj->has_pre_process_cb = true;
        obj->has_destroy_cb = true;
        hg_vt_child_count++;
    }
}

static void hg_vt_children_release(void)
{
    for (uint8_t i = 0; i < hg_vt_child_count; i++)
    {
        gui_obj_t *obj = hg_vt_children[i].obj;
        if (obj == NULL)
        {
            continue;
        }
        obj->obj_cb = hg_vt_children[i].orig;
        obj->has_pre_process_cb = (hg_vt_children[i].pre != 0U);
        obj->has_destroy_cb = (hg_vt_children[i].destroy != 0U);
    }
    hg_vt_child_count = 0U;
}

`;
}

/** 有共享元素时才生成的飞行代码 */
function generateHeroFuncs(): string {
  return `/* Absolute position on screen: parents' offsets added up */
static void hg_vt_abs_pos(gui_obj_t *obj, int *x, int *y)
{
    *x = 0;
    *y = 0;
    while (obj != NULL)
    {
        *x += obj->x;
        *y += obj->y;
        obj = obj->parent;
    }
}

static bool hg_vt_hero_active(void)
{
    return hg_vt_hero != NULL;
}

/* The carried element drives itself, keep it out of the per-child stagger */
static bool hg_vt_is_hero_obj(gui_obj_t *obj)
{
    return obj == hg_vt_hero;
}

static void hg_vt_hero_release(void)
{
    if (hg_vt_hero == NULL)
    {
        return;
    }
    hg_vt_hero->obj_cb = hg_vt_hero_orig;
    hg_vt_hero->has_pre_process_cb = hg_vt_hero_pre;
    hg_vt_hero->has_destroy_cb = hg_vt_hero_destroy;
    hg_vt_hero = NULL;
}

static void hg_vt_hero_release_source(void)
{
    if (hg_vt_hero_src != NULL)
    {
        gui_obj_hidden(hg_vt_hero_src, false);
        hg_vt_hero_src = NULL;
    }
}

/* Fly the new page's copy from the old copy's rect to its own, a bit ahead of the page */
static void hg_vt_hero_cb(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type)
{
    void (*orig)(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type) = hg_vt_hero_orig;
    if (cb_type == OBJ_DESTROY)
    {
        bool call = hg_vt_hero_destroy;
        hg_vt_hero = NULL;
        if (call && orig != NULL)
        {
            orig(obj, cb_type);
        }
        return;
    }
    if (cb_type != OBJ_PRE_PROCESS || hg_vt_hero == NULL)
    {
        if (orig != NULL)
        {
            orig(obj, cb_type);
        }
        return;
    }
    /* Move first, grow after: the element lands, then takes its new size */
    float e_pos = hg_vt_ease(hg_vt_window(hg_vt_t, 0.0f, 0.6f), 0U);
    float e_scale = hg_vt_ease(hg_vt_window(hg_vt_t, 0.15f, HG_VT_HERO_END), hg_vt_profile->to_curve);
    float s = hg_vt_hero_scale + (1.0f - hg_vt_hero_scale) * e_scale;
    float bow = sinf(3.14159265f * e_pos);
    float dx = (float)hg_vt_hero_dx * (1.0f - e_pos) + (float)hg_vt_hero_arc_x * bow;
    float dy = (float)hg_vt_hero_dy * (1.0f - e_pos) + (float)hg_vt_hero_arc_y * bow;
    matrix_translate(obj->w * 0.5f + dx, obj->h * 0.5f + dy, obj->matrix);
    matrix_scale(s, s, obj->matrix);
    matrix_translate(-obj->w * 0.5f, -obj->h * 0.5f, obj->matrix);
    /* The page fades in around it; while flying the carried element stays solid */
    if (hg_vt_t < HG_VT_HERO_END)
    {
        obj->opacity_value = 255;
    }
    if (orig != NULL)
    {
        orig(obj, cb_type);
    }
}

/* Find the pair for this switch: hide the old copy, wrap the new one */
static void hg_vt_hero_begin(gui_view_t *from, gui_view_t *to, const char *target)
{
    const char *from_name = GUI_BASE(from)->name;
    for (uint32_t i = 0; i < HG_VT_SHARED_COUNT; i++)
    {
        const hg_vt_shared_t *pair = &hg_vt_shared[i];
        const char *src_name;
        const char *dst_name;
        if (strcmp(pair->view_a, from_name) == 0 && strcmp(pair->view_b, target) == 0)
        {
            src_name = pair->obj_a;
            dst_name = pair->obj_b;
        }
        else if (strcmp(pair->view_b, from_name) == 0 && strcmp(pair->view_a, target) == 0)
        {
            src_name = pair->obj_b;
            dst_name = pair->obj_a;
        }
        else
        {
            continue;
        }
        gui_obj_t *src = gui_obj_get_handle(GUI_BASE(from), src_name);
        gui_obj_t *dst = gui_obj_get_handle(GUI_BASE(to), dst_name);
        if (src == NULL || dst == NULL || src == dst ||
            src->w <= 0 || src->h <= 0 || dst->w <= 0 || dst->h <= 0)
        {
            continue;
        }
        int ax;
        int ay;
        int bx;
        int by;
        hg_vt_abs_pos(src, &ax, &ay);
        hg_vt_abs_pos(dst, &bx, &by);
        /* The copy scales around its centre, so line the centres up, not the corners */
        hg_vt_hero_dx = (int16_t)((ax + src->w / 2) - (bx + dst->w / 2));
        hg_vt_hero_dy = (int16_t)((ay + src->h / 2) - (by + dst->h / 2));
        {
            /* Bow the path sideways a little so it does not read as a straight slide */
            float len = sqrtf((float)hg_vt_hero_dx * (float)hg_vt_hero_dx +
                              (float)hg_vt_hero_dy * (float)hg_vt_hero_dy);
            float bow = len * 0.22f;
            if (bow > 48.0f)
            {
                bow = 48.0f;
            }
            if (len < 1.0f)
            {
                hg_vt_hero_arc_x = 0;
                hg_vt_hero_arc_y = 0;
            }
            else
            {
                hg_vt_hero_arc_x = (int16_t)(-(float)hg_vt_hero_dy / len * bow);
                hg_vt_hero_arc_y = (int16_t)((float)hg_vt_hero_dx / len * bow);
            }
        }
        /* Uniform scale: use the smaller of the two ratios so the copy never
           starts larger than the old widget in either direction */
        float ratio_w = (float)src->w / (float)dst->w;
        float ratio_h = (float)src->h / (float)dst->h;
        hg_vt_hero_scale = (ratio_w < ratio_h) ? ratio_w : ratio_h;
        hg_vt_hero_src = src;
        hg_vt_hero = dst;
        hg_vt_hero_orig = dst->obj_cb;
        hg_vt_hero_pre = dst->has_pre_process_cb;
        hg_vt_hero_destroy = dst->has_destroy_cb;
        dst->obj_cb = hg_vt_hero_cb;
        dst->has_pre_process_cb = true;
        dst->has_destroy_cb = true;
        gui_obj_hidden(src, true);
        return;
    }
}

`;
}

/** 没有共享元素时的空实现，调用处不用写条件编译 */
function generateHeroStubs(): string {
  return `static void hg_vt_hero_begin(gui_view_t *from, gui_view_t *to, const char *target)
{
    GUI_UNUSED(from);
    GUI_UNUSED(to);
    GUI_UNUSED(target);
}

static bool hg_vt_hero_active(void)
{
    return false;
}

static bool hg_vt_is_hero_obj(gui_obj_t *obj)
{
    GUI_UNUSED(obj);
    return false;
}

static void hg_vt_hero_release(void)
{
}

static void hg_vt_hero_release_source(void)
{
}

`;
}

export function generateViewTransitionSource(sharedPairs: ViewTransitionSharedPair[] = []): string {
  const presets = [...VIEW_TRANSITION_PRESETS].sort(
    (a, b) => VIEW_TRANSITION_PROFILES[a].id - VIEW_TRANSITION_PROFILES[b].id,
  );
  const n = presets.length;
  const hero = sharedPairs.length > 0;

  let code = `/* Designer view transitions: the old and the new page animate together.
 * The engine switches with SWITCH_INIT_STATE on both sides (the old page stays put underneath,
 * the new page covers it); the wrapped obj_cb rewrites each page's matrix and opacity by time.
 * The old page's animate_step is held at 0 until the animation is over, so the engine finishes
 * the switch (and frees the old page) on exactly the last frame. */
#include <math.h>
#include <string.h>
#include "gui_obj.h"
#include "gui_obj_tree.h"
#include "gui_view.h"
#include "gui_api_os.h"
#include "gui_fb.h"
#include "gui_matrix.h"
#include "gui_circle.h"
#include "tp_algo.h"

typedef struct
{
    uint16_t duration;
    uint8_t from_curve;     /* 0 = ease-out, 1 = ease-out-back, 2 = spring */
    uint8_t to_curve;       /* only the new page bounces */
    float from_scale;       /* old page at the end */
    float from_opa;
    float to_scale;         /* new page at the start */
    float to_opa;
    float to_offset_y;      /* share of the screen height */
    float fade_start;       /* new page fade-in window (share of the duration) */
    float fade_end;
    float circle_start;     /* reveal circle window; circle_end <= circle_start: no circle */
    float circle_end;
    float stag_start;       /* children come in one by one: first start, step, length, rise */
    float stag_step;
    float stag_window;
    float stag_slide;
} hg_vt_profile_t;

static const hg_vt_profile_t hg_vt_profiles[${n}] =
{
`;
  for (const preset of presets) {
    const p = VIEW_TRANSITION_PROFILES[preset];
    const circle = p.circle ?? [0, 0];
    const stag = p.stagger ?? { start: 0, step: 0, window: 0, slide: 0 };
    code += `    /* ${viewTransitionMacro(preset)} */\n`;
    code += `    { ${p.durationMs}, ${curveId(p.curve)}, ${curveId(p.toCurve ?? p.curve)}, ${f(p.fromScale)}, ${f(p.fromOpacity)}, ${f(p.toScale)}, ${f(p.toOpacity)}, ${f(p.toOffsetY)}, ${f(p.toFade[0])}, ${f(p.toFade[1])}, ${f(circle[0])}, ${f(circle[1])}, ${f(stag.start)}, ${f(stag.step)}, ${f(stag.window)}, ${f(stag.slide)} },\n`;
  }
  code += `};

#define HG_VT_MAX_FRAME_MS 33U
#define HG_VT_HERO_END ${f(HERO_END)}
#define HG_VT_HERO_DIM 0.35f
#define HG_VT_SPRING_OMEGA ${SPRING_OMEGA.toFixed(4)}f
`;
  if (hero) {
    code += `
/* Shared elements: a widget in each of the two pages carrying the same tag */
typedef struct
{
    const char *tag;
    const char *view_a;
    const char *obj_a;
    const char *view_b;
    const char *obj_b;
} hg_vt_shared_t;

#define HG_VT_SHARED_COUNT ${sharedPairs.length}
static const hg_vt_shared_t hg_vt_shared[HG_VT_SHARED_COUNT] =
{
`;
    for (const pair of sharedPairs) {
      code += `    { "${pair.tag}", "${pair.viewA}", "${pair.objA}", "${pair.viewB}", "${pair.objB}" },\n`;
    }
    code += `};
`;
  } else {
    code += `
#define HG_VT_SHARED_COUNT 0
`;
  }
  code += `

static const hg_vt_profile_t *hg_vt_profile;
static bool hg_vt_started;
static uint32_t hg_vt_last_ms;
static uint32_t hg_vt_elapsed;
static float hg_vt_t;
static gui_view_t *hg_vt_from;
static gui_view_t *hg_vt_to;
static void (*hg_vt_from_orig)(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type);
static void (*hg_vt_to_orig)(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type);
static bool hg_vt_from_pre;
static bool hg_vt_from_destroy;
static bool hg_vt_to_pre;
static bool hg_vt_to_destroy;
static uint16_t hg_vt_from_step;
static uint16_t hg_vt_frames;
#define HG_VT_MAX_FRAMES 240U  /* safety net: never keep redrawing past this */
static gui_circle_t *hg_vt_circle;
static float hg_vt_radius;
`;
  if (hero) {
    code += `static gui_obj_t *hg_vt_hero;           /* the new page's copy, flying in */
static gui_obj_t *hg_vt_hero_src;       /* the old page's copy, hidden meanwhile */
static void (*hg_vt_hero_orig)(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type);
static bool hg_vt_hero_pre;
static bool hg_vt_hero_destroy;
static int16_t hg_vt_hero_dx;
static int16_t hg_vt_hero_dy;
static int16_t hg_vt_hero_arc_x;   /* sideways bow of the flight path */
static int16_t hg_vt_hero_arc_y;
static float hg_vt_hero_scale;
`;
  }
  code += `
static float hg_vt_ease(float p, uint8_t curve)
{
    if (p <= 0.0f)
    {
        return 0.0f;
    }
    if (p >= 1.0f)
    {
        return 1.0f;
    }
    float q = 1.0f - p;
    if (curve == 2U)
    {
        /* Light spring: one overshoot of about 8 %, back home at t = 1 */
        return 1.0f - q * q * cosf(HG_VT_SPRING_OMEGA * p);
    }
    q = p - 1.0f;
    if (curve == 1U)
    {
        const float c1 = ${f(EASE_OUT_BACK_OVERSHOOT)};
        return 1.0f + (c1 + 1.0f) * q * q * q + c1 * q * q;
    }
    return 1.0f + q * q * q;
}

static float hg_vt_window(float t, float start, float end)
{
    if (end <= start)
    {
        return t >= end ? 1.0f : 0.0f;
    }
    float p = (t - start) / (end - start);
    return p < 0.0f ? 0.0f : (p > 1.0f ? 1.0f : p);
}

/* Advance the animation clock by one frame (called once per frame) */
static float hg_vt_advance(void)
{
    uint32_t now = gui_ms_get();
    if (hg_vt_started)
    {
        uint32_t dt = now - hg_vt_last_ms;
        hg_vt_elapsed += (dt > HG_VT_MAX_FRAME_MS) ? HG_VT_MAX_FRAME_MS : dt;
    }
    hg_vt_started = true;
    hg_vt_last_ms = now;
    hg_vt_t = (hg_vt_elapsed >= hg_vt_profile->duration)
              ? 1.0f : (float)hg_vt_elapsed / (float)hg_vt_profile->duration;
    return hg_vt_t;
}

/* Scale around the page centre and shift it down by dy */
static void hg_vt_transform(gui_obj_t *obj, float s, float dy)
{
    float cx = (float)obj->w * 0.5f;
    float cy = (float)obj->h * 0.5f;
    matrix_translate(cx, cy + dy, obj->matrix);
    matrix_scale(s, s, obj->matrix);
    matrix_translate(-cx, -cy, obj->matrix);
}

/* The page's children inherit opacity_value; a coloured page background is a separate image */
static void hg_vt_set_opa(gui_view_t *view, float opa)
{
    uint8_t value = (uint8_t)((float)GUI_BASE(view)->opacity_value * opa);
    GUI_BASE(view)->opacity_value = value;
    if (view->bg_img != NULL)
    {
        view->bg_img->opacity_value = value;
    }
}

`;
  code += generateStaggerFuncs();
  code += hero ? generateHeroFuncs() : generateHeroStubs();
  code += `
static void hg_vt_release_from(void)
{
    gui_obj_t *obj = GUI_BASE(hg_vt_from);
    hg_vt_from->animate_step = hg_vt_from_step;
    obj->obj_cb = hg_vt_from_orig;
    obj->has_pre_process_cb = hg_vt_from_pre;
    obj->has_destroy_cb = hg_vt_from_destroy;
    hg_vt_from = NULL;
    hg_vt_hero_release_source();
}

static void hg_vt_release_to(void)
{
    gui_obj_t *obj = GUI_BASE(hg_vt_to);
    hg_vt_children_release();
    hg_vt_hero_release();
    obj->obj_cb = hg_vt_to_orig;
    obj->has_pre_process_cb = hg_vt_to_pre;
    obj->has_destroy_cb = hg_vt_to_destroy;
    hg_vt_to = NULL;
    if (hg_vt_circle != NULL)
    {
        gui_obj_tree_free_async(GUI_BASE(hg_vt_circle));
        hg_vt_circle = NULL;
    }
}

/* Last resort: if anything kept the transition alive, put everything back */
static void hg_vt_force_release(void)
{
    if (hg_vt_to != NULL)
    {
        hg_vt_release_to();
    }
    if (hg_vt_from != NULL)
    {
        hg_vt_release_from();
    }
}

static void hg_vt_from_cb(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type)
{
    void (*orig)(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type) = hg_vt_from_orig;
    if (cb_type == OBJ_DESTROY)
    {
        bool call = hg_vt_from_destroy;
        hg_vt_from = NULL;
        if (call && orig != NULL)
        {
            orig(obj, cb_type);
        }
        return;
    }
    if (cb_type != OBJ_PRE_PROCESS || hg_vt_from == NULL)
    {
        if (orig != NULL)
        {
            orig(obj, cb_type);
        }
        return;
    }
    gui_view_t *view = (gui_view_t *)obj;
    float t = hg_vt_advance();
    float e = hg_vt_ease(t, hg_vt_profile->from_curve);
    // Hold the engine while animating; on the last frame let it finish in one step
    view->animate_step = (t >= 1.0f) ? (uint16_t)obj->h : 0U;
    hg_vt_transform(obj, 1.0f + (hg_vt_profile->from_scale - 1.0f) * e, 0.0f);
    if (hg_vt_from_pre && orig != NULL)
    {
        orig(obj, cb_type);
    }
    if (gui_view_get_current() != view)
    {
        // The engine has finished the switch; this page is being hidden
        hg_vt_release_from();
        return;
    }
    float opa = 1.0f + (hg_vt_profile->from_opa - 1.0f) * e;
    if (hg_vt_hero_active())
    {
        /* The eye follows the element; let the page step further back */
        opa *= (1.0f - HG_VT_HERO_DIM * e);
    }
    hg_vt_set_opa(view, opa);
}

static void hg_vt_to_cb(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type)
{
    void (*orig)(gui_obj_t *obj, T_OBJ_CB_TYPE cb_type) = hg_vt_to_orig;
    if (cb_type == OBJ_DESTROY)
    {
        bool call = hg_vt_to_destroy;
        hg_vt_to = NULL;
        if (hg_vt_circle != NULL)
        {
            gui_obj_tree_free_async(GUI_BASE(hg_vt_circle));
            hg_vt_circle = NULL;
        }
        if (call && orig != NULL)
        {
            orig(obj, cb_type);
        }
        return;
    }
    if (cb_type != OBJ_PRE_PROCESS || hg_vt_to == NULL)
    {
        if (orig != NULL)
        {
            orig(obj, cb_type);
        }
        return;
    }
    gui_view_t *view = (gui_view_t *)obj;
    const hg_vt_profile_t *p = hg_vt_profile;
    hg_vt_frames++;
    if (hg_vt_frames > HG_VT_MAX_FRAMES)
    {
        /* Never leave the screen redrawing forever */
        hg_vt_force_release();
        if (orig != NULL)
        {
            orig(obj, cb_type);
        }
        return;
    }
    // The old page drives the clock; once it is gone the new page does
    float t = (hg_vt_from != NULL) ? hg_vt_t : hg_vt_advance();
    float e = hg_vt_ease(t, p->to_curve);
    float fade = hg_vt_ease(hg_vt_window(t, p->fade_start, p->fade_end), 0U);
    if (t < 1.0f)
    {
        float s = p->to_scale + (1.0f - p->to_scale) * e;
        float dy = p->to_offset_y * (float)obj->h * (1.0f - e);
        hg_vt_transform(obj, s, dy);
    }
    if (hg_vt_to_pre && orig != NULL)
    {
        orig(obj, cb_type);
    }
    hg_vt_set_opa(view, p->to_opa + (1.0f - p->to_opa) * fade);
    if (hg_vt_circle != NULL)
    {
        float c = hg_vt_ease(hg_vt_window(t, p->circle_start, p->circle_end), 0U);
        int r = (int)(hg_vt_radius * c);
        gui_circle_set_radius(hg_vt_circle, r < 1 ? 1 : r);
    }
    if (t >= 1.0f && hg_vt_from == NULL)
    {
        hg_vt_release_to();
        return;
    }
    gui_fb_change();
}

/* Reveal circle in the new page's background colour, drawn between the two pages */
static void hg_vt_create_circle(gui_view_t *to)
{
    gui_obj_t *obj = GUI_BASE(to);
    touch_info_t *tp = tp_get_info();
    int cx = obj->w / 2;
    int cy = obj->h / 2;
    if (tp != NULL && tp->x >= 0 && tp->y >= 0 && tp->x < obj->w && tp->y < obj->h)
    {
        cx = tp->x;
        cy = tp->y;
    }
    float dx = (float)(cx > obj->w - cx ? cx : obj->w - cx);
    float dy = (float)(cy > obj->h - cy ? cy : obj->h - cy);
    hg_vt_radius = sqrtf(dx * dx + dy * dy) + 1.0f;
    hg_vt_circle = gui_circle_create(obj->parent, "hg_vt_reveal", cx, cy, 1, to->bg_color);
    if (hg_vt_circle == NULL)
    {
        return;
    }
    gui_list_remove(&GUI_BASE(hg_vt_circle)->brother_list);
    gui_list_insert_before(&obj->brother_list, &GUI_BASE(hg_vt_circle)->brother_list);
}

void hg_view_transition_switch(const char *target, uint8_t preset)
{
    gui_view_t *from = gui_view_get_current();
    if (from == NULL || target == NULL || preset == 0U || preset > ${n}U)
    {
        return;
    }
    if (hg_vt_from != NULL || hg_vt_to != NULL)
    {
        // The previous designer transition has not finished yet
        return;
    }
    gui_view_t *before = gui_view_get_next();
    gui_view_switch_direct(from, target, SWITCH_INIT_STATE, SWITCH_INIT_STATE);
    gui_view_t *to = gui_view_get_next();
    if (to == NULL || to == before || to == from)
    {
        // The engine did not start a switch (already switching, or the same page)
        return;
    }

    hg_vt_profile = &hg_vt_profiles[preset - 1U];
    hg_vt_started = false;
    hg_vt_frames = 0U;
    hg_vt_elapsed = 0U;
    hg_vt_t = 0.0f;

    hg_vt_from = from;
    hg_vt_from_orig = GUI_BASE(from)->obj_cb;
    hg_vt_from_pre = GUI_BASE(from)->has_pre_process_cb;
    hg_vt_from_destroy = GUI_BASE(from)->has_destroy_cb;
    hg_vt_from_step = from->animate_step;
    from->animate_step = 0U;
    GUI_BASE(from)->obj_cb = hg_vt_from_cb;
    GUI_BASE(from)->has_pre_process_cb = true;
    GUI_BASE(from)->has_destroy_cb = true;

    hg_vt_to = to;
    hg_vt_to_orig = GUI_BASE(to)->obj_cb;
    hg_vt_to_pre = GUI_BASE(to)->has_pre_process_cb;
    hg_vt_to_destroy = GUI_BASE(to)->has_destroy_cb;
    GUI_BASE(to)->obj_cb = hg_vt_to_cb;
    GUI_BASE(to)->has_pre_process_cb = true;
    GUI_BASE(to)->has_destroy_cb = true;

    hg_vt_hero_begin(from, to, target);

    hg_vt_circle = NULL;
    if (hg_vt_profile->circle_end > hg_vt_profile->circle_start)
    {
        hg_vt_create_circle(to);
    }
    hg_vt_children_begin(to);
    gui_fb_change();
}

`;
  return code;
}
