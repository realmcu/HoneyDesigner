import type { Component, TimerAction } from './types';

/**
 * 定时器 switchView 边的「运行时会触发」谓词——单一事实源。
 *
 * 动机（评审 I2）：导航图边采集（FileManager._collectComponentSwitchViewEdges）
 * 与悬空目标校验（HmlValidationService.validateSwitchViewTargets）此前各写一份
 * 定时器遍历逻辑,校验端无条件深度递归整个 timers 对象(把 mode:'custom'、
 * enabled:false、以及 segmentsBackup 里的 switchView 也纳入),而采集端只在
 * codegen 真会生成绑定的条件下出边 → 两端漂移,校验对运行时根本不触发的跳转
 * 误报「target 不存在」。这里把谓词抽成两处共享的纯函数根治漂移。
 *
 * 采集条件逐字对齐 codegen 的 timer 绑定谓词——边/校验成立当且仅当 codegen
 * 实际会生成 gui_obj_create_timer 绑定：
 * - hg_view 自身：ViewGenerator.generateViewTimerBindings 用 `enabled !== false`
 *   （enabled 缺省/字符串 'false' 都会绑定——与 codegen 现状保持一致）；
 * - 其余组件：HoneyGuiCCodeGenerator.generateTimerBindings 与
 *   ListGenerator.generateNoteTimerBindings 用 `enabled === true`（严格布尔）；
 * - 仅 mode === 'preset' 且 segments/actions 非空才生成预设回调（含跳转），
 *   custom 模式走用户回调、mode 缺失被 codegen 跳过，均不算；
 * - segments 非空时只生成多段动画、忽略 actions（对齐
 *   CallbackFileGenerator.generatePresetTimerCallbackFromConfig）——两者并存时
 *   无条件遍历会产出运行时不存在的幽灵重复边；segmentsBackup 是切到 custom 模式
 *   时的备份,codegen 从不读取。
 */

/** 一条运行时会触发的定时器 switchView 边 */
export interface LiveTimerSwitchView {
    action: TimerAction;
    /** timer 在 comp.data.timers 中的下标 */
    timerIndex: number;
    /** timer id（可能缺省） */
    timerId?: string;
    /** segment 下标（-1 表示旧版单段 actions） */
    segmentIndex: number;
    /** action 在所属 actions 数组中的下标 */
    actionIndex: number;
}

/**
 * 遍历组件定时器中 codegen 真会绑定并触发的 switchView 动作。
 *
 * @param comp        目标组件
 * @param sourceIsView comp 是否为 hg_view（决定 enabled 谓词的松紧）
 * @param cb          对每条命中的 switchView 边回调
 */
export function forEachLiveTimerSwitchView(
    comp: Component,
    sourceIsView: boolean,
    cb: (edge: LiveTimerSwitchView) => void
): void {
    const timers = comp.data?.timers || [];
    timers.forEach((timer, timerIndex) => {
        if (!timer || timer.mode !== 'preset') {
            return;
        }
        const bindsInCodegen = sourceIsView
            ? timer.enabled !== false
            : (timer.enabled as unknown) === true;
        if (!bindsInCodegen) {
            return;
        }
        const emit = (action: TimerAction, segmentIndex: number, actionIndex: number): void => {
            if (action?.type !== 'switchView' || !action.target) {
                return;
            }
            cb({ action, timerIndex, timerId: timer.id, segmentIndex, actionIndex });
        };
        const segments = timer.segments || [];
        if (segments.length > 0) {
            // 新版多段动画
            segments.forEach((segment, segIdx) => {
                (segment?.actions || []).forEach((action, i) => emit(action, segIdx, i));
            });
        } else {
            // 旧版单段动作列表（segmentIndex = -1）
            (timer.actions || []).forEach((action, i) => emit(action, -1, i));
        }
    });
}
