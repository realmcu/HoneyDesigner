import React from 'react';
import { WidgetProps } from './types';
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
import { Model3DWidget } from './Model3DWidget';
import { ArcWidget } from './ArcWidget';
import { CircleWidget } from './CircleWidget';
import { RectWidget } from './RectWidget';
import { SvgWidget } from './SvgWidget';
import { GlassWidget } from './GlassWidget';
import { LottieWidget } from './LottieWidget';
import { CanvasWidget } from './CanvasWidget';
import { ParticleWidget } from './ParticleWidget';
import { MapWidget } from './MapWidget';
import { OpenClawWidget } from './OpenClawWidget';
import { ClawFaceWidget } from './ClawFaceWidget';
import { MenuCellularWidget } from './MenuCellularWidget';
import { QbcodeWidget } from './QbcodeWidget';

export { WidgetProps } from './types';

/**
 * 组件类型到控件的映射
 */
export const widgetRegistry: Record<string, React.FC<WidgetProps>> = {
  hg_button: ButtonWidget,
  hg_label: LabelWidget,
  hg_time_label: TimeLabelWidget,
  hg_timer_label: TimerLabelWidget,
  hg_input: InputWidget,
  hg_checkbox: CheckboxWidget,
  hg_radio: RadioWidget,
  hg_progressbar: ProgressBarWidget,
  hg_slider: SliderWidget,
  hg_switch: SwitchWidget,
  hg_view: ContainerWidget,
  hg_window: ContainerWidget,
  hg_image: ImageWidget,
  hg_gif: GifWidget,
  hg_canvas: CanvasWidget,
  hg_list: ListWidget,
  hg_list_item: ListItemWidget,
  hg_video: VideoWidget,
  hg_3d: Model3DWidget,
  hg_arc: ArcWidget,
  hg_circle: CircleWidget,
  hg_rect: RectWidget,
  hg_svg: SvgWidget,
  hg_glass: GlassWidget,
  hg_lottie: LottieWidget,
  hg_particle: ParticleWidget,
  hg_map: MapWidget,
  hg_openclaw: OpenClawWidget,
  hg_claw_face: ClawFaceWidget,
  hg_menu_cellular: MenuCellularWidget,
  hg_qbcode: QbcodeWidget,
};
