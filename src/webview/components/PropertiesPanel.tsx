import React, { useEffect } from 'react';
import { useDesignerStore } from '../store';
import { syncPressPreview } from '../utils/pressPreview';
import { propertyPanelRegistry } from './properties';
import { PressFeedbackProperties } from './properties/PressFeedbackProperties';
import { t } from '../i18n';
import './PropertiesPanel.css';

const PropertiesPanel: React.FC = () => {
  const { selectedComponent, updateComponent, components } = useDesignerStore();
  const selected = useDesignerStore.getState().getSelectedComponent();

  // 按下反馈的预览标记跟着组件数据走
  useEffect(() => {
    syncPressPreview(components);
  }, [components]);

  if (!selected) {
    return (
      <div className="properties-panel">
        <div className="properties-header">
          <h3>{t('Properties')}</h3>
        </div>
        <div className="properties-content">
          <div className="no-selection">{t('Please select a component')}</div>
        </div>
      </div>
    );
  }

  const PropertyPanel = propertyPanelRegistry[selected.type];

  const handleUpdate = (updates: Partial<typeof selected>) => {
    if (!selectedComponent) return;
    updateComponent(selectedComponent, updates);
  };

  return (
    <div className="properties-panel">
      <div className="properties-header">
        <h3>{t('Properties')}</h3>
      </div>

      {PropertyPanel ? (
        <>
          <PropertyPanel component={selected} onUpdate={handleUpdate} components={components} />
          {/* 组件级按下反馈：单个图标、形状也能开关 */}
          <PressFeedbackProperties component={selected} onUpdate={handleUpdate} components={components} />
        </>
      ) : (
        <div className="properties-content">
          <div className="no-selection">{t('Unknown component type')}: {selected.type}</div>
        </div>
      )}
    </div>
  );
};

export default PropertiesPanel;
