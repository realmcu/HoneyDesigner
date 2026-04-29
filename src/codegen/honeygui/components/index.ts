/**
 * Component code generator factory
 */
import { ComponentCodeGenerator } from './ComponentGenerator';
import { ViewGenerator } from './ViewGenerator';
import { WindowGenerator } from './WindowGenerator';
import { ImageGenerator } from './ImageGenerator';
import { GifGenerator } from './GifGenerator';
import { VideoGenerator } from './VideoGenerator';
import { Model3DGenerator } from './Model3DGenerator';
import { LabelGenerator } from './LabelGenerator';
import { TimerLabelGenerator } from './TimerLabelGenerator';
import { ButtonGenerator } from './ButtonGenerator';
import { InputGenerator } from './InputGenerator';
import { CheckboxGenerator } from './CheckboxGenerator';
import { RadioGenerator } from './RadioGenerator';
import { CanvasGenerator } from './CanvasGenerator';
import { ListGenerator } from './ListGenerator';
import { ArcGenerator } from './ArcGenerator';
import { CircleGenerator } from './CircleGenerator';
import { RectGenerator } from './RectGenerator';
import { SvgGenerator } from './SvgGenerator';
import { LottieGenerator } from './LottieGenerator';
import { GlassGenerator } from './GlassGenerator';
import { TimeLabelGenerator } from './TimeLabelGenerator';
import { ParticleGenerator } from './ParticleGenerator';
import { MapGenerator } from './MapGenerator';
import { OpenClawGenerator } from './OpenClawGenerator';
import { ClawFaceGenerator } from './ClawFaceGenerator';
import { MenuCellularGenerator } from './MenuCellularGenerator';
import { QbcodeGenerator } from './QbcodeGenerator';
import { DefaultGenerator } from './DefaultGenerator';

export class ComponentGeneratorFactory {
  private static generators: Map<string, ComponentCodeGenerator> = new Map();
  private static defaultGenerator = new DefaultGenerator();

  static {
    // Container components
    this.generators.set('hg_view', new ViewGenerator());
    this.generators.set('hg_window', new WindowGenerator());
    this.generators.set('hg_menu_cellular', new MenuCellularGenerator());
    
    // Basic controls
    this.generators.set('hg_button', new ButtonGenerator());
    this.generators.set('hg_label', new LabelGenerator());
    this.generators.set('hg_time_label', new TimeLabelGenerator());
    this.generators.set('hg_timer_label', new TimerLabelGenerator());
    this.generators.set('hg_image', new ImageGenerator());
    this.generators.set('hg_gif', new GifGenerator());
    this.generators.set('hg_input', new InputGenerator());
    this.generators.set('hg_checkbox', new CheckboxGenerator());
    this.generators.set('hg_radio', new RadioGenerator());
    
    // Advanced controls
    this.generators.set('hg_canvas', new CanvasGenerator());
    this.generators.set('hg_list', new ListGenerator());
    
    // Multimedia
    this.generators.set('hg_video', new VideoGenerator());
    this.generators.set('hg_3d', new Model3DGenerator());
    this.generators.set('hg_lottie', new LottieGenerator());
    
    // Graphics
    this.generators.set('hg_arc', new ArcGenerator());
    this.generators.set('hg_circle', new CircleGenerator());
    this.generators.set('hg_rect', new RectGenerator());
    this.generators.set('hg_svg', new SvgGenerator());
    this.generators.set('hg_glass', new GlassGenerator());
    this.generators.set('hg_particle', new ParticleGenerator());
    this.generators.set('hg_map', new MapGenerator());
    this.generators.set('hg_openclaw', new OpenClawGenerator());
    this.generators.set('hg_claw_face', new ClawFaceGenerator());
    this.generators.set('hg_qbcode', new QbcodeGenerator());
  }

  static getGenerator(componentType: string): ComponentCodeGenerator {
    return this.generators.get(componentType) || this.defaultGenerator;
  }

  static getViewGenerator(): ViewGenerator {
    return this.generators.get('hg_view') as ViewGenerator;
  }
}

export { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
export { ViewGenerator } from './ViewGenerator';
