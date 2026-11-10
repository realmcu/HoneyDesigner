import React, { useEffect, useRef } from 'react';
import { WidgetProps } from './types';
import { useDesignerStore, type DesignerStore } from '../../store';
import { withoutHistory } from '../../store/history';

/**
 * 计算列表项的位置
 */
const calculateItemPosition = (
  index: number,
  itemWidth: number,
  itemHeight: number,
  space: number,
  isVertical: boolean
) => ({
  x: isVertical ? 0 : index * (itemWidth + space),
  y: isVertical ? index * (itemHeight + space) : 0,
  width: itemWidth,
  height: itemHeight,
});

/**
 * 列表控件
 * 数量增减由 syncListItems（store）负责，此处只同步已有 item 的位置
 */
export const ListWidget: React.FC<WidgetProps> = ({ component, style, handlers, children }) => {
  const syncInProgress = useRef(false);
  const lastSyncKey = useRef('');
  const getState = useDesignerStore.getState;

  useEffect(() => {
    // 只在布局属性变化时同步位置
    const syncKey = JSON.stringify({
      id: component.id,
      itemWidth: component.style?.itemWidth,
      itemHeight: component.style?.itemHeight,
      space: component.style?.space,
      direction: component.style?.direction,
    });

    if (syncKey === lastSyncKey.current) return;
    lastSyncKey.current = syncKey;

    if (syncInProgress.current) return;
    syncInProgress.current = true;

    try {
      const { components } = getState();
      // 派生排布不单独成为一步撤销
      const updateComponent: DesignerStore['updateComponent'] = (id, updates, options) =>
        withoutHistory(() => getState().updateComponent(id, updates, options));

      const itemWidth = parseInt(String(component.style?.itemWidth)) || 100;
      const itemHeight = parseInt(String(component.style?.itemHeight)) || 100;
      const space = parseInt(String(component.style?.space)) || 0;
      const direction = (component.style?.direction as string) || 'VERTICAL';
      const isVertical = direction === 'VERTICAL';

      // 同步列表自身宽/高与 itemWidth/itemHeight 对齐
      const positionUpdates: Partial<typeof component.position> = {};
      if (isVertical && component.position.width !== itemWidth) {
        positionUpdates.width = itemWidth;
      } else if (!isVertical && component.position.height !== itemHeight) {
        positionUpdates.height = itemHeight;
      }
      if (Object.keys(positionUpdates).length > 0) {
        updateComponent(component.id, {
          position: { ...component.position, ...positionUpdates },
        }, { save: false });
      }

      // 双重过滤：parent 字段 OR 在 children 数组中，防止 parent 字段不一致
      const listChildrenSet = new Set(component.children || []);
      const existingListItems = components
        .filter(c => c.type === 'hg_list_item' && (c.parent === component.id || listChildrenSet.has(c.id)))
        .sort((a, b) => ((a.data?.index as number) ?? 0) - ((b.data?.index as number) ?? 0));

      // 只更新已有 item 的位置，不增减数量
      existingListItems.forEach((item, index) => {
        const newPosition = calculateItemPosition(index, itemWidth, itemHeight, space, isVertical);
        const hasChange =
          item.position.x !== newPosition.x ||
          item.position.y !== newPosition.y ||
          item.position.width !== newPosition.width ||
          item.position.height !== newPosition.height;
        if (hasChange) {
          updateComponent(item.id, { position: newPosition }, { save: false });
        }
      });
    } finally {
      syncInProgress.current = false;
    }
  }, [
    component.id,
    component.style?.itemWidth,
    component.style?.itemHeight,
    component.style?.space,
    component.style?.direction,
    component.position.width,
    component.position.height,
    component.children,
    getState,
  ]);

  return (
    <div key={component.id} style={style} {...handlers}>
      {children}
    </div>
  );
};
