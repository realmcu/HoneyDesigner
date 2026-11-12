import React, { useState, useEffect, useCallback } from 'react';
import { PropertyPanelProps } from './types';
import { PropertyEditor } from './PropertyEditor';
import { CollapsibleGroup } from './CollapsibleGroup';
import { isContainerType } from '../../utils/componentUtils';
import { validateComponentId } from '../../utils/validation';
import { useDesignerStore } from '../../store';
import { t } from '../../i18n';
import { TimerAction, TimerConfig } from '../../../hml/types';
import { SharedStyleSelector } from './SharedStyleSelector';

interface BasePropertiesProps extends PropertyPanelProps {
  disableSize?: boolean;
  sizeTooltip?: string;
  disablePosition?: boolean;  // 是否禁用 x/y 编辑（固定为 0）
  positionTooltip?: string;   // x/y 禁用时的提示文字
  hideParent?: boolean;  // 是否隐藏父对象选择（用于 hg_view 等顶级容器）
  disableParent?: boolean;  // 是否禁用父对象选择（用于 hg_list_item）
  children?: React.ReactNode;  // 允许插入自定义内容
}

export const BaseProperties: React.FC<BasePropertiesProps> = ({ 
  component, 
  onUpdate,
  components = [],
  disableSize = false,
  sizeTooltip,
  disablePosition = false,
  positionTooltip,
  hideParent = false,
  disableParent = false,
  children,
}) => {
  const handlePositionChange = (field: 'x' | 'y' | 'width' | 'height', value: number) => {
    // 对于 3D 组件，XY 必须是整数
    let finalValue = value;
    if (component.type === 'hg_3d' && (field === 'x' || field === 'y')) {
      finalValue = Math.round(value);
    }
    
    onUpdate({
      position: {
        ...component.position,
        [field]: finalValue,
      },
    });
  };

  // 获取当前组件所属的根 hg_view
  const getRootView = (comp: typeof component): typeof component | null => {
    if (comp.type === 'hg_view') {
      return comp;
    }
    if (comp.parent) {
      const parent = components.find(c => c.id === comp.parent);
      if (parent) {
        return getRootView(parent);
      }
    }
    return null;
  };

  // 获取可选的父容器列表（只限当前 hg_view 内的容器，排除自己和自己的子孙）
  const getAvailableParents = () => {
    const rootView = getRootView(component);
    if (!rootView) return [];

    const descendants = new Set<string>();
    const findDescendants = (id: string) => {
      components.forEach(c => {
        if (c.parent === id) {
          descendants.add(c.id);
          findDescendants(c.id);
        }
      });
    };
    findDescendants(component.id);

    // 获取当前 view 下的所有组件
    const viewComponents = new Set<string>();
    const collectViewComponents = (id: string) => {
      viewComponents.add(id);
      components.forEach(c => {
        if (c.parent === id) {
          collectViewComponents(c.id);
        }
      });
    };
    collectViewComponents(rootView.id);

    return components.filter(c => 
      c.id !== component.id && 
      !descendants.has(c.id) &&
      viewComponents.has(c.id) &&
      isContainerType(c.type)
    );
  };

  const availableParents = getAvailableParents();
  const currentParent = components.find(c => c.id === component.parent);

  // 获取 moveComponent 函数
  const moveComponent = useDesignerStore(state => state.moveComponent);

  // 处理父对象变更
  const handleParentChange = useCallback((newParentId: string | null) => {
    if (newParentId === component.parent) return;
    moveComponent(component.id, newParentId);
  }, [component.id, component.parent, moveComponent]);

  // ID 编辑状态
  const [editingId, setEditingId] = useState(component.id);
  const [idError, setIdError] = useState<string | null>(null);
  const renameComponent = useDesignerStore(state => state.renameComponent);
  
  // 保存当前正在编辑的组件 ID 和编辑值（用于组件切换时提交）
  const editingComponentIdRef = React.useRef(component.id);
  const editingIdRef = React.useRef(component.id);
  editingIdRef.current = editingId;

  // 组件切换或卸载时提交之前的更改
  useEffect(() => {
    setEditingId(component.id);
    setIdError(null);
    editingComponentIdRef.current = component.id;
    // 同步更新 editingIdRef，防止 useEffect 和 re-render 之间的时间窗口
    // 导致 stale blur handler 读到不一致的 ref 值
    editingIdRef.current = component.id;

    return () => {
      // cleanup: 组件切换（同类型 re-render）或卸载（不同类型）时都会执行
      const originalId = editingComponentIdRef.current;
      const pendingValue = editingIdRef.current;
      if (pendingValue !== originalId && pendingValue.trim()) {
        const store = useDesignerStore.getState();
        const allIds = store.components.map(c => c.id);
        const result = validateComponentId(pendingValue, allIds, originalId);
        if (result.valid) {
          const success = store.renameComponent(originalId, pendingValue);
          if (success) {
            store.updateComponent(pendingValue, { name: pendingValue });
          }
        }
      }
    };
  }, [component.id]);

  const handleIdChange = (value: string) => {
    setEditingId(value);
    editingIdRef.current = value;
    
    // 实时校验
    const allIds = components.map(c => c.id);
    const result = validateComponentId(value, allIds, editingComponentIdRef.current);
    setIdError(result.valid ? null : result.error || null);
  };

  const handleIdCommit = () => {
    const originalId = editingComponentIdRef.current;
    // 使用 ref 而非闭包中的 state，避免组件切换时 stale closure 导致误操作
    const pendingId = editingIdRef.current;
    if (pendingId === originalId) return; // 没有变化
    if (idError) {
      // 校验失败，恢复原值
      setEditingId(originalId);
      editingIdRef.current = originalId;
      setIdError(null);
      return;
    }
    
    // 执行重命名（使用保存的原始 ID）
    const success = renameComponent(originalId, pendingId);
    if (!success) {
      setEditingId(originalId);
      editingIdRef.current = originalId;
      setIdError(t('Rename failed'));
    } else {
      // 更新引用为新的 ID
      editingComponentIdRef.current = pendingId;
      editingIdRef.current = pendingId;
      // 同步 name 为新的 ID 值
      onUpdate({ name: pendingId });
    }
  };

  const handleIdBlur = () => {
    handleIdCommit();
  };

  return (
    <>
      {/* 基本信息（不可折叠） */}
      <div className="property-group">
        <div className="property-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ minWidth: '42px', flexShrink: 0, marginBottom: 0 }}>{t('Name')}</label>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              type="text"
              value={editingId}
              onChange={(e) => handleIdChange(e.target.value)}
              onBlur={handleIdBlur}
              onKeyDown={(e) => { 
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleIdCommit();
                }
              }}
              style={{
                width: '100%',
                padding: '4px 8px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: idError 
                  ? '1px solid var(--vscode-inputValidation-errorBorder, #f44)' 
                  : '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontFamily: 'monospace',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
            {idError && (
              <div style={{ 
                color: 'var(--vscode-inputValidation-errorForeground, #f44)', 
                fontSize: '11px', 
                marginTop: '2px' 
              }}>
                {idError}
              </div>
            )}
          </div>
        </div>

        {/* Parent selection */}
        {!hideParent && (
          <div className="property-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ minWidth: '42px', flexShrink: 0, marginBottom: 0 }}>{t('Parent')}</label>
            <select
              value={component.parent || ''}
              onChange={(e) => handleParentChange(e.target.value || null)}
              disabled={disableParent}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '4px 8px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
              }}
            >
              <option value="">{t('None')}</option>
              {/* If current parent is not in available list, show it anyway */}
              {currentParent && !availableParents.find(p => p.id === currentParent.id) && (
                <option key={currentParent.id} value={currentParent.id}>
                  {currentParent.name} ({currentParent.type})
                </option>
              )}
              {availableParents.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 共享样式引用：容器类组件由各自面板提供入口 */}
        {component.type !== 'hg_view' && component.type !== 'hg_window' && (
          <SharedStyleSelector component={component} onUpdate={onUpdate} />
        )}
      </div>

      {/* 插入自定义内容（布局之前） */}
      {children}

      {/* 布局（可折叠） */}
      <CollapsibleGroup title={t('Layout')} cacheKey="base-layout">
        <div className="property-item">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '12px' }}>X</label>
              <PropertyEditor
                type="number"
                value={component.position.x}
                onChange={(value) => handlePositionChange('x', value)}
                disabled={disablePosition}
                title={positionTooltip}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px' }}>Y</label>
              <PropertyEditor
                type="number"
                value={component.position.y}
                onChange={(value) => handlePositionChange('y', value)}
                disabled={disablePosition}
                title={positionTooltip}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px' }}>{t('Width')}</label>
              <PropertyEditor
                type="number"
                value={component.position.width}
                onChange={(value) => handlePositionChange('width', value)}
                disabled={disableSize}
                title={sizeTooltip}
                min={0}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px' }}>{t('Height')}</label>
              <PropertyEditor
                type="number"
                value={component.position.height}
                onChange={(value) => handlePositionChange('height', value)}
                disabled={disableSize}
                title={sizeTooltip}
                min={0}
              />
            </div>
          </div>
        </div>
      </CollapsibleGroup>

      {/* 状态（可折叠） */}
      <CollapsibleGroup title={t('State')} cacheKey="base-state">
        <div className="property-item">
          <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <PropertyEditor
                type="boolean"
                value={component.visible}
                onChange={(value) => onUpdate({ visible: value })}
              />
              <span style={{ fontSize: '12px' }}>{t('Visible')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <PropertyEditor
                type="boolean"
                value={component.enabled}
                onChange={(value) => onUpdate({ enabled: value })}
              />
              <span style={{ fontSize: '12px' }}>{t('Enabled')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <PropertyEditor
                type="boolean"
                value={component.locked}
                onChange={(value) => onUpdate({ locked: value })}
              />
              <span style={{ fontSize: '12px' }}>{t('Locked')}</span>
            </div>
          </div>
        </div>

        {/* Expand preview toggle for non-top-level containers */}
        {['hg_list', 'hg_canvas', 'hg_list_item'].includes(component.type) && (
          <div className="property-item">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PropertyEditor
                type="boolean"
                value={component.showOverflow ?? false}
                onChange={(value) => onUpdate({ showOverflow: value })}
              />
              <span style={{ fontSize: '12px' }}>{t('Show Overflow')}</span>
            </div>
          </div>
        )}
      </CollapsibleGroup>
    </>
  );
};
