import { ComponentType } from '../../types';
import { HgViewProperties } from './HgViewProperties';
import { HgWindowProperties } from './HgWindowProperties';
import { Hg3DProperties } from './Hg3DProperties';
import { HgVideoProperties } from './HgVideoProperties';
import { HgImageProperties } from './HgImageProperties';
import { HgGifProperties } from './HgGifProperties';
import { HgListProperties } from './HgListProperties';
import { ListItemProperties } from './ListItemProperties';
import { GeometryProperties } from './GeometryProperties';
import { DefaultProperties } from './DefaultProperties';
import { HgParticleProperties } from './HgParticleProperties';
import { HgMenuCellularProperties } from './HgMenuCellularProperties';
import { HgQbcodeProperties } from './HgQbcodeProperties';
import { PropertyPanelProps } from './types';

export const propertyPanelRegistry: Record<ComponentType, React.FC<PropertyPanelProps>> = {
  hg_view: HgViewProperties,
  hg_button: DefaultProperties,
  hg_label: DefaultProperties,
  hg_time_label: DefaultProperties,
  hg_timer_label: DefaultProperties,
  hg_input: DefaultProperties,
  hg_textarea: DefaultProperties,
  hg_checkbox: DefaultProperties,
  hg_radio: DefaultProperties,
  hg_switch: DefaultProperties,
  hg_slider: DefaultProperties,
  hg_progressbar: DefaultProperties,
  hg_image: HgImageProperties,
  hg_gif: HgGifProperties,
  hg_window: HgWindowProperties,
  hg_canvas: DefaultProperties,
  hg_list: HgListProperties,
  hg_list_item: ListItemProperties,
  hg_video: HgVideoProperties,
  hg_3d: Hg3DProperties,
  hg_arc: GeometryProperties,
  hg_circle: GeometryProperties,
  hg_rect: GeometryProperties,
  hg_svg: DefaultProperties,
  hg_lottie: DefaultProperties,
  hg_glass: DefaultProperties,
  hg_particle: HgParticleProperties,
  hg_menu_cellular: HgMenuCellularProperties,
  hg_qbcode: HgQbcodeProperties,
};

export { HgViewProperties } from './HgViewProperties';
export { HgWindowProperties } from './HgWindowProperties';
export { Hg3DProperties } from './Hg3DProperties';
export { HgVideoProperties } from './HgVideoProperties';
export { HgImageProperties } from './HgImageProperties';
export { HgGifProperties } from './HgGifProperties';
export { HgListProperties } from './HgListProperties';
export { ListItemProperties } from './ListItemProperties';
export { GeometryProperties } from './GeometryProperties';
export { DefaultProperties } from './DefaultProperties';
export { HgParticleProperties } from './HgParticleProperties';
export { HgMenuCellularProperties } from './HgMenuCellularProperties';
export { HgQbcodeProperties } from './HgQbcodeProperties';
export { BaseProperties } from './BaseProperties';
export { PropertyEditor } from './PropertyEditor';
export { CollapsibleGroup } from './CollapsibleGroup';
export type { PropertyPanelProps, PropertyEditorProps } from './types';
