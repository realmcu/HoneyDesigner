/**
 * Event code generator factory
 */
import { EventCodeGenerator } from './EventCodeGenerator';
import { ViewEventGenerator } from './ViewEventGenerator';
import { WindowEventGenerator } from './WindowEventGenerator';
import { ButtonEventGenerator } from './ButtonEventGenerator';
import { LabelEventGenerator } from './LabelEventGenerator';
import { ImageEventGenerator } from './ImageEventGenerator';
import { InputEventGenerator } from './InputEventGenerator';
import { CheckboxEventGenerator } from './CheckboxEventGenerator';
import { RadioEventGenerator } from './RadioEventGenerator';
import { CanvasEventGenerator } from './CanvasEventGenerator';
import { ListEventGenerator } from './ListEventGenerator';
import { ListItemEventGenerator } from './ListItemEventGenerator';
import { VideoEventGenerator } from './VideoEventGenerator';
import { Model3DEventGenerator } from './Model3DEventGenerator';
import { LottieEventGenerator } from './LottieEventGenerator';
import { ArcEventGenerator } from './ArcEventGenerator';
import { CircleEventGenerator } from './CircleEventGenerator';
import { RectEventGenerator } from './RectEventGenerator';
import { SvgEventGenerator } from './SvgEventGenerator';
import { DefaultEventGenerator } from './DefaultEventGenerator';
import { StreamingEventGenerator } from './StreamingEventGenerator';

export class EventGeneratorFactory {
  private static generators: Map<string, EventCodeGenerator> = new Map();
  private static defaultGenerator = new DefaultEventGenerator();

  static {
    // Container components
    this.generators.set('hg_view', new ViewEventGenerator());
    this.generators.set('hg_window', new WindowEventGenerator());
    
    // Basic controls
    this.generators.set('hg_button', new ButtonEventGenerator());
    this.generators.set('hg_label', new LabelEventGenerator());
    this.generators.set('hg_time_label', new LabelEventGenerator());  // Time label reuses label event generator
    this.generators.set('hg_image', new ImageEventGenerator());
    this.generators.set('hg_input', new InputEventGenerator());
    this.generators.set('hg_checkbox', new CheckboxEventGenerator());
    this.generators.set('hg_radio', new RadioEventGenerator());
    
    // Advanced controls
    this.generators.set('hg_canvas', new CanvasEventGenerator());
    this.generators.set('hg_list', new ListEventGenerator());
    this.generators.set('hg_list_item', new ListItemEventGenerator());  // list_item event generator
    
    // Multimedia
    this.generators.set('hg_video', new VideoEventGenerator());
    this.generators.set('hg_streaming', new StreamingEventGenerator());
    this.generators.set('hg_3d', new Model3DEventGenerator());
    this.generators.set('hg_lottie', new LottieEventGenerator());
    
    // Graphics
    this.generators.set('hg_arc', new ArcEventGenerator());
    this.generators.set('hg_circle', new CircleEventGenerator());
    this.generators.set('hg_rect', new RectEventGenerator());
    this.generators.set('hg_svg', new SvgEventGenerator());
    
    // Cellular menu (uses default event generator)
    this.generators.set('hg_menu_cellular', new DefaultEventGenerator());
  }

  static getGenerator(componentType: string): EventCodeGenerator {
    return this.generators.get(componentType) || this.defaultGenerator;
  }

  static getViewEventGenerator(): ViewEventGenerator {
    return this.generators.get('hg_view') as ViewEventGenerator;
  }
}

export { EventCodeGenerator, EVENT_TYPE_TO_GUI_EVENT } from './EventCodeGenerator';
