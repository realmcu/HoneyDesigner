/**
 * 页面切换的「预览转场」按钮；进入动画选了自定义转场时另附说明
 */
import React from 'react';
import { useDesignerStore } from '../../store';
import { t } from '../../i18n';
import { isCustomViewTransition } from '../../../shared/viewTransition';
import { ownerViewOf, playTransitionPreview, targetViewOf } from '../../utils/transitionPreview';

interface ViewTransitionHintProps {
  /** 触发切换的组件 id（用来找它所在的页面） */
  sourceId: string;
  target: string | undefined;
  switchOutStyle: string | undefined;
  switchInStyle: string | undefined;
}

export const ViewTransitionHint: React.FC<ViewTransitionHintProps> = ({ sourceId, target, switchOutStyle, switchInStyle }) => {
  const components = useDesignerStore((state) => state.components);
  const custom = isCustomViewTransition(switchInStyle);
  const source = components.find(c => c.id === sourceId);
  const fromView = source ? ownerViewOf(source, components) : null;
  const toView = targetViewOf(target, components);
  const canPreview = !!fromView && !!toView && fromView.id !== toView.id;
  if (!custom && !canPreview) {
    return null;
  }
  return (
    <div style={{ fontSize: '11px', lineHeight: 1.6, color: 'var(--vscode-descriptionForeground)', marginTop: '6px' }}>
      {custom && (
        <>
          <div>{t('Custom transitions also move the current page, so the exit style is ignored. Swipe gestures fall back to the closest engine style.')}</div>
          <div>{t('Shared elements in both pages fly across: give them the same tag here.')}</div>
        </>
      )}
      {canPreview && (
        <button
          type="button"
          style={{ marginTop: '4px' }}
          onClick={() => playTransitionPreview(switchOutStyle, switchInStyle, fromView, toView, components)}
        >
          {t('Preview Transition')}
        </button>
      )}
    </div>
  );
};
