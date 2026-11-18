/**
 * 组件级「按下反馈」设置：是给单个图标、形状开关的，不是整页开关。
 * 选中组件后在属性面板底部出现；容器类组件（view / window / list）不显示。
 */
import React from 'react';
import { PropertyPanelProps } from './types';
import { CollapsibleGroup } from './CollapsibleGroup';
import { t } from '../../i18n';
import { PRESS_CONTAINER_TYPES, readPressFeedback } from '../../../shared/pressFeedback';
import { playPressPreview } from '../../utils/pressPreview';

export const PressFeedbackProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate }) => {
  if (PRESS_CONTAINER_TYPES.includes(component.type)) {
    return null;
  }

  const mode = readPressFeedback(component.data)?.mode ?? 'none';

  const handleChange = (value: string) => {
    const data = { ...(component.data ?? {}) };
    if (value === 'none') {
      delete data.pressEffect;
    } else {
      data.pressEffect = value;
    }
    // 走统一的撤销/重做与 HML 落盘
    onUpdate({ data });
  };

  return (
    <CollapsibleGroup title={t('Press Feedback')} cacheKey="component-press" defaultCollapsed={mode === 'none'}>
      <div className="property-item" title={t('Press Feedback Tooltip')}>
        <label>{t('Press Effect')}</label>
        <select
          value={mode}
          onChange={(e) => handleChange(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ width: '100%' }}
        >
          <option value="none">{t('None')}</option>
          <option value="pop">{t('Pop out and fade (app grid)')}</option>
          <option value="press">{t('Sink slightly (cards)')}</option>
        </select>
      </div>
      {mode !== 'none' && (
        <div className="property-item">
          <button onClick={() => playPressPreview(component)} style={{ width: '100%' }}>
            {t('Preview Press')}
          </button>
        </div>
      )}
    </CollapsibleGroup>
  );
};
