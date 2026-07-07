/**
 * hg_3d component code generator
 */
import { Component } from '../../../hml/types';
import { ComponentCodeGenerator, GeneratorContext } from './ComponentGenerator';

export class Model3DGenerator implements ComponentCodeGenerator {

  /**
   * Generate global transform callback and animation update callback
   */
  generateCallbacks(component: Component): string {
    const modelPath = component.data?.modelPath || '';
    const ext = modelPath.split('.').pop()?.toLowerCase();
    
    if (ext !== 'obj' && ext !== 'gltf') {
      return '';
    }

    const callbackName = `${component.id}_global_cb`;
    const updateCallbackName = `${component.id}_update_animation`;
    
    // Camera and world coordinate configuration
    const cameraPosX = (component.data?.cameraPosX as number) ?? 0;
    const cameraPosY = (component.data?.cameraPosY as number) ?? 0;
    const cameraPosZ = (component.data?.cameraPosZ as number) ?? 0;
    const cameraLookX = (component.data?.cameraLookX as number) ?? 0;
    const cameraLookY = (component.data?.cameraLookY as number) ?? 0;
    const cameraLookZ = (component.data?.cameraLookZ as number) ?? 1;
    const worldX = (component.data?.worldX as number) ?? 0;
    const worldY = (component.data?.worldY as number) ?? 0;
    const worldZ = (component.data?.worldZ as number) ?? 30;
    
    // Interactive animation configuration
    const touchRotationEnabled = component.data?.touchRotationEnabled as boolean ?? false;
    const touchRotationAxis = (component.data?.touchRotationAxis as string) ?? 'y';
    const touchRotationSensitivity = Number(component.data?.touchRotationSensitivity ?? 5.0);
    const autoRotationEnabled = component.data?.autoRotationEnabled as boolean ?? false;
    const autoRotationAxis = (component.data?.autoRotationAxis as string) ?? 'y';
    const autoRotationSpeed = Number(component.data?.autoRotationSpeed ?? 1.0); // degrees/frame
    
    let code = '';
    
    // Generate static variables and update callback if interactive animation is enabled
    if (touchRotationEnabled || autoRotationEnabled) {
      code += `// ${component.name} animation state\n`;
      code += `static float ${component.id}_rot_angle = 0.0f;\n\n`;
      
      // Generate update callback
      code += `static void ${updateCallbackName}(void *param) {\n`;
      code += `    (void)param;\n`;
      
      if (touchRotationEnabled) {
        code += `    touch_info_t *tp = tp_get_info();\n\n`;
        code += `    if (tp->pressed || tp->pressing) {\n`;
        
        // Generate axis-specific code, ensure correct float format
        const sensitivity = touchRotationSensitivity.toFixed(1);
        if (touchRotationAxis === 'x') {
          code += `        ${component.id}_rot_angle += tp->deltaY / ${sensitivity}f;\n`;
        } else if (touchRotationAxis === 'y') {
          code += `        ${component.id}_rot_angle += tp->deltaX / ${sensitivity}f;\n`;
        } else if (touchRotationAxis === 'z') {
          code += `        ${component.id}_rot_angle += tp->deltaX / ${sensitivity}f;\n`;
        }
        
        code += `    }\n`;
      }
      
      if (autoRotationEnabled) {
        const speed = autoRotationSpeed.toFixed(3);
        code += `    ${component.id}_rot_angle += ${speed}f;\n`;
      }
      
      code += `}\n\n`;
    }
    
    // Generate global transform callback
    code += `static void ${callbackName}(l3_model_base_t *this) {\n`;
    code += `    l3_camera_UVN_initialize(&this->camera, l3_4d_point(${cameraPosX}, ${cameraPosY}, ${cameraPosZ}), l3_4d_point(${cameraLookX}, ${cameraLookY}, ${cameraLookZ}), 1, 32767, 90, this->viewPortWidth, this->viewPortHeight);\n`;
    
    // Get static rotation angles
    const staticRotationX = (component.data?.rotationX as number) ?? 0;
    const staticRotationY = (component.data?.rotationY as number) ?? 0;
    const staticRotationZ = (component.data?.rotationZ as number) ?? 0;
    
    // Generate world initialization based on animation axis
    if (touchRotationEnabled || autoRotationEnabled) {
      const axisMap = { x: 0, y: 1, z: 2 };
      const axis = touchRotationEnabled ? touchRotationAxis : autoRotationAxis;
      const axisIndex = axisMap[axis as keyof typeof axisMap] ?? 1;
      
      // Initialize rotation array (using static rotation angles as base)
      const rotations = [staticRotationX.toString(), staticRotationY.toString(), staticRotationZ.toString()];
      // Add dynamic rotation on the animation axis
      rotations[axisIndex] = `${staticRotationX !== 0 || staticRotationY !== 0 || staticRotationZ !== 0 ? rotations[axisIndex] + ' + ' : ''}${component.id}_rot_angle`;
      
      code += `    l3_world_initialize(&this->world, ${worldX}, ${worldY}, ${worldZ}, ${rotations[0]}, ${rotations[1]}, ${rotations[2]}, 5);\n`;
    } else {
      // No animation, use static rotation angles directly
      code += `    l3_world_initialize(&this->world, ${worldX}, ${worldY}, ${worldZ}, ${staticRotationX}, ${staticRotationY}, ${staticRotationZ}, 5);\n`;
    }
    
    code += `}\n\n`;
    
    return code;
  }

  generateCreation(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    const parentRef = context.getParentRef(component);
    const { x, y, width, height } = component.position;

    const modelPath = component.data?.modelPath || '';
    const drawType = component.data?.drawType || 'L3_DRAW_FRONT_AND_SORT';
    const ext = modelPath.split('.').pop()?.toLowerCase();

    // Strip assets/ prefix, ensure path starts with /
    let vfsPath = modelPath.replace(/^assets\//, '');
    if (!vfsPath.startsWith('/')) {
      vfsPath = '/' + vfsPath;
    }

    let code = '';

    if (ext === 'obj' || ext === 'gltf') {
      const callbackName = `${component.id}_global_cb`;
      const updateCallbackName = `${component.id}_update_animation`;

      // Convert model file path to bin file path
      const pathParts = vfsPath.split('/');
      const fileName = pathParts[pathParts.length - 1];
      const baseName = fileName.replace(/\.(obj|gltf)$/i, '');
      const dirPath = pathParts.slice(0, -1).join('/');

      const binFileName = ext === 'obj' ? `desc_${baseName}.bin` : `gltf_desc_${baseName}.bin`;
      const binPath = dirPath ? `${dirPath}/${binFileName}` : `/${binFileName}`;

      code += `${indentStr}void *${component.id}_addr = (void *)gui_vfs_get_file_address("${binPath}");\n`;
      code += `${indentStr}l3_model_base_t *${component.id}_model = l3_create_model(${component.id}_addr, ${drawType}, ${x}, ${y}, ${width}, ${height});\n`;
      code += `${indentStr}l3_set_global_transform(${component.id}_model, (l3_global_transform_cb)${callbackName});\n`;
      code += `${indentStr}gui_lite3d_t *${component.id} = gui_lite3d_create(${parentRef}, "${component.name}", ${component.id}_model, 0, 0, ${width}, ${height});\n`;
      
      // Add timer if interactive animation is enabled
      const touchRotationEnabled = component.data?.touchRotationEnabled as boolean ?? false;
      const autoRotationEnabled = component.data?.autoRotationEnabled as boolean ?? false;
      
      if (touchRotationEnabled || autoRotationEnabled) {
        code += `${indentStr}gui_obj_create_timer(GUI_BASE(${component.id}), 10, true, ${updateCallbackName});\n`;
      }
    } else {
      code += `${indentStr}// Warning: unsupported 3D model format: ${ext}\n`;
    }

    return code;
  }

  generatePropertySetters(component: Component, indent: number, context: GeneratorContext): string {
    const indentStr = '    '.repeat(indent);
    let code = '';

    // Visibility
    if (component.visible === false) {
      code += `${indentStr}gui_obj_hidden((gui_obj_t *)${component.id}, true);\n`;
    }

    return code;
  }
}
