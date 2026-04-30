/**
 * LVGL component code generator factory
 */
import { LvglComponentCodeGenerator } from '../LvglComponentGenerator';
import { LvglViewGenerator } from './LvglViewGenerator';
import { LvglWindowGenerator } from './LvglWindowGenerator';
import { LvglImageGenerator } from './LvglImageGenerator';
import { LvglLabelGenerator } from './LvglLabelGenerator';
import { LvglButtonGenerator } from './LvglButtonGenerator';
import { LvglInputGenerator } from './LvglInputGenerator';
import { LvglCheckboxGenerator } from './LvglCheckboxGenerator';
import { LvglRadioGenerator } from './LvglRadioGenerator';
import { LvglArcGenerator } from './LvglArcGenerator';
import { LvglRectGenerator } from './LvglRectGenerator';
import { LvglCircleGenerator } from './LvglCircleGenerator';
import { LvglVideoGenerator } from './LvglVideoGenerator';
import { LvglLottieGenerator } from './LvglLottieGenerator';
import { Lvgl3DGenerator } from './Lvgl3DGenerator';
import { LvglTimeLabelGenerator } from './LvglTimeLabelGenerator';
import { LvglTimerLabelGenerator } from './LvglTimerLabelGenerator';
import { LvglListGenerator } from './LvglListGenerator';
import { LvglListItemGenerator } from './LvglListItemGenerator';
import { LvglSwitchGenerator } from './LvglSwitchGenerator';
import { LvglSliderGenerator } from './LvglSliderGenerator';
import { LvglProgressBarGenerator } from './LvglProgressBarGenerator';
import { LvglDefaultGenerator } from './LvglDefaultGenerator';
import { LvglQbcodeGenerator } from './LvglQbcodeGenerator';
import { LvglSvgGenerator } from './LvglSvgGenerator';
import { LvglGifGenerator } from './LvglGifGenerator';

export class LvglComponentGeneratorFactory {
  private static generators: Map<string, LvglComponentCodeGenerator> = new Map();
  private static defaultGenerator = new LvglDefaultGenerator();

  static {
    // Container components
    this.generators.set('hg_view', new LvglViewGenerator());
    this.generators.set('hg_window', new LvglWindowGenerator());

    // Basic controls
    this.generators.set('hg_image', new LvglImageGenerator());
    this.generators.set('hg_label', new LvglLabelGenerator());
    this.generators.set('hg_button', new LvglButtonGenerator());
    this.generators.set('hg_input', new LvglInputGenerator());
    this.generators.set('hg_checkbox', new LvglCheckboxGenerator());
    this.generators.set('hg_radio', new LvglRadioGenerator());
    this.generators.set('hg_switch', new LvglSwitchGenerator());
    this.generators.set('hg_slider', new LvglSliderGenerator());
    this.generators.set('hg_progressbar', new LvglProgressBarGenerator());
    this.generators.set('hg_time_label', new LvglTimeLabelGenerator());
    this.generators.set('hg_timer_label', new LvglTimerLabelGenerator());

    // Graphics controls
    this.generators.set('hg_arc', new LvglArcGenerator());
    this.generators.set('hg_rect', new LvglRectGenerator());
    this.generators.set('hg_circle', new LvglCircleGenerator());

    // Multimedia controls
    this.generators.set('hg_video', new LvglVideoGenerator());
    this.generators.set('hg_lottie', new LvglLottieGenerator());
    this.generators.set('hg_3d', new Lvgl3DGenerator());
    this.generators.set('hg_svg', new LvglSvgGenerator());

    // List controls
    this.generators.set('hg_list', new LvglListGenerator());
    this.generators.set('hg_list_item', new LvglListItemGenerator());

    // QR/Barcode controls
    this.generators.set('hg_qbcode', new LvglQbcodeGenerator());

    // GIF animation
    this.generators.set('hg_gif', new LvglGifGenerator());
  }

  static getGenerator(componentType: string): LvglComponentCodeGenerator {
    return this.generators.get(componentType) || this.defaultGenerator;
  }

  /**
   * Get all registered generators (for batch generation of event callbacks and global definitions)
   */
  static getAllGenerators(): Map<string, LvglComponentCodeGenerator> {
    return this.generators;
  }
}

export { LvglComponentCodeGenerator, LvglGeneratorContext } from '../LvglComponentGenerator';
