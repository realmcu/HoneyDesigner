import React from 'react';
import { WidgetProps, widgetMemo } from './types';
import { ButtonWidget } from './ButtonWidget';
import { LabelWidget } from './LabelWidget';
import { TimeLabelWidget } from './TimeLabelWidget';
import { TimerLabelWidget } from './TimerLabelWidget';
import { InputWidget } from './InputWidget';
import { CheckboxWidget } from './CheckboxWidget';
import { RadioWidget } from './RadioWidget';
import { ProgressBarWidget } from './ProgressBarWidget';
import { SliderWidget } from './SliderWidget';
import { SwitchWidget } from './SwitchWidget';
import { ContainerWidget } from './ContainerWidget';
import { ImageWidget } from './ImageWidget';
import { GifWidget } from './GifWidget';
import { ListWidget } from './ListWidget';
import { ListItemWidget } from './ListItemWidget';
import { VideoWidget } from './VideoWidget';
import { ArcWidget } from './ArcWidget';
import { CircleWidget } from './CircleWidget';
import { RectWidget } from './RectWidget';
import { SvgWidget } from './SvgWidget';
import { GlassWidget } from './GlassWidget';
import { CanvasWidget } from './CanvasWidget';
import { ParticleWidget } from './ParticleWidget';
import { MenuCellularWidget } from './MenuCellularWidget';
import { QbcodeWidget } from './QbcodeWidget';
import { StreamingWidget } from './StreamingWidget';

// Model3DWidget 依赖 three.js，LottieWidget 依赖 lottie-web，两者体积都很大。
// 画布上出现对应组件时才加载各自的 chunk；其余控件都很轻，保持静态引入。
const Model3DWidget = React.lazy(() =>
  import('./Model3DWidget').then((m) => ({ default: m.Model3DWidget }))
);
const LottieWidget = React.lazy(() =>
  import('./LottieWidget').then((m) => ({ default: m.LottieWidget }))
);

export { WidgetProps, widgetMemo } from './types';

/**
 * 组件类型到控件的映射
 *
 * 值可能是 memo 组件，也可能是懒加载组件（见上方 React.lazy 定义），
 * 因此用 ComponentType 而非 FC。渲染方需保证外层有 Suspense 边界。
 */
export const widgetRegistry: Record<string, React.ComponentType<WidgetProps>> = {
  hg_button: widgetMemo(ButtonWidget),
  hg_label: widgetMemo(LabelWidget),
  hg_time_label: widgetMemo(TimeLabelWidget),
  hg_timer_label: widgetMemo(TimerLabelWidget),
  hg_input: widgetMemo(InputWidget),
  hg_checkbox: widgetMemo(CheckboxWidget),
  hg_radio: widgetMemo(RadioWidget),
  hg_progressbar: widgetMemo(ProgressBarWidget),
  hg_slider: widgetMemo(SliderWidget),
  hg_switch: widgetMemo(SwitchWidget),
  hg_view: widgetMemo(ContainerWidget),
  hg_window: widgetMemo(ContainerWidget),
  hg_image: widgetMemo(ImageWidget),
  hg_gif: widgetMemo(GifWidget),
  hg_canvas: widgetMemo(CanvasWidget),
  hg_list: widgetMemo(ListWidget),
  hg_list_item: widgetMemo(ListItemWidget),
  hg_video: widgetMemo(VideoWidget),
  // 懒加载控件不再套 widgetMemo：lazy 组件本身带模块级缓存，
  // 且 MemoExoticComponent 与 LazyExoticComponent 的类型不兼容。
  hg_3d: Model3DWidget,
  hg_arc: widgetMemo(ArcWidget),
  hg_circle: widgetMemo(CircleWidget),
  hg_rect: widgetMemo(RectWidget),
  hg_svg: widgetMemo(SvgWidget),
  hg_glass: widgetMemo(GlassWidget),
  hg_lottie: LottieWidget,
  hg_particle: widgetMemo(ParticleWidget),
  hg_menu_cellular: widgetMemo(MenuCellularWidget),
  hg_qbcode: widgetMemo(QbcodeWidget),
  hg_streaming: widgetMemo(StreamingWidget),
};
