import { Component } from '../types';
import { getAbsolutePosition } from '../utils/componentUtils';
import { generateComponentId } from '../utils/componentNaming';
import { useDesignerStore } from '../store';

/**
 * 获取其他文件中已使用的组件 ID（用于跨文件命名去重）
 */
const getOtherFileIds = (): string[] => {
  return useDesignerStore.getState().otherFileComponentIds || [];
};

const getNextZIndex = (components: Component[], parentId: string): number => {
  const siblings = components.filter(c => c.parent === parentId);
  if (siblings.length === 0) {
    return 1;
  }
  const maxZIndex = Math.max(...siblings.map(c => (typeof c.zIndex === 'number' ? c.zIndex : 0)));
  return maxZIndex + 1;
};

/**
 * 计算组件相对于目标容器的整数坐标
 */
const getRelativePosition = (
  dropPosition: { x: number; y: number },
  targetContainer: Component,
  components: Component[]
): { x: number; y: number } => {
  const targetAbsPos = getAbsolutePosition(targetContainer, components);
  return {
    x: Math.max(0, Math.round(dropPosition.x - targetAbsPos.x)),
    y: Math.max(0, Math.round(dropPosition.y - targetAbsPos.y)),
  };
};

/**
 * 创建图片组件的统一函数
 */
export const createImageComponentAtPosition = (
  imagePath: string,
  dropPosition: { x: number; y: number },
  targetContainerId: string,
  components: Component[],
  addComponent: (component: Component) => void,
  imageSize?: { width: number; height: number }
): string | undefined => {
  const targetContainer = components.find(c => c.id === targetContainerId);
  if (!targetContainer) return;

  const { x: relativeX, y: relativeY } = getRelativePosition(dropPosition, targetContainer, components);

  const width = imageSize?.width || 100;
  const height = imageSize?.height || 100;
  const zIndex = getNextZIndex(components, targetContainerId);

  const imageId = generateComponentId('hg_image', components, getOtherFileIds());
  const imageComponent: Component = {
    id: imageId,
    type: 'hg_image',
    name: imageId,
    position: { x: relativeX, y: relativeY, width, height },
    visible: true,
    enabled: true,
    locked: false,
    zIndex,
    children: [],
    parent: targetContainerId,
    style: {},
    data: { src: imagePath },
  };

  addComponent(imageComponent);
  return imageId;
};

/**
 * 创建 GIF 组件的统一函数
 */
export const createGifComponentAtPosition = (
  gifPath: string,
  dropPosition: { x: number; y: number },
  targetContainerId: string,
  components: Component[],
  addComponent: (component: Component) => void,
  imageSize?: { width: number; height: number }
): string | undefined => {
  const targetContainer = components.find(c => c.id === targetContainerId);
  if (!targetContainer) return;

  const { x: relativeX, y: relativeY } = getRelativePosition(dropPosition, targetContainer, components);

  const width = imageSize?.width || 150;
  const height = imageSize?.height || 150;
  const zIndex = getNextZIndex(components, targetContainerId);

  const gifId = generateComponentId('hg_gif', components, getOtherFileIds());
  const gifComponent: Component = {
    id: gifId,
    type: 'hg_gif',
    name: gifId,
    position: { x: relativeX, y: relativeY, width, height },
    visible: true,
    enabled: true,
    locked: false,
    zIndex,
    children: [],
    parent: targetContainerId,
    style: {},
    data: { src: gifPath },
  };

  addComponent(gifComponent);
  return gifId;
};

/**
 * 创建 Label 组件（从字体文件拖拽）
 */
export const createLabelComponentAtPosition = (
  fontPath: string,
  dropPosition: { x: number; y: number },
  targetContainerId: string,
  components: Component[],
  addComponent: (component: Component) => void
): string | undefined => {
  const targetContainer = components.find(c => c.id === targetContainerId);
  if (!targetContainer) return;

  const { x: relativeX, y: relativeY } = getRelativePosition(dropPosition, targetContainer, components);
  const zIndex = getNextZIndex(components, targetContainerId);

  const labelId = generateComponentId('hg_label', components, getOtherFileIds());
  const labelComponent: Component = {
    id: labelId,
    type: 'hg_label',
    name: labelId,
    position: { x: relativeX, y: relativeY, width: 150, height: 30 },
    visible: true,
    enabled: true,
    locked: false,
    zIndex,
    children: [],
    parent: targetContainerId,
    style: {},
    data: {
      text: 'Label',
      fontFile: fontPath,
      fontSize: 16,
      fontType: 'bitmap',
      color: '#ffffff',
      hAlign: 'LEFT',
      vAlign: 'TOP',
    },
  };

  addComponent(labelComponent);
  return labelId;
};

/**
 * 创建3D组件的统一函数
 */
export const create3DComponentAtPosition = (
  modelPath: string,
  dropPosition: { x: number; y: number },
  targetContainerId: string,
  components: Component[],
  addComponent: (component: Component) => void
): string | undefined => {
  const targetContainer = components.find(c => c.id === targetContainerId);
  if (!targetContainer) return;

  const { x: relativeX, y: relativeY } = getRelativePosition(dropPosition, targetContainer, components);
  const zIndex = getNextZIndex(components, targetContainerId);

  const id3D = generateComponentId('hg_3d', components, getOtherFileIds());
  const component3D: Component = {
    id: id3D,
    type: 'hg_3d',
    name: id3D,
    position: { x: relativeX, y: relativeY, width: 400, height: 400 },
    visible: true,
    enabled: true,
    locked: false,
    zIndex,
    children: [],
    parent: targetContainerId,
    style: {},
    data: { 
      modelPath,
      worldX: 0,
      worldY: 0,
      worldZ: 30,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      scale: 5,
      cameraPosX: 0,
      cameraPosY: 0,
      cameraPosZ: 0,
      cameraLookX: 0,
      cameraLookY: 0,
      cameraLookZ: 1,
    },
  };

  addComponent(component3D);
  return id3D;
};

/**
 * 创建视频组件的统一函数
 */
export const createVideoComponentAtPosition = (
  videoPath: string,
  dropPosition: { x: number; y: number },
  targetContainerId: string,
  components: Component[],
  addComponent: (component: Component) => void,
  videoSize?: { width: number; height: number }
): string | undefined => {
  const targetContainer = components.find(c => c.id === targetContainerId);
  if (!targetContainer) return;

  const { x: relativeX, y: relativeY } = getRelativePosition(dropPosition, targetContainer, components);

  // 使用视频真实尺寸，如果没有则使用默认值 320x240
  const { width, height } = videoSize || { width: 320, height: 240 };
  const zIndex = getNextZIndex(components, targetContainerId);

  const videoId = generateComponentId('hg_video', components, getOtherFileIds());
  const videoComponent: Component = {
    id: videoId,
    type: 'hg_video',
    name: videoId,
    position: { x: relativeX, y: relativeY, width, height },
    visible: true,
    enabled: true,
    locked: false,
    zIndex,
    children: [],
    parent: targetContainerId,
    style: {},
    data: { src: videoPath },
  };

  addComponent(videoComponent);
  return videoId;
};

/**
 * 创建 SVG 组件的统一函数
 */
export const createSvgComponentAtPosition = (
  svgPath: string,
  dropPosition: { x: number; y: number },
  targetContainerId: string,
  components: Component[],
  addComponent: (component: Component) => void,
  size?: { width: number; height: number }
): string | undefined => {
  const targetContainer = components.find(c => c.id === targetContainerId);
  if (!targetContainer) return;

  const { x: relativeX, y: relativeY } = getRelativePosition(dropPosition, targetContainer, components);
  const zIndex = getNextZIndex(components, targetContainerId);

  const svgId = generateComponentId('hg_svg', components, getOtherFileIds());
  const svgComponent: Component = {
    id: svgId,
    type: 'hg_svg',
    name: svgId,
    position: { 
      x: relativeX, 
      y: relativeY, 
      width: size?.width || 100, 
      height: size?.height || 100 
    },
    visible: true,
    enabled: true,
    locked: false,
    zIndex,
    children: [],
    parent: targetContainerId,
    style: {},
    data: { src: svgPath },
  };

  addComponent(svgComponent);
  return svgId;
};

/**
 * 创建 Glass 组件的统一函数
 */
export const createGlassComponentAtPosition = (
  glassPath: string,
  dropPosition: { x: number; y: number },
  targetContainerId: string,
  components: Component[],
  addComponent: (component: Component) => void,
  size?: { width: number; height: number }
): string | undefined => {
  const targetContainer = components.find(c => c.id === targetContainerId);
  if (!targetContainer) return;

  const { x: relativeX, y: relativeY } = getRelativePosition(dropPosition, targetContainer, components);
  const zIndex = getNextZIndex(components, targetContainerId);

  const glassId = generateComponentId('hg_glass', components, getOtherFileIds());
  const glassComponent: Component = {
    id: glassId,
    type: 'hg_glass',
    name: glassId,
    position: { 
      x: relativeX, 
      y: relativeY, 
      width: size?.width || 150, 
      height: size?.height || 150 
    },
    visible: true,
    enabled: true,
    locked: false,
    zIndex,
    children: [],
    parent: targetContainerId,
    style: {},
    data: { 
      src: glassPath,
      distortion: 10,
      region: 50
    },
  };

  addComponent(glassComponent);
  return glassId;
};

/**
 * 创建 Lottie 组件的统一函数
 */
export const createLottieComponentAtPosition = (
  lottiePath: string,
  dropPosition: { x: number; y: number },
  targetContainerId: string,
  components: Component[],
  addComponent: (component: Component) => void,
  size?: { width: number; height: number }
): string | undefined => {
  const targetContainer = components.find(c => c.id === targetContainerId);
  if (!targetContainer) return;

  const { x: relativeX, y: relativeY } = getRelativePosition(dropPosition, targetContainer, components);
  const zIndex = getNextZIndex(components, targetContainerId);

  const lottieId = generateComponentId('hg_lottie', components, getOtherFileIds());
  const lottieComponent: Component = {
    id: lottieId,
    type: 'hg_lottie',
    name: lottieId,
    position: { 
      x: relativeX, 
      y: relativeY, 
      width: size?.width || 150, 
      height: size?.height || 150 
    },
    visible: true,
    enabled: true,
    locked: false,
    zIndex,
    children: [],
    parent: targetContainerId,
    style: {},
    data: { 
      src: lottiePath,
      autoplay: true,
      loop: true
    },
  };

  addComponent(lottieComponent);
  return lottieId;
};

  // ============ 统一的 createXComponent 消息处理 ============

  type CreateComponentFactory = (
    path: string,
    dropPosition: { x: number; y: number },
    targetContainerId: string,
    components: Component[],
    addComponent: (component: Component) => void,
    size?: { width: number; height: number }
  ) => string | undefined;

  /**
   * 创建组件的工厂函数配置映射表
   */
  const createComponentConfigs: {
    command: string;
    factory: CreateComponentFactory;
    pathField: string;
    sizeField?: string;
  }[] = [
    { command: 'createImageComponent', factory: createImageComponentAtPosition, pathField: 'imagePath', sizeField: 'imageSize' },
    { command: 'createGifComponent', factory: createGifComponentAtPosition, pathField: 'gifPath', sizeField: 'imageSize' },
    { command: 'create3DComponent', factory: create3DComponentAtPosition, pathField: 'modelPath' },
    { command: 'createVideoComponent', factory: createVideoComponentAtPosition, pathField: 'videoPath', sizeField: 'videoSize' },
    { command: 'createSvgComponent', factory: createSvgComponentAtPosition, pathField: 'svgPath', sizeField: 'size' },
    { command: 'createGlassComponent', factory: createGlassComponentAtPosition, pathField: 'glassPath', sizeField: 'size' },
    { command: 'createLottieComponent', factory: createLottieComponentAtPosition, pathField: 'lottiePath', sizeField: 'size' },
  ];

  /**
   * 统一的 createXComponent 消息处理器
   * 根据 message.command 自动查找对应的工厂函数和路径字段
   */
  export function handleCreateComponentMessage(message: any): string | undefined {
    const config = createComponentConfigs.find(c => c.command === message.command);
    if (!config) return undefined;

    const path = message[config.pathField];
    if (!path || !message.targetContainerId || !message.dropPosition) return undefined;

    const size = config.sizeField ? message[config.sizeField] : undefined;

    return config.factory(
      path,
      message.dropPosition,
      message.targetContainerId,
      useDesignerStore.getState().components,
      useDesignerStore.getState().addComponent,
      size
    );
  }

/**
 * 处理从后端接收的消息
 */
export const handleBackendMessage = (
  message: any,
  handlers: {
    setComponents: (components: Component[]) => void;
    setProjectConfig: (config: any) => void;
    setCanvasBackgroundColor: (color: string) => void;
    selectComponent: (id: string | null) => void;
    addComponent: (component: Component) => void;
    components: Component[];
  }
): void => {
  const { setComponents, setProjectConfig, setCanvasBackgroundColor, selectComponent, addComponent, components } = handlers;

  switch (message.command) {
    case 'loadHml':
      if (message.components) {
        setComponents(message.components);
      }
      if (message.projectConfig) {
        setProjectConfig(message.projectConfig);
      }
      if (message.canvasBackgroundColor) {
        setCanvasBackgroundColor(message.canvasBackgroundColor);
      }
      break;

    case 'updateProjectConfig':
      if (message.projectConfig) {
        setProjectConfig(message.projectConfig);
      }
      break;

    case 'componentSelected':
      if (message.componentId) {
        selectComponent(message.componentId);
      }
      break;

    case 'createImageComponent':
      if (message.imagePath && message.targetContainerId && message.dropPosition) {
        const newId = createImageComponentAtPosition(
          message.imagePath,
          message.dropPosition,
          message.targetContainerId,
          components,
          addComponent,
          message.imageSize
        );
        if (newId) selectComponent(newId);
      }
      break;

    case 'createSvgComponent':
      if (message.svgPath && message.targetContainerId && message.dropPosition) {
        const newId = createSvgComponentAtPosition(
          message.svgPath,
          message.dropPosition,
          message.targetContainerId,
          components,
          addComponent,
          message.size
        );
        if (newId) selectComponent(newId);
      }
      break;

    case 'createLottieComponent':
      if (message.lottiePath && message.targetContainerId && message.dropPosition) {
        const newId = createLottieComponentAtPosition(
          message.lottiePath,
          message.dropPosition,
          message.targetContainerId,
          components,
          addComponent,
          message.size
        );
        if (newId) selectComponent(newId);
      }
      break;

    case 'deleteComponentsByImagePath':
      if (message.imagePath) {
        const componentsToDelete = components.filter(
          c => c.type === 'hg_image' && c.data?.src === message.imagePath
        );
        if (componentsToDelete.length > 0) {
          // 这里需要从外部传入 removeComponents 方法
          console.log(`[删除组件] 需要删除 ${componentsToDelete.length} 个引用 ${message.imagePath} 的图片组件`);
        }
      }
      break;

    case 'pathConverted':
      // 路径转换结果，由 useWebviewUri hook 处理
      break;

    case 'assetsLoaded':
      // 资源加载完成，由 AssetsPanel 处理
      break;

    default:
      // 未知消息类型
      break;
  }
};
