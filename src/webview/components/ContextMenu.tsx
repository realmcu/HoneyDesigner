import React, { useEffect, useRef, useState } from 'react';
import { Component } from '../types';
import { getMenuItems, getMenuItemLabel, MenuItem } from '../config/contextMenuConfig';
import { t } from '../i18n';

interface ContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  component: Component | null;
  hasClipboard?: boolean;
  multiSelectCount?: number;
  onAction: (actionId: string, component: Component) => void;
}

/**
 * 计算菜单的最佳显示位置，避免被遮挡，同时保持紧贴鼠标
 */
function calculateMenuPosition(
  mouseX: number, 
  mouseY: number, 
  menuWidth: number, 
  menuHeight: number
): { x: number; y: number } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const minPadding = 2; // 距离边界的最小间距
  
  let x = mouseX;
  let y = mouseY;
  
  // 水平位置调整 - 始终紧贴鼠标
  if (mouseX + menuWidth > viewportWidth - minPadding) {
    // 右侧空间不足，显示在鼠标左侧，紧贴鼠标
    x = mouseX - menuWidth;
    // 如果左侧也超出边界，则调整到能完全显示的最右位置
    if (x < minPadding) {
      x = minPadding;
    }
  }
  
  // 垂直位置调整 - 始终紧贴鼠标
  if (mouseY + menuHeight > viewportHeight - minPadding) {
    // 下方空间不足，显示在鼠标上方，紧贴鼠标
    y = mouseY - menuHeight;
    // 如果上方也超出边界，则调整到能完全显示的最下位置
    if (y < minPadding) {
      y = minPadding;
    }
  }
  
  return { x, y };
}

/**
 * 菜单项组件
 */
const MenuItemComponent: React.FC<{
  item: MenuItem;
  label: string;
  onClick: () => void;
}> = ({ item, label, onClick }) => {
  return (
    <>
      <div
        style={{
          padding: '8px 16px',
          cursor: 'pointer',
          fontSize: '13px',
          color: item.danger ? '#d32f2f' : 'var(--vscode-foreground, #333)',
          backgroundColor: 'transparent',
          transition: 'background-color 0.1s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--vscode-list-hoverBackground, #f0f0f0)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
        onClick={onClick}
      >
        {label}
      </div>
      {item.dividerAfter && (
        <div style={{ 
          height: '1px', 
          backgroundColor: 'var(--vscode-menu-separatorBackground, #e0e0e0)', 
          margin: '4px 0' 
        }} />
      )}
    </>
  );
};

/**
 * 右键菜单组件
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({
  visible,
  x,
  y,
  component,
  hasClipboard = false,
  multiSelectCount = 0,
  onAction,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y });

  // 当菜单显示时，调整位置
  useEffect(() => {
    if (visible && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const newPosition = calculateMenuPosition(x, y, rect.width, rect.height);
      setAdjustedPosition(newPosition);
    }
  }, [visible, x, y]);

  if (!visible || !component) return null;

  const menuItems = getMenuItems(component.type, hasClipboard, multiSelectCount);
  
  const getItemLabel = (item: MenuItem) => {
    const label = getMenuItemLabel(item, component);
    if (multiSelectCount > 1) {
      if (item.id === 'copy') return t('Copy N components').replace('{n}', String(multiSelectCount));
      if (item.id === 'cut') return t('Cut N components').replace('{n}', String(multiSelectCount));
    }
    return label;
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        backgroundColor: 'var(--vscode-menu-background, #fff)',
        border: '1px solid var(--vscode-menu-border, #ccc)',
        borderRadius: '4px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10000,
        minWidth: '160px',
        padding: '4px 0',
        opacity: visible ? 1 : 0,
        visibility: visible ? 'visible' : 'hidden',
        transition: 'opacity 0.1s ease',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {menuItems.map((item) => (
        <MenuItemComponent
          key={item.id}
          item={item}
          label={getItemLabel(item)}
          onClick={() => onAction(item.id, component)}
        />
      ))}
    </div>
  );
};
