import { Component, ComponentType } from '../types';

/**
 * 可包含子组件的容器类型
 */
const CONTAINER_TYPES: ComponentType[] = ['hg_view', 'hg_window', 'hg_canvas', 'hg_list', 'hg_list_item'];

/**
 * 可作为拖放目标的容器类型（用户可拖入子组件）
 */
const DROP_TARGET_TYPES: ComponentType[] = ['hg_view', 'hg_window', 'hg_list_item'];

/**
 * 判断组件类型是否为容器（可包含子组件）
 */
export function isContainerType(type: ComponentType | string): boolean {
  return CONTAINER_TYPES.includes(type as ComponentType);
}

/**
 * 判断组件类型是否可作为拖放目标
 */
export function isDropTargetType(type: ComponentType | string): boolean {
  return DROP_TARGET_TYPES.includes(type as ComponentType);
}

/**
 * 获取组件的绝对位置（相对于画布）
 * 递归计算父组件的位置累加
 */
export const getAbsolutePosition = (
  comp: Component,
  components: Component[]
): { x: number; y: number } => {
  if (!comp.parent) {
    return { x: comp.position.x, y: comp.position.y };
  }
  
  const parentComp = components.find(c => c.id === comp.parent);
  if (!parentComp) {
    return { x: comp.position.x, y: comp.position.y };
  }
  
  const parentPos = getAbsolutePosition(parentComp, components);
  return {
    x: parentPos.x + comp.position.x,
    y: parentPos.y + comp.position.y
  };
};

/**
 * 判断 ancestorId 是否为 descendantId 的祖先容器。
 *
 * 画布命中时用得到：子控件的元素本身就嵌在父容器的元素里，元素栈天然会把父容器
 * 一起带出来；祖先容器不应该抢走已选中子控件的拖动。
 */
export const isAncestorOfComponent = (
  ancestorId: string,
  descendantId: string,
  components: Component[]
): boolean => {
  if (ancestorId === descendantId) {
    return false;
  }
  let parent = components.find(c => c.id === descendantId)?.parent ?? null;
  const guard = new Set<string>();
  while (parent && !guard.has(parent)) {
    if (parent === ancestorId) {
      return true;
    }
    guard.add(parent);
    parent = components.find(c => c.id === parent)?.parent ?? null;
  }
  return false;
};

/**
 * 查找指定位置的目标容器组件
 * 只返回容器类型（hg_view 或 hg_window）
 * 返回最小的包含该位置的容器
 * 当面积相同时，优先选择 z-index 更大或数组位置更靠后的组件
 */
export const findComponentAtPosition = (
  x: number,
  y: number,
  components: Component[]
): Component | null => {
  let targetContainer: Component | null = null;
  let targetArea = Infinity;
  let targetIndex = -1;
  
  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    
    // 只查找容器类型
    if (!isContainerType(comp.type)) {
      continue;
    }
    
    const absPos = getAbsolutePosition(comp, components);
    const { width: cw, height: ch } = comp.position;
    
    if (x >= absPos.x && x <= absPos.x + cw && y >= absPos.y && y <= absPos.y + ch) {
      const area = cw * ch;
      
      // 选择面积更小的容器，或面积相同时选择数组位置更靠后的（渲染层级更高）
      if (!targetContainer || area < targetArea || (area === targetArea && i > targetIndex)) {
        targetContainer = comp;
        targetArea = area;
        targetIndex = i;
      }
    }
  }
  
  return targetContainer;
};

/**
 * 检测有断裂事件引用的组件
 * 返回有问题的组件 ID 集合
 */
/**
 * 检测有断裂事件引用的组件
 * 返回有问题的组件 ID 集合
 * @param allViewIds 项目中所有 HML 文件的 view ID 集合（用于跨文件 switchView 验证）
 */
export function findComponentsWithBrokenRefs(components: Component[], allViewIds?: Set<string>): Set<string> {
  const componentIds = new Set(components.map(c => c.id));
  const broken = new Set<string>();

  for (const comp of components) {
    if (!comp.eventConfigs) continue;

    for (const eventConfig of comp.eventConfigs) {
      for (const action of eventConfig.actions) {
        // 检查 controlTimer 引用（只检查当前文件，定时器不跨文件）
        if (action.type === 'controlTimer' && action.timerTargets) {
          for (const target of action.timerTargets) {
            if (!componentIds.has(target.componentId)) {
              broken.add(comp.id);
              break;
            }
            const targetComp = components.find(c => c.id === target.componentId);
            if (target.timerIndex !== undefined && targetComp) {
              // hg_timer_label 只有一个隐含的定时器
              if (targetComp.type === 'hg_timer_label' && target.timerIndex === 0) continue;
              const timers = targetComp.data?.timers;
              if (!timers || !Array.isArray(timers) || !timers[target.timerIndex]) {
                broken.add(comp.id);
                break;
              }
            }
          }
        }
        // 检查 switchView 引用（支持跨文件 view）
        if (action.type === 'switchView' && action.target) {
          const existsInCurrentFile = componentIds.has(action.target);
          const existsInAllViews = allViewIds ? allViewIds.has(action.target) : false;
          if (!existsInCurrentFile && !existsInAllViews) {
            broken.add(comp.id);
          }
        }
        if (broken.has(comp.id)) break;
      }
      if (broken.has(comp.id)) break;
    }
  }

  return broken;
}

/**
 * 检查单个 timerTarget 引用是否断裂
 */
export function isTimerTargetBroken(
  target: { componentId: string; timerIndex?: number },
  components: Component[]
): boolean {
  const targetComp = components.find(c => c.id === target.componentId);
  if (!targetComp) return true;
  if (target.timerIndex !== undefined) {
    if (targetComp.type === 'hg_timer_label' && target.timerIndex === 0) return false;
    const timers = targetComp.data?.timers;
    if (!timers || !Array.isArray(timers) || !timers[target.timerIndex]) return true;
  }
  return false;
}
