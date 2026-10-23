/**
 * HoneyGUI HML 运行时（realgui/3rd/ezXML/loader）与 HoneyGUI 代码生成之间的差距。
 *
 * 快速预览不编译工程：预编译引擎读取 HML 现场建界面。这里列出运行时没有实现、而生成的
 * C 代码会表现出来的内容，供 HmlPreviewPrep 检查工程并提示用户改用完整仿真。
 * 事件和动作两边一致（hml_event.c 的事件表与 EVENT_TYPE_TO_GUI_EVENT 相同，动作都是
 * switchView / sendMessage / controlTimer / callFunction），只有 callFunction 指向的
 * 工程 C 函数在快速预览中不会执行。运行时补齐功能后同步删减本文件。
 */

/** hml_loader.c 的 hml_tags 中有创建函数的组件（hg_list_item 由 hg_list 按需创建） */
export const PREVIEW_COMPONENTS: ReadonlySet<string> = new Set([
    'hg_view', 'hg_window', 'hg_image', 'hg_label', 'hg_time_label', 'hg_rect', 'hg_canvas',
    'hg_arc', 'hg_circle', 'hg_list', 'hg_list_item', 'hg_button', 'hg_video', 'hg_streaming',
]);

/** 运行时忽略、但生成代码会用到的属性；只在取值生效时（isActiveAttribute）才算差距 */
export const PREVIEW_UNSUPPORTED_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
    hg_label: ['opacity', 'useGradient'],
    hg_time_label: ['opacity', 'useGradient'],
    hg_rect: ['strokeWidth', 'buttonMode'],
    hg_circle: ['strokeWidth', 'buttonMode'],
    hg_arc: ['arcGroup'],
    hg_image: ['buttonMode'],
};

/** 运行时不认识的取值：vAlign=BOTTOM 按 TOP 显示，HH:mm-split 按不闪烁的 HH:mm 显示 */
export const PREVIEW_UNSUPPORTED_VALUES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
    hg_label: { vAlign: ['BOTTOM'] },
    hg_time_label: { vAlign: ['BOTTOM'], timeFormat: ['HH:mm-split'] },
};

/**
 * 取值为工程 C 函数（或 "函数()" 表达式）的属性：快速预览不编译工程，这些函数不会被调用。
 * hg_streaming 拿不到 transporter 就不创建。hg_list 的 userNoteDesignFunc 只在
 * useUserNoteDesign="true" 时生效，由调用方单独判断。
 */
export const PREVIEW_FUNCTION_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
    hg_button: ['clickCallback', 'onCallback', 'offCallback'],
    hg_view: ['switchInFunctionName', 'switchOutFunctionName'],
    hg_streaming: ['transporter'],
};

/** 属性是否取了会生效的值（空串、false、0 描边、255 不透明度等视为默认值） */
export function isActiveAttribute(name: string, value: string): boolean {
    const v = value.trim();
    if (v === '' || v === 'false' || v === 'none') {
        return false;
    }
    if (name === 'opacity') {
        return Number(v) < 255;
    }
    if (name === 'strokeWidth') {
        return Number(v) > 0;
    }
    return true;
}
