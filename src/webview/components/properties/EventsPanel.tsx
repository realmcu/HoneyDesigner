/**
 * 事件面板组件 - Event-Action 配置
 */
import React, { useState, useEffect } from 'react';
import { Component } from '../../types';
import { useDesignerStore } from '../../store';
import {
  EventConfig,
  Action,
  EventType,
  ActionType,
  getSupportedEvents,
  EVENT_LABEL_KEYS,
  ACTION_LABEL_KEYS,
  SWITCH_OUT_STYLES,
  SWITCH_IN_STYLES,
  KEY_NAMES,
} from '../../../hml/eventTypes';

const SWIPE_EVENT_TYPES: EventType[] = [
  'onSwipeLeft', 'onSwipeRight', 'onSwipeUp', 'onSwipeDown',
];

const SWIPE_MUTEX_PAIRS: Record<string, string> = {
  'onSwipeLeft': 'onSwipeLeftQuick',
  'onSwipeLeftQuick': 'onSwipeLeft',
  'onSwipeRight': 'onSwipeRightQuick',
  'onSwipeRightQuick': 'onSwipeRight',
  'onSwipeUp': 'onSwipeUpQuick',
  'onSwipeUpQuick': 'onSwipeUp',
  'onSwipeDown': 'onSwipeDownQuick',
  'onSwipeDownQuick': 'onSwipeDown',
};
import { t } from '../../i18n';
import { isTimerTargetBroken } from '../../utils/componentUtils';
import { TimerProperties } from './TimerProperties';
import './EventsPanel.css';

interface EventsPanelProps {
  component: Component;
  onUpdate: (updates: Partial<Component>) => void;
}

export const EventsPanel: React.FC<EventsPanelProps> = ({ component, onUpdate }) => {
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set([0]));
  const [timerExpanded, setTimerExpanded] = useState<boolean>(false);
  const [userFunctions, setUserFunctions] = useState<Array<{ name: string; type: 'event' | 'message' }>>([]);
  const userFunctionsLoaded = React.useRef(false);
  const components = useDesignerStore((state) => state.components);
  const allViews = useDesignerStore((state) => state.allViews || []);

  const eventConfigs = component.eventConfigs || [];
  const supportedEvents = getSupportedEvents(component.type);

  // 加载用户自定义函数列表
  useEffect(() => {
    // 请求后端加载用户函数
    window.vscodeAPI?.postMessage({ command: 'getUserFunctions' });

    // 监听后端返回的用户函数列表
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'userFunctionsLoaded') {
        userFunctionsLoaded.current = true;
        setUserFunctions(message.functions || []);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 当用户函数列表更新时，清除引用已删除函数的 action
  useEffect(() => {
    if (!userFunctionsLoaded.current || !eventConfigs.length) return;
    const validNames = new Set(userFunctions.map(f => f.name));
    let changed = false;
    const newConfigs = eventConfigs.map(config => {
      const newActions = config.actions.map(action => {
        if (action.type === 'callFunction' && action.functionName && !validNames.has(action.functionName)) {
          changed = true;
          return { ...action, functionName: '' };
        }
        return action;
      });
      return { ...config, actions: newActions };
    });
    if (changed) {
      onUpdate({ eventConfigs: newConfigs });
    }
  }, [userFunctions]);

  // 获取可用的视图列表（当前文件 + 其他文件）
  const getAvailableViews = () => {
    // 当前文件的 view
    const currentViews = components
      .filter(c => c.type === 'hg_view' && c.id !== component.id)
      .map(c => ({
        id: c.id,
        name: c.name || c.id,
        file: 'current'  // 使用常量标识符
      }));
    
    // 其他文件的 view（排除当前文件中已有的）
    const currentViewIds = new Set(currentViews.map(v => v.id));
    const otherViews = allViews.filter(v => !currentViewIds.has(v.id));
    
    return [...currentViews, ...otherViews];
  };

  // 添加事件
  const handleAddEvent = () => {
    const usedEvents = new Set(eventConfigs.map(e => e.type));
    // 同向快滑/慢滑互斥：已配置的事件及其 counterpart 都不可选
    for (const used of usedEvents) {
      const counterpart = SWIPE_MUTEX_PAIRS[used];
      if (counterpart) {
        usedEvents.add(counterpart as EventType);
      }
    }
    const availableEvents = supportedEvents.filter(e => !usedEvents.has(e));
    
    if (availableEvents.length === 0) return;

    const newEvent: EventConfig = {
      type: availableEvents[0],
      actions: [],
    };

    onUpdate({
      eventConfigs: [...eventConfigs, newEvent],
    });
    setExpandedEvents(new Set([...expandedEvents, eventConfigs.length]));
  };

  // 删除事件
  const handleRemoveEvent = (index: number) => {
    onUpdate({
      eventConfigs: eventConfigs.filter((_, i) => i !== index),
    });
  };

  // 更新事件类型
  const handleEventTypeChange = (index: number, type: EventType) => {
    // 同向快滑/慢滑互斥检查
    const counterpart = SWIPE_MUTEX_PAIRS[type];
    if (counterpart && eventConfigs.some((ec, i) => i !== index && ec.type === counterpart)) {
      return;
    }
    const newConfigs = [...eventConfigs];
    newConfigs[index] = { ...newConfigs[index], type };
    if (type === 'onMessage') {
      newConfigs[index].message = newConfigs[index].message || '';
    }
    onUpdate({ eventConfigs: newConfigs });
  };

  // 更新消息名
  const handleMessageChange = (index: number, message: string) => {
    const newConfigs = [...eventConfigs];
    newConfigs[index] = { ...newConfigs[index], message };
    onUpdate({ eventConfigs: newConfigs });
  };

  // 更新按键名
  const handleKeyNameChange = (index: number, keyName: string) => {
    const newConfigs = [...eventConfigs];
    newConfigs[index] = { ...newConfigs[index], keyName };
    onUpdate({ eventConfigs: newConfigs });
  };

  // 生成默认回调函数名
  const getDefaultHandler = (eventIndex: number): string => {
    // 计算当前事件在 onMessage 事件中的序号
    let msgIndex = 0;
    for (let i = 0; i < eventIndex; i++) {
      if (eventConfigs[i].type === 'onMessage') {
        msgIndex++;
      }
    }
    return `${component.id}_msg_cb_${msgIndex}`;
  };

  // 验证回调函数名
  const validateHandler = (handler: string, currentIndex: number): string | null => {
    if (!handler) return null;
    // 检查格式：只允许字母、数字、下划线，不能以数字开头
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(handler)) {
      return t('Function name can only contain letters, numbers, underscores, and cannot start with a number');
    }
    // 检查重复：在所有组件中查找
    for (const comp of components) {
      if (!comp.eventConfigs) continue;
      for (let i = 0; i < comp.eventConfigs.length; i++) {
        const ec = comp.eventConfigs[i];
        if (ec.type === 'onMessage' && ec.handler === handler) {
          // 排除当前正在编辑的
          if (comp.id === component.id && i === currentIndex) continue;
          return t('Function name already used by component') + ` "${comp.id}"`;
        }
      }
    }
    return null;
  };

  // 更新回调函数名
  const [handlerError, setHandlerError] = useState<string | null>(null);
  const handleHandlerChange = (index: number, handler: string) => {
    const error = validateHandler(handler, index);
    setHandlerError(error);
    
    const newConfigs = [...eventConfigs];
    newConfigs[index] = { ...newConfigs[index], handler };
    onUpdate({ eventConfigs: newConfigs });
  };

  // 添加动作
  const handleAddAction = (eventIndex: number) => {
    const currentEvent = eventConfigs[eventIndex];
    const hasSwitchView = currentEvent.actions.some(a => a.type === 'switchView');
    
    // 如果已有 switchView，默认添加 sendMessage，否则添加 switchView
    const newAction: Action = hasSwitchView 
      ? { type: 'sendMessage', message: '' }
      : { type: 'switchView', target: '' };
    
    const newConfigs = [...eventConfigs];
    newConfigs[eventIndex] = {
      ...newConfigs[eventIndex],
      actions: [...newConfigs[eventIndex].actions, newAction],
    };
    onUpdate({ eventConfigs: newConfigs });
  };

  // 删除动作
  const handleRemoveAction = (eventIndex: number, actionIndex: number) => {
    const newConfigs = [...eventConfigs];
    newConfigs[eventIndex] = {
      ...newConfigs[eventIndex],
      actions: newConfigs[eventIndex].actions.filter((_, i) => i !== actionIndex),
    };
    onUpdate({ eventConfigs: newConfigs });
  };

  // 更新动作
  const handleActionUpdate = (eventIndex: number, actionIndex: number, updates: Partial<Action>) => {
    const newConfigs = [...eventConfigs];
    const actions = [...newConfigs[eventIndex].actions];
    actions[actionIndex] = { ...actions[actionIndex], ...updates };
    newConfigs[eventIndex] = { ...newConfigs[eventIndex], actions };
    onUpdate({ eventConfigs: newConfigs });
  };

  // 切换展开/折叠
  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expandedEvents);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedEvents(newExpanded);
  };

  // 获取同一 view 下所有有定时器的组件
  const getTimerComponents = () => {
    // 找到当前组件所在的 view
    let currentView: Component | undefined;
    if (component.type === 'hg_view') {
      currentView = component;
    } else {
      // 向上查找父 view
      let parentId = component.parent;
      while (parentId) {
        const parent = components.find(c => c.id === parentId);
        if (parent?.type === 'hg_view') {
          currentView = parent;
          break;
        }
        parentId = parent?.parent;
      }
    }

    if (!currentView) return [];

    // 收集该 view 下所有有定时器的组件（包括 view 自己）
    const timerComponents: Array<{
      id: string;
      name: string;
      timers: Array<{ id: string; name: string; index: number }>;
    }> = [];

    const collectTimerComponents = (comp: Component) => {
      // 检查组件是否有定时器配置
      const timers = comp.data?.timers;
      if (timers && Array.isArray(timers) && timers.length > 0) {
        timerComponents.push({
          id: comp.id,
          name: comp.name || comp.id,
          timers: timers.map((timer: any, index: number) => ({
            id: timer.id,
            name: timer.name || `${t('Animation')} ${index + 1}`,
            index,
          })),
        });
      }

      // 检查是否是计时标签组件
      if (comp.type === 'hg_timer_label') {
        timerComponents.push({
          id: comp.id,
          name: comp.name || comp.id,
          timers: [{
            id: 'timer_label',
            name: t('Timer Label'),
            index: 0,
          }],
        });
      }

      // 递归处理子组件
      if (comp.children) {
        comp.children.forEach(childId => {
          const child = components.find(c => c.id === childId);
          if (child) {
            collectTimerComponents(child);
          }
        });
      }
    };

    collectTimerComponents(currentView);
    return timerComponents;
  };

  // 渲染动作编辑器
  const renderActionEditor = (action: Action, eventIndex: number, actionIndex: number) => {
    const views = getAvailableViews();
    const eventConfig = eventConfigs[eventIndex];
    const timerComponents = getTimerComponents();

    return (
      <div className="action-item" key={actionIndex}>
        <div className="action-header">
          <select
            value={action.type}
            onChange={(e) => handleActionUpdate(eventIndex, actionIndex, { type: e.target.value as ActionType })}
            className="action-type-select"
          >
            <option value="switchView" 
              disabled={eventConfig.actions.filter(a => a.type === 'switchView').length > 0 && action.type !== 'switchView'}
            >
              {t(ACTION_LABEL_KEYS.switchView as any)}
            </option>
            <option value="sendMessage">{t(ACTION_LABEL_KEYS.sendMessage as any)}</option>
            <option value="callFunction">{t(ACTION_LABEL_KEYS.callFunction as any)}</option>
            <option value="controlTimer">{t(ACTION_LABEL_KEYS.controlTimer as any)}</option>
          </select>
          <button
            className="action-remove-btn"
            onClick={() => handleRemoveAction(eventIndex, actionIndex)}
            title={t('Delete action')}
          >
            ×
          </button>
        </div>

        <div className="action-params">
          {/* switchView - 跳转界面 */}
          {action.type === 'switchView' && (
            <>
              <div className="param-row">
                <label>{t('Target View')}</label>
                <select
                  value={action.target || ''}
                  onChange={(e) => handleActionUpdate(eventIndex, actionIndex, { target: e.target.value })}
                >
                  <option value="">-- {t('Select')} --</option>
                  {views.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.file !== 'current' ? `(${v.file})` : `(${t('Current File')})`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="param-row">
                <label>{t('Exit Animation')}</label>
                <select
                  value={action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION'}
                  onChange={(e) => handleActionUpdate(eventIndex, actionIndex, { switchOutStyle: e.target.value })}
                >
                  {SWITCH_OUT_STYLES
                    .filter(s => {
                      if (SWIPE_EVENT_TYPES.includes(eventConfig.type)) {
                        return s.value !== 'SWITCH_OUT_NONE_ANIMATION';
                      }
                      return true;
                    })
                    .map(s => (
                      <option key={s.value} value={s.value}>{t(s.labelKey as any)}</option>
                    ))}
                </select>
              </div>
              <div className="param-row">
                <label>{t('Enter Animation')}</label>
                <select
                  value={action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION'}
                  onChange={(e) => handleActionUpdate(eventIndex, actionIndex, { switchInStyle: e.target.value })}
                >
                  {SWITCH_IN_STYLES.map(s => (
                    <option key={s.value} value={s.value}>{t(s.labelKey as any)}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* sendMessage - 发送消息 */}
          {action.type === 'sendMessage' && (
            <div className="param-row">
              <label>{t('Message Name')}</label>
              <input
                type="text"
                value={action.message || ''}
                onChange={(e) => handleActionUpdate(eventIndex, actionIndex, { message: e.target.value })}
                placeholder="button_clicked"
              />
            </div>
          )}

          {/* callFunction - 调用自定义函数 */}
          {action.type === 'callFunction' && (
            <div className="param-row">
              <label>{t('Custom Function')}</label>
              {userFunctions.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
                  {t('No user functions found, declare in src/user/**_user.h')}
                </div>
              ) : (
                <select
                  value={action.functionName || ''}
                  onChange={(e) => handleActionUpdate(eventIndex, actionIndex, { functionName: e.target.value })}
                >
                  <option value="">-- {t('Select')} --</option>
                  {userFunctions
                    .filter(func => {
                      // 根据事件类型过滤函数
                      const eventConfig = eventConfigs[eventIndex];
                      if (eventConfig.type === 'onMessage') {
                        return func.type === 'message';
                      } else {
                        return func.type === 'event';
                      }
                    })
                    .map(func => (
                      <option key={func.name} value={func.name}>
                        {func.name}
                      </option>
                    ))}
                </select>
              )}
            </div>
          )}

          {/* controlTimer - 自定义动画集 */}
          {action.type === 'controlTimer' && (
            <>
              {timerComponents.length === 0 ? (
                <div className="param-row">
                  <span style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
                    {t('No timer components in current view')}
                  </span>
                </div>
              ) : (
                <div className="param-row">
                  <label>{t('Animation Targets')}</label>

                  {/* Already added timer targets list */}
                  {(action.timerTargets || []).length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      {(action.timerTargets || []).map((target, targetIdx) => {
                        const isBroken = isTimerTargetBroken(target, components);
                        const comp = timerComponents.find(c => c.id === target.componentId);
                        const timerInfo = comp?.timers.find(t => t.index === target.timerIndex);
                        const compName = isBroken ? `${target.componentId} ⚠` : (comp?.name || target.componentId);
                        const timerName = isBroken
                          ? t('Broken reference')
                          : (timerInfo?.name || `${t('Animation')} ${(target.timerIndex || 0) + 1}`);

                        return (
                          <div key={targetIdx} style={{
                            padding: '8px',
                            marginBottom: '4px',
                            background: isBroken ? 'var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.1))' : 'var(--vscode-editor-background)',
                            borderRadius: '4px',
                            border: isBroken ? '1px solid var(--vscode-errorForeground, #f44336)' : '1px solid var(--vscode-panel-border)',
                          }}>
                            {/* Header: component + animation on separate lines + delete */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '6px' }}>
                              <div style={{ flex: 1, fontSize: '11px' }}>
                                <div style={{ opacity: isBroken ? 1 : 0.6, marginBottom: '2px', color: isBroken ? 'var(--vscode-errorForeground, #f44336)' : undefined }}>{compName}</div>
                                <div style={{ fontWeight: 600, color: isBroken ? 'var(--vscode-errorForeground, #f44336)' : undefined }}>{timerName}</div>
                              </div>
                              <button
                                onClick={() => {
                                  const newTargets = (action.timerTargets || []).filter((_, i) => i !== targetIdx);
                                  handleActionUpdate(eventIndex, actionIndex, { timerTargets: newTargets });
                                }}
                                style={{
                                  padding: '0 4px',
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'var(--vscode-errorForeground)',
                                  fontSize: '14px',
                                  lineHeight: 1,
                                  opacity: 0.7,
                                }}
                                title={t('Remove')}
                              >
                                ×
                              </button>
                            </div>
                            {/* Enable/Disable radio buttons */}
                            <div style={{ display: 'flex', gap: '12px', marginLeft: '2px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                                <input
                                  type="radio"
                                  name={`timer-action-${eventIndex}-${actionIndex}-${targetIdx}`}
                                  checked={target.action === 'start'}
                                  onChange={() => {
                                    const newTargets = [...(action.timerTargets || [])];
                                    newTargets[targetIdx] = { ...newTargets[targetIdx], action: 'start' };
                                    handleActionUpdate(eventIndex, actionIndex, { timerTargets: newTargets });
                                  }}
                                  style={{ cursor: 'pointer' }}
                                />
                                {t('Enable')}
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                                <input
                                  type="radio"
                                  name={`timer-action-${eventIndex}-${actionIndex}-${targetIdx}`}
                                  checked={target.action === 'stop'}
                                  onChange={() => {
                                    const newTargets = [...(action.timerTargets || [])];
                                    newTargets[targetIdx] = { ...newTargets[targetIdx], action: 'stop' };
                                    handleActionUpdate(eventIndex, actionIndex, { timerTargets: newTargets });
                                  }}
                                  style={{ cursor: 'pointer' }}
                                />
                                {t('Disable')}
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add animation dropdown */}
                  {(() => {
                    // Filter out already-added targets
                    const addedKeys = new Set(
                      (action.timerTargets || []).map(t => `${t.componentId}:${t.timerIndex}`)
                    );
                    const availableOptions: { componentId: string; compName: string; timerIndex: number; timerName: string }[] = [];
                    timerComponents.forEach(comp => {
                      comp.timers.forEach(timer => {
                        if (!addedKeys.has(`${comp.id}:${timer.index}`)) {
                          availableOptions.push({
                            componentId: comp.id,
                            compName: comp.name,
                            timerIndex: timer.index,
                            timerName: timer.name,
                          });
                        }
                      });
                    });

                    return availableOptions.length > 0 ? (
                      <select
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const [compId, idxStr] = e.target.value.split('::');
                          const newTarget = {
                            componentId: compId,
                            timerIndex: parseInt(idxStr),
                            action: 'start' as const,
                          };
                          const newTargets = [...(action.timerTargets || []), newTarget];
                          handleActionUpdate(eventIndex, actionIndex, { timerTargets: newTargets });
                        }}
                        style={{
                          width: '100%',
                          padding: '4px 6px',
                          fontSize: '11px',
                          backgroundColor: 'var(--vscode-dropdown-background)',
                          color: 'var(--vscode-dropdown-foreground)',
                          border: '1px solid var(--vscode-dropdown-border)',
                          borderRadius: '2px',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="">+ {t('Add Animation Target')}...</option>
                        {availableOptions.map(opt => (
                          <option key={`${opt.componentId}::${opt.timerIndex}`} value={`${opt.componentId}::${opt.timerIndex}`}>
                            {opt.compName} / {opt.timerName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ fontSize: '10px', opacity: 0.5 }}>
                        {(action.timerTargets || []).length > 0
                          ? t('All animations added')
                          : ''}
                      </span>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="events-panel">
      {eventConfigs.length === 0 ? (
        <div className="events-empty">{t('No events configured')}</div>
      ) : (
        eventConfigs.map((event, eventIndex) => (
          <div key={eventIndex} className="event-item">
            <div className="event-header" onClick={() => toggleExpand(eventIndex)}>
              <span className="event-expand-icon">
                {expandedEvents.has(eventIndex) ? '▼' : '▶'}
              </span>
              <select
                value={event.type}
                onChange={(e) => {
                  e.stopPropagation();
                  handleEventTypeChange(eventIndex, e.target.value as EventType);
                }}
                onClick={(e) => e.stopPropagation()}
                className="event-type-select"
              >
                {supportedEvents.map(et => {
                  const counterpart = SWIPE_MUTEX_PAIRS[et];
                  const disabled = counterpart != null
                    && eventConfigs.some((ec, i) => i !== eventIndex && ec.type === counterpart);
                  return (
                    <option key={et} value={et} disabled={disabled}>
                      {t(EVENT_LABEL_KEYS[et] as any)}
                    </option>
                  );
                })}
              </select>
              <button
                className="event-remove-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveEvent(eventIndex);
                }}
                title={t('Delete event')}
              >
                {t('Delete')}
              </button>
            </div>

            {expandedEvents.has(eventIndex) && (
              <div className="event-content">
                {/* onMessage 需要消息名和回调函数名 */}
                {event.type === 'onMessage' && (
                  <>
                    <div className="message-input">
                      <label>{t('Listen Message')}</label>
                      <input
                        type="text"
                        value={event.message || ''}
                        onChange={(e) => handleMessageChange(eventIndex, e.target.value)}
                        placeholder={t('Message Name')}
                      />
                    </div>
                    <div className="handler-input">
                      <label>{t('Callback Function Name')}</label>
                      <input
                        type="text"
                        value={event.handler || getDefaultHandler(eventIndex)}
                        onChange={(e) => handleHandlerChange(eventIndex, e.target.value)}
                        placeholder={t('Callback Function Name')}
                        className={handlerError ? 'input-error' : ''}
                      />
                      {handlerError && <span className="error-hint">{handlerError}</span>}
                    </div>
                  </>
                )}

                {/* onKeyShortPress 和 onKeyLongPress 需要按键名 */}
                {(event.type === 'onKeyShortPress' || event.type === 'onKeyLongPress') && (
                  <div className="key-name-input">
                    <label>{t('Key Name')}</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <select
                        value={KEY_NAMES.some(k => k.value === event.keyName) ? event.keyName : 'custom'}
                        onChange={(e) => {
                          if (e.target.value === 'custom') {
                            handleKeyNameChange(eventIndex, '');
                          } else {
                            handleKeyNameChange(eventIndex, e.target.value);
                          }
                        }}
                        style={{ flex: '0 0 auto', minWidth: '100px' }}
                      >
                        {KEY_NAMES.map(k => (
                          <option key={k.value} value={k.value}>{k.label}</option>
                        ))}
                        <option value="custom">{t('Custom')}</option>
                      </select>
                      {(!event.keyName || !KEY_NAMES.some(k => k.value === event.keyName)) && (
                        <input
                          type="text"
                          value={event.keyName || ''}
                          onChange={(e) => handleKeyNameChange(eventIndex, e.target.value)}
                          placeholder={t('Enter custom key name')}
                          style={{ flex: '1 1 0', minWidth: '0' }}
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* onTouchUp 抬起区域检测 */}
                {event.type === 'onTouchUp' && (
                  <div className="check-release-area">
                    <label>
                      <input
                        type="checkbox"
                        checked={event.checkReleaseArea || false}
                        onChange={(e) => {
                          const newConfigs = [...eventConfigs];
                          newConfigs[eventIndex] = { ...newConfigs[eventIndex], checkReleaseArea: e.target.checked };
                          onUpdate({ eventConfigs: newConfigs });
                        }}
                      />
                      <span style={{ marginLeft: '6px' }}>{t('Check Release Area')}</span>
                    </label>
                  </div>
                )}

                {/* 动作列表 */}
                <div className="actions-list">
                  {event.actions.map((action, actionIndex) =>
                    renderActionEditor(action, eventIndex, actionIndex)
                  )}
                </div>

                <button
                  className="add-action-btn"
                  onClick={() => handleAddAction(eventIndex)}
                  title={event.actions.some(a => a.type === 'switchView') ? t('Tip: Only one switch view action per event') : t('Add Action')}
                >
                  + {t('Add Action')}
                </button>
              </div>
            )}
          </div>
        ))
      )}

      <button className="add-event-btn" onClick={handleAddEvent}>
        + {t('Add Event')}
      </button>

      {/* 定时动画区域 */}
      <div className="timer-animations-section" style={{ marginTop: '16px', borderTop: '1px solid var(--vscode-panel-border)', paddingTop: '12px' }}>
        <div 
          className="timer-section-header" 
          onClick={() => setTimerExpanded(!timerExpanded)}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            padding: '8px',
            background: 'var(--vscode-editor-background)',
            borderRadius: '4px',
            marginBottom: timerExpanded ? '12px' : '0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', opacity: 0.7 }}>
              {timerExpanded ? '▼' : '▶'}
            </span>
            <span style={{ fontWeight: 'bold', fontSize: '13px' }}>
              {t('Timer Animations')}
            </span>
          </div>
          <span style={{ fontSize: '11px', opacity: 0.6 }}>
            {component.data?.timers?.length || 0} {t('Animations')}
          </span>
        </div>
        
        {timerExpanded && (
          <TimerProperties
            componentId={component.id}
            componentType={component.type}
            timers={component.data?.timers || []}
            onUpdate={(timers) => {
              onUpdate({
                data: {
                  ...component.data,
                  timers,
                },
              });
            }}
          />
        )}
      </div>
    </div>
  );
};
