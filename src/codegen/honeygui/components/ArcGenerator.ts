/**
 * hg_arc component code generator
 * Supports both standalone arc and arc group modes
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';
import { convertColor, convertColorWithOpacity, convertColorToRgba } from '../utils';

/**
 * Arc group information
 */
interface ArcGroupInfo {
  name: string;
  arcs: Component[];
  boundingBox: { x: number; y: number; width: number; height: number };
}

export class ArcGenerator implements ComponentCodeGenerator {
  /**
   * Collect all arc groups under the same parent component
   */
  static collectArcGroups(components: Component[]): Map<string, ArcGroupInfo> {
    const groups = new Map<string, ArcGroupInfo>();
    
    components.forEach(comp => {
      if (comp.type === 'hg_arc' && comp.data?.arcGroup) {
        const groupName = comp.data.arcGroup as string;
        const parentId = comp.parent || 'root';
        const groupKey = `${parentId}_${groupName}`;
        
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            name: groupName,
            arcs: [],
            boundingBox: { x: Infinity, y: Infinity, width: 0, height: 0 }
          });
        }
        
        const group = groups.get(groupKey)!;
        group.arcs.push(comp);
        
        // Update bounding box
        const { x, y, width, height } = comp.position;
        const radius = comp.style?.radius || 40;
        const strokeWidth = comp.style?.strokeWidth || 8;
        const arcSize = (radius + strokeWidth / 2) * 2 + 4;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const arcLeft = centerX - arcSize / 2;
        const arcTop = centerY - arcSize / 2;
        
        group.boundingBox.x = Math.min(group.boundingBox.x, arcLeft);
        group.boundingBox.y = Math.min(group.boundingBox.y, arcTop);
        const right = Math.max(
          group.boundingBox.x + group.boundingBox.width,
          arcLeft + arcSize
        );
        const bottom = Math.max(
          group.boundingBox.y + group.boundingBox.height,
          arcTop + arcSize
        );
        group.boundingBox.width = right - group.boundingBox.x;
        group.boundingBox.height = bottom - group.boundingBox.y;
      }
    });
    
    return groups;
  }

  /**
   * Generate arc group creation code
   */
  static generateGroupCreation(groupKey: string, groupInfo: ArcGroupInfo, parentRef: string, indent: number): string {
    const indentStr = '    '.repeat(indent);
    const { x, y, width, height } = groupInfo.boundingBox;
    const groupVarName = `arc_group_${groupInfo.name}`;
    
    let code = `${indentStr}// Arc Group: ${groupInfo.name}\n`;
    code += `${indentStr}gui_arc_group_t *${groupVarName} = gui_arc_group_create(${parentRef}, "${groupInfo.name}", ${Math.floor(x)}, ${Math.floor(y)}, ${Math.ceil(width)}, ${Math.ceil(height)});\n`;
    
    // Calculate relative coordinates within group
    const groupCenterX = width / 2;
    const groupCenterY = height / 2;
    
    // Generate add_arc call for each arc
    groupInfo.arcs.forEach((arc, index) => {
      const { x: arcX, y: arcY, width: arcW, height: arcH } = arc.position;
      const radius = arc.style?.radius || 40;
      const startAngle = arc.style?.startAngle || 0;
      const endAngle = arc.style?.endAngle || 270;
      const strokeWidth = arc.style?.strokeWidth || 8;
      const opacity = arc.style?.opacity ?? arc.data?.opacity ?? 255;
      const color = convertColorWithOpacity(arc.style?.color, opacity);
      
      // Calculate arc center position relative to group
      const arcCenterX = (arcX + arcW / 2) - x;
      const arcCenterY = (arcY + arcH / 2) - y;
      
      code += `${indentStr}gui_arc_group_add_arc(${groupVarName}, ${arcCenterX.toFixed(1)}f, ${arcCenterY.toFixed(1)}f, ${radius}.0f, ${startAngle}.0f, ${endAngle}.0f, ${strokeWidth}.0f, ${color});\n`;
    });
    
    code += `${indentStr}GUI_UNUSED(${groupVarName});\n`;
    
    return code;
  }

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    // Skip standalone creation if part of a group (handled by group)
    if (component.data?.arcGroup) {
      return '';
    }
    
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;
    
    // Get parameters from style with defaults
    const radius = component.style?.radius || 40;
    const startAngle = component.style?.startAngle || 0;
    const endAngle = component.style?.endAngle || 270;
    const strokeWidth = component.style?.strokeWidth || 8;
    
    // Get opacity, default 255 (fully opaque)
    const opacity = component.style?.opacity ?? component.data?.opacity ?? 255;
    
    // Select color format based on opacity
    const color = opacity < 255
      ? convertColorWithOpacity(component.style?.color, opacity)
      : convertColor(component.style?.color);

    // Important: gui_arc_create x, y parameters are center coordinates, not bounding box top-left
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    return `${indentStr}${component.id} = gui_arc_create(${parentRef}, "${component.name}", ${centerX}, ${centerY}, ${radius}, ${startAngle}, ${endAngle}, ${strokeWidth}, ${color});\n`;
  }

  generatePropertySetters(component: Component, indent: number, _context: GeneratorContext): string {
    // Skip if part of a group (gradient handled during group creation)
    if (component.data?.arcGroup) {
      return '';
    }
    
    const indentStr = '    '.repeat(indent);
    let code = '';

    // Gradient settings
    if (component.style?.useGradient && component.data?.gradientStops) {
      const stops = component.data.gradientStops as Array<{ position: number; color: string }>;
      if (stops.length >= 2) {
        const gradientStartAngle = component.data?.gradientStartAngle ?? component.style?.startAngle ?? 0;
        const gradientEndAngle = component.data?.gradientEndAngle ?? component.style?.endAngle ?? 360;
        
        code += `${indentStr}// Set angular gradient\n`;
        code += `${indentStr}gui_arc_set_angular_gradient(${component.id}, ${gradientStartAngle}, ${gradientEndAngle});\n`;
        
        stops.forEach(stop => {
          const color = convertColorToRgba(stop.color);
          const position = Number.isInteger(stop.position) 
            ? `${stop.position}.0f` 
            : `${stop.position}f`;
          code += `${indentStr}gui_arc_add_gradient_stop(${component.id}, ${position}, ${color});\n`;
        });
      }
    }

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_show((gui_obj_t *)${component.id}, false);\n`;
    }

    return code;
  }

}
