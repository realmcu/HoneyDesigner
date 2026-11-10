/**
 * 各目标引擎对组件类型的支持状态（纯数据，宿主与 webview 共用）。
 *
 * 数据源是 webview 组件库的 engineSupport 标记。抽成独立模块是因为
 * ComponentLibrary.tsx 依赖 React 与 store，宿主进程（代码生成前校验）不能导入它。
 * 这里列出的类型在对应引擎下只会生成占位对象或注释，代码生成前会给出警告。
 *
 * 新增组件或调整引擎支持时，同时更新本文件和 ComponentLibrary.tsx 的 engineSupport。
 */

/** 该引擎下不支持的组件类型 */
export const COMPONENT_ENGINE_SUPPORT: Record<'honeygui' | 'lvgl', ReadonlySet<string>> = {
  honeygui: new Set([
    'hg_checkbox',
    'hg_canvas',
    'hg_input',
    'hg_progressbar',
    'hg_radio',
    'hg_slider',
    'hg_switch',
  ]),
  lvgl: new Set([
    'hg_3d',
    'hg_canvas',
    'hg_glass',
    'hg_menu_cellular',
    'hg_particle',
    'hg_progress',
    'hg_streaming',
    'hg_video',
  ]),
};
