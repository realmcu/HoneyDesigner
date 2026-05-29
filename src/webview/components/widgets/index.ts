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

export { WidgetProps, widgetMemo } from './types';

/**
 * 组件类型到控件的映射
 */
export const widgetRegistry: Record<string, React.FC<WidgetProps>> = {
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
  hg_3d: widgetMemo(Model3DWidget),
  hg_arc: widgetMemo(ArcWidget),
  hg_circle: widgetMemo(CircleWidget),
  hg_rect: widgetMemo(RectWidget),
  hg_svg: widgetMemo(SvgWidget),
  hg_glass: widgetMemo(GlassWidget),
  hg_lottie: widgetMemo(LottieWidget),
  hg_particle: widgetMemo(ParticleWidget),
  hg_map: widgetMemo(MapWidget),
  hg_openclaw: widgetMemo(OpenClawWidget),
  hg_claw_face: widgetMemo(ClawFaceWidget),
  hg_menu_cellular: widgetMemo(MenuCellularWidget),
  hg_qbcode: widgetMemo(QbcodeWidget),
};
