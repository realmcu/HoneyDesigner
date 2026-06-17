/**
 * HoneyGUI API Mapper
 * Maps designer component types to HoneyGUI API calls
 */

export interface PropertySetter {
  property: string;      // Component property name
  apiFunction: string;   // HoneyGUI API function name
  valueTransform?: (value: any) => string;  // Value transform function
}

export interface EventHandler {
  event: string;         // Event name
  apiFunction: string;   // HoneyGUI API function name
}

export interface HoneyGuiApiMapping {
  componentType: string;           // Component type
  createFunction: string;          // Create function name
  propertySetters: PropertySetter[];  // Property setter function list
  eventHandlers: EventHandler[];      // Event handler function list
  includeHeader?: string;          // Required include header file
}

export class HoneyGuiApiMapper {
  private mappings: Map<string, HoneyGuiApiMapping>;

  constructor() {
    this.mappings = new Map();
    this.initMappings();
  }

  /**
   * Initialize component-to-API mappings
   */
  private initMappings(): void {
    // View container
    this.mappings.set('hg_view', {
      componentType: 'hg_view',
      createFunction: 'GUI_VIEW_INSTANCE',  // Uses macro instead of function
      propertySetters: [],  // View does not need property setters
      eventHandlers: [],
      includeHeader: 'gui_view.h'
    });

    // Button (dual-state mode implemented via gui_img)
    this.mappings.set('hg_button', {
      componentType: 'hg_button',
      createFunction: 'gui_img_create_from_fs',
      propertySetters: [],
      eventHandlers: [
        { event: 'onClick', apiFunction: 'gui_obj_add_event_cb' }
      ],
      includeHeader: 'gui_img.h'
    });

    // Text label
    this.mappings.set('hg_label', {
      componentType: 'hg_label',
      createFunction: 'gui_text_create',
      propertySetters: [
        { property: 'fontFile', apiFunction: 'gui_text_type_set' },
        { property: 'text', apiFunction: 'gui_text_content_set' },
        { property: 'fontSize', apiFunction: 'gui_text_size_set' },
        { property: 'color', apiFunction: 'gui_text_color_set', valueTransform: this.colorToHex }
      ],
      eventHandlers: [],
      includeHeader: 'gui_text.h'
    });

    // Time label (reuses label configuration)
    this.mappings.set('hg_time_label', {
      componentType: 'hg_time_label',
      createFunction: 'gui_text_create',
      propertySetters: [
        { property: 'fontFile', apiFunction: 'gui_text_type_set' },
        { property: 'text', apiFunction: 'gui_text_content_set' },
        { property: 'fontSize', apiFunction: 'gui_text_size_set' },
        { property: 'color', apiFunction: 'gui_text_color_set', valueTransform: this.colorToHex }
      ],
      eventHandlers: [],
      includeHeader: 'gui_text.h'
    });

    // Scroll text (based on gui_text)
    this.mappings.set('hg_scroll_text', {
      componentType: 'hg_scroll_text',
      createFunction: 'gui_scroll_text_create',
      propertySetters: [
        { property: 'fontFile', apiFunction: 'gui_text_type_set' },
        { property: 'text', apiFunction: 'gui_text_content_set' },
        { property: 'fontSize', apiFunction: 'gui_text_size_set' },
        { property: 'color', apiFunction: 'gui_text_color_set', valueTransform: this.colorToHex },
        { property: 'scrollDirection', apiFunction: 'gui_scroll_text_scroll_set' }
      ],
      eventHandlers: [],
      includeHeader: 'gui_scroll_text.h'
    });

    // Image
    this.mappings.set('hg_image', {
      componentType: 'hg_image',
      createFunction: 'gui_img_create_from_fs',  // Uses filesystem-aware create function
      propertySetters: [
        // { property: 'src', apiFunction: 'gui_img_set_attribute' } // Removed legacy setter
      ],
      eventHandlers: [],
      includeHeader: 'gui_img.h'
    });

    // GIF animation
    this.mappings.set('hg_gif', {
      componentType: 'hg_gif',
      createFunction: 'gui_gif_create_from_fs',
      propertySetters: [],
      eventHandlers: [],
      includeHeader: 'gui_gif.h'
    });

    // Input field
    this.mappings.set('hg_input', {
      componentType: 'hg_input',
      createFunction: 'gui_text_create',
      propertySetters: [
        { property: 'placeholder', apiFunction: 'gui_text_set' },
        { property: 'text', apiFunction: 'gui_text_set' }
      ],
      eventHandlers: [],
      includeHeader: 'gui_text.h'
    });

    // Switch
    this.mappings.set('hg_switch', {
      componentType: 'hg_switch',
      createFunction: 'gui_switch_create',
      propertySetters: [
        { property: 'checked', apiFunction: 'gui_switch_set_state' }
      ],
      eventHandlers: [
        { event: 'onChange', apiFunction: 'gui_switch_set_change_cb' }
      ],
      includeHeader: 'gui_switch.h'
    });

    // Slider
    this.mappings.set('hg_slider', {
      componentType: 'hg_slider',
      createFunction: 'gui_seekbar_create',
      propertySetters: [
        { property: 'value', apiFunction: 'gui_seekbar_set_progress' },
        { property: 'min', apiFunction: 'gui_seekbar_set_range' },
        { property: 'max', apiFunction: 'gui_seekbar_set_range' }
      ],
      eventHandlers: [
        { event: 'onChange', apiFunction: 'gui_seekbar_set_change_cb' }
      ],
      includeHeader: 'gui_seekbar.h'
    });

    // 3D model
    this.mappings.set('hg_3d', {
      componentType: 'hg_3d',
      createFunction: 'gui_3d_create',  // Selects l3_create_obj_model or l3_create_gltf_model based on file type
      propertySetters: [],
      eventHandlers: [],
      includeHeader: 'gui_lite3d.h'
    });

    // Video
    // Note: frameRate and autoPlay are handled in HoneyGuiCCodeGenerator.ts video component processing
    this.mappings.set('hg_video', {
      componentType: 'hg_video',
      createFunction: 'gui_video_create_from_fs',  // Uses filesystem-aware create function
      propertySetters: [],  // Property setters are handled in generateComponentCreate
      eventHandlers: [],
      includeHeader: 'gui_video.h'
    });

    // Arc
    this.mappings.set('hg_arc', {
      componentType: 'hg_arc',
      createFunction: 'gui_arc_create',
      propertySetters: [
        { property: 'radius', apiFunction: 'gui_arc_set_radius' },
        { property: 'startAngle', apiFunction: 'gui_arc_set_start_angle' },
        { property: 'endAngle', apiFunction: 'gui_arc_set_end_angle' },
        { property: 'strokeWidth', apiFunction: 'gui_arc_set_line_width' },
        { property: 'color', apiFunction: 'gui_arc_set_color', valueTransform: this.colorToGuiColor }
      ],
      eventHandlers: [
        { event: 'onClick', apiFunction: 'gui_arc_on_click' }
      ],
      includeHeader: 'gui_arc.h'
    });

    // Circle
    this.mappings.set('hg_circle', {
      componentType: 'hg_circle',
      createFunction: 'gui_circle_create',
      propertySetters: [
        { property: 'radius', apiFunction: 'gui_circle_set_radius' },
        { property: 'fillColor', apiFunction: 'gui_circle_set_color', valueTransform: this.colorToGuiColor }
      ],
      eventHandlers: [
        { event: 'onClick', apiFunction: 'gui_circle_on_click' }
      ],
      includeHeader: 'gui_circle.h'
    });

    // Rectangle
    this.mappings.set('hg_rect', {
      componentType: 'hg_rect',
      createFunction: 'gui_rect_create',
      propertySetters: [
        { property: 'borderRadius', apiFunction: 'gui_rect_set_radius' },
        { property: 'fillColor', apiFunction: 'gui_rect_set_color', valueTransform: this.colorToGuiColor }
      ],
      eventHandlers: [
        { event: 'onClick', apiFunction: 'gui_rect_on_click' }
      ],
      includeHeader: 'gui_rect.h'
    });

    // List widget
    this.mappings.set('hg_list', {
      componentType: 'hg_list',
      createFunction: 'gui_list_create',
      propertySetters: [],  // Property setters are handled in ListGenerator
      eventHandlers: [],
      includeHeader: 'gui_list.h'
    });

    // Glass effect
    this.mappings.set('hg_glass', {
      componentType: 'hg_glass',
      createFunction: 'gui_glass_create_from_fs',
      propertySetters: [],
      eventHandlers: [],
      includeHeader: 'gui_glass.h'
    });

  }

  /**
   * Get API mapping for a component
   */
  getMapping(componentType: string): HoneyGuiApiMapping | null {
    return this.mappings.get(componentType) || null;
  }

  /**
   * Get all required header files
   */
  getRequiredHeaders(componentTypes: string[]): string[] {
    const headers = new Set<string>();
    componentTypes.forEach(type => {
      const mapping = this.mappings.get(type);
      if (mapping?.includeHeader) {
        headers.add(mapping.includeHeader);
      }
    });
    return Array.from(headers);
  }

  /**
   * Convert color to hexadecimal
   */
  private colorToHex(color: string): string {
    if (color.startsWith('#')) {
      return '0x' + color.substring(1).toUpperCase();
    }
    if (color.startsWith('rgb')) {
      const match = color.match(/\d+/g);
      if (match && match.length >= 3) {
        const r = parseInt(match[0]).toString(16).padStart(2, '0');
        const g = parseInt(match[1]).toString(16).padStart(2, '0');
        const b = parseInt(match[2]).toString(16).padStart(2, '0');
        return '0x' + (r + g + b).toUpperCase();
      }
    }
    return '0x000000';
  }

  /**
   * Convert color to gui_rgba macro call (consistent with SDK examples)
   * @param color Color string
   * @param opacity Optional opacity override value (0-255)
   */
  public colorToGuiColor(color: string, opacity?: number): string {
    let r = 0, g = 0, b = 0, a = 255;
    
    if (color.startsWith('#')) {
      const hex = color.substring(1);
      if (hex.length === 6) {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
      } else if (hex.length === 8) {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
        a = parseInt(hex.substring(6, 8), 16);
      }
    } else if (color.startsWith('rgb')) {
      const match = color.match(/\d+/g);
      if (match && match.length >= 3) {
        r = parseInt(match[0]);
        g = parseInt(match[1]);
        b = parseInt(match[2]);
        if (match.length >= 4) {
          a = Math.round(parseFloat(match[3]) * 255);
        }
      }
    }
    
    // If opacity parameter is provided, use it to override the alpha value
    if (opacity !== undefined) {
      a = Math.max(0, Math.min(255, Math.round(opacity)));
    }
    
    // Use gui_rgba macro (consistent with SDK examples)
    return `gui_rgba(${r}, ${g}, ${b}, ${a})`;
  }

  /**
   * Add custom mapping
   */
  addCustomMapping(mapping: HoneyGuiApiMapping): void {
    this.mappings.set(mapping.componentType, mapping);
  }
}
