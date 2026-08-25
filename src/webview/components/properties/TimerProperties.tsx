import React, { useState, useRef, useEffect } from 'react';
import { PropertyEditor } from './PropertyEditor';
import { t } from '../../i18n';
import { TimerConfig, TimerAction, AnimationSegment } from '../../../hml/types';
import { SWITCH_OUT_STYLES, SWITCH_IN_STYLES } from '../../../hml/eventTypes';
import { useDesignerStore } from '../../store';
import { NumberInput } from '../NumberInput';
import { ChevronDown, ChevronRight, Trash2, Download, Check, Circle } from 'lucide-react';

interface TimerPropertiesProps {
  componentId: string;
  componentType: string;
  timers: TimerConfig[];
  onUpdate: (timers: TimerConfig[]) => void;
}

export const TimerProperties: React.FC<TimerPropertiesProps> = ({
  componentId,
  componentType,
  timers,
  onUpdate,
}) => {
  const [expandedTimerId, setExpandedTimerId] = useState<string | null>(
    timers.length > 0 ? timers[0].id : null
  );
  
  const components = useDesignerStore((state) => state.components);
  const allViews = useDesignerStore((state) => state.allViews || []);

  // 获取可用的视图列表
  const getAvailableViews = () => {
    const currentViews = components
      .filter(c => c.type === 'hg_view' && c.id !== componentId)
      .map(c => ({
        id: c.id,
        name: c.name || c.id,
        file: 'current'
      }));
    
    const currentViewIds = new Set(currentViews.map(v => v.id));
    const otherViews = allViews.filter(v => !currentViewIds.has(v.id));
    
    return [...currentViews, ...otherViews];
  };

  // 添加新定时动画
  const handleAddTimer = () => {
    const timerIndex = timers.length;
    // Avoid duplicate name
    const existingNames = new Set(timers.map(t => t.name));
    let newName = `Animation ${timerIndex + 1}`;
    if (existingNames.has(newName)) {
      let suffix = timerIndex + 2;
      while (existingNames.has(`Animation ${suffix}`)) {
        suffix++;
      }
      newName = `Animation ${suffix}`;
    }
    const newTimer: TimerConfig = {
      id: `timer_${timerIndex}`,
      name: newName,
      enabled: timers.length === 0,
      interval: 1000,
      reload: true,
      mode: 'custom',
      callback: `${componentId}_timer_${timerIndex}_cb`,
      duration: 1000,
      stopOnComplete: true,
      delayStart: 0,
      actions: [],
      segments: [],
    };
    onUpdate([...timers, newTimer]);
    setExpandedTimerId(newTimer.id);
  };

  // Import animation state
  const [showImportPicker, setShowImportPicker] = useState(false);
  const importPickerRef = useRef<HTMLDivElement>(null);

  // Close import picker on outside click
  useEffect(() => {
    if (!showImportPicker) return;
    const handler = (e: MouseEvent) => {
      if (importPickerRef.current && !importPickerRef.current.contains(e.target as Node)) {
        setShowImportPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showImportPicker]);

  // Get all components that have animations (including current for duplication)
  const importSources = React.useMemo(() => {
    return components
      .filter(c => c.data?.timers && c.data.timers.length > 0)
      .sort((a, b) => {
        // Current component first
        if (a.id === componentId) return -1;
        if (b.id === componentId) return 1;
        return 0;
      })
      .map(c => ({
        id: c.id,
        name: c.name || c.id,
        type: c.type,
        timers: c.data!.timers!,
        isSelf: c.id === componentId,
      }));
  }, [components, componentId]);

  // Handle importing an animation from another component
  const handleImportAnimation = (sourceTimer: TimerConfig) => {
    const timerIndex = timers.length;
    // Check for duplicate name and auto-rename
    const existingNames = new Set(timers.map(t => t.name));
    let importedName = sourceTimer.name || `Animation ${timerIndex + 1}`;
    if (existingNames.has(importedName)) {
      let suffix = 2;
      while (existingNames.has(`${importedName} (${suffix})`)) {
        suffix++;
      }
      importedName = `${importedName} (${suffix})`;
    }
    const imported: TimerConfig = {
      ...JSON.parse(JSON.stringify(sourceTimer)),
      id: `timer_${timerIndex}`,
      name: importedName,
      callback: `${componentId}_timer_${timerIndex}_cb`,
      enabled: timers.length === 0,
    };
    onUpdate([...timers, imported]);
    setExpandedTimerId(imported.id);
    setShowImportPicker(false);
  };

  // 删除定时动画
  const handleDeleteTimer = (timerId: string) => {
    const newTimers = timers.filter(t => t.id !== timerId);
    // 重新索引所有定时动画的 ID，确保 ID 连续且不重复
    const reindexedTimers = newTimers.map((timer, index) => ({
      ...timer,
      id: `timer_${index}`,
      callback: timer.mode === 'custom' ? `${componentId}_timer_${index}_cb` : timer.callback,
    }));
    onUpdate(reindexedTimers);
    if (expandedTimerId === timerId && reindexedTimers.length > 0) {
      setExpandedTimerId(reindexedTimers[0].id);
    }
  };

  // 更新定时动画
  const handleUpdateTimer = (timerId: string, updates: Partial<TimerConfig>) => {
    const newTimers = timers.map(t => {
      if (t.id === timerId) {
        if (updates.enabled === true) {
          return { ...t, ...updates };
        }
        return { ...t, ...updates };
      } else if (updates.enabled === true) {
        return { ...t, enabled: false };
      }
      return t;
    });
    onUpdate(newTimers);
  };

  // 切换动画实现方式（预设动作与自定义回调互斥，切换时保留另一侧数据）
  const handleChangeMode = (timer: TimerConfig, mode: 'preset' | 'custom') => {
    if (timer.mode === mode) return;
    if (mode === 'preset') {
      // 切换到预设模式时，恢复之前保存的预设数据
      const updates: Partial<TimerConfig> = { mode: 'preset' };
      if (timer.segmentsBackup && timer.segmentsBackup.length > 0) {
        updates.segments = timer.segmentsBackup;
      } else if (!timer.segments || timer.segments.length === 0) {
        updates.segments = [];
      }
      handleUpdateTimer(timer.id, updates);
    } else {
      // 切换到自定义模式时，备份当前的预设数据
      const updates: Partial<TimerConfig> = {
        mode: 'custom',
        callback: timer.callback || `${componentId}_timer_cb`,
      };
      if (timer.segments && timer.segments.length > 0) {
        updates.segmentsBackup = timer.segments;
      }
      handleUpdateTimer(timer.id, updates);
    }
  };

  // 两种实现方式的配置摘要，让未选中一侧也能看出是否已有配置
  const getModeSummary = (timer: TimerConfig, mode: 'preset' | 'custom'): string => {
    if (mode === 'custom') {
      return timer.callback || t('Not configured');
    }
    const presetSegments = timer.segments && timer.segments.length > 0
      ? timer.segments
      : (timer.segmentsBackup || []);
    if (presetSegments.length > 0) {
      const total = presetSegments.reduce((sum, seg) => sum + (seg.duration || 0), 0);
      return `${presetSegments.length} ${t('segments')} · ${total}ms`;
    }
    if (timer.actions && timer.actions.length > 0) {
      return `${timer.actions.length} ${t('actions')}`;
    }
    return t('Not configured');
  };

  // 切换定时动画展开/折叠
  const toggleExpand = (timerId: string) => {
    setExpandedTimerId(expandedTimerId === timerId ? null : timerId);
  };

  return (
    <div className="property-group">
      <div className="property-item">
        <label>{t('Animations')}</label>
        
        {/* 定时动画列表 */}
        {timers.map((timer, index) => (
          <div
            key={timer.id}
            style={{
              marginTop: index === 0 ? '8px' : '12px',
              padding: '8px',
              background: 'var(--vscode-editor-background)',
              borderRadius: '4px',
              border: timer.enabled
                ? '2px solid var(--vscode-focusBorder)'
                : '1px solid var(--vscode-panel-border)',
            }}
          >
            {/* 定时动画头部 */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {/* 第一行：折叠三角 + 名称 + 删除按钮 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
                onClick={() => toggleExpand(timer.id)}
              >
                <span style={{ fontSize: '10px', opacity: 0.7, flexShrink: 0, width: '12px', textAlign: 'center' }}>
                  {expandedTimerId === timer.id ? '▼' : '▶'}
                </span>
                <input
                  type="text"
                  value={timer.name || ''}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleUpdateTimer(timer.id, { name: e.target.value });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={t('Animation Name')}
                  title={
                    timers.some(t => t.id !== timer.id && t.name === timer.name && timer.name)
                      ? t('Duplicate animation name')
                      : undefined
                  }
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    backgroundColor: 'var(--vscode-input-background)',
                    color: 'var(--vscode-input-foreground)',
                    border: timers.some(t => t.id !== timer.id && t.name === timer.name && timer.name)
                      ? '1px solid var(--vscode-errorForeground)'
                      : '1px solid var(--vscode-input-border)',
                    borderRadius: '2px',
                    fontSize: '12px',
                    minWidth: 0,
                  }}
                />
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteTimer(timer.id);
                  }}
                  title={t('Delete')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '20px',
                    height: '20px',
                    cursor: 'pointer',
                    opacity: 0.6,
                    borderRadius: '2px',
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={13} />
                </span>
              </div>

              {/* 第二行：启用复选框 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '18px' }}>
                <input
                  type="checkbox"
                  checked={timer.enabled}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleUpdateTimer(timer.id, { enabled: e.target.checked });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontSize: '11px', opacity: 0.7, whiteSpace: 'nowrap' }}>
                  {t('Bind on component creation')}
                </span>
              </div>
            </div>

            {/* 定时动画详细配置 */}
            {expandedTimerId === timer.id && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--vscode-panel-border)' }}>
                {/* 基本配置 */}
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                    {t('Timer Interval (ms)')}
                  </label>
                  <PropertyEditor
                    type="number"
                    value={timer.interval}
                    onChange={(value) => handleUpdateTimer(timer.id, { interval: value })}
                  />
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <PropertyEditor
                      type="boolean"
                      value={timer.reload}
                      onChange={(value) => handleUpdateTimer(timer.id, { reload: value })}
                    />
                    <span style={{ fontSize: '12px' }}>{t('Repeat timer')}</span>
                  </div>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <PropertyEditor
                      type="boolean"
                      value={timer.runImmediately || false}
                      onChange={(value) => handleUpdateTimer(timer.id, { runImmediately: value })}
                    />
                    <span style={{ fontSize: '12px' }}>{t('Run immediately')}</span>
                  </div>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <PropertyEditor
                      type="boolean"
                      value={timer.enableLog || false}
                      onChange={(value) => handleUpdateTimer(timer.id, { enableLog: value })}
                    />
                    <span style={{ fontSize: '12px' }}>{t('Enable Debug Log')}</span>
                  </div>
                </div>

                {/* 动画实现方式：预设动作与自定义回调二选一 */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                    {t('Animation Implementation')}
                  </label>
                  <div style={{ fontSize: '10px', opacity: 0.7, marginBottom: '6px', lineHeight: 1.4 }}>
                    {t('The two options are mutually exclusive, only the selected one takes effect.')}
                  </div>
                  <div role="radiogroup" style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                    {(['preset', 'custom'] as const).map(mode => {
                      const active = timer.mode === mode;
                      const summary = getModeSummary(timer, mode);
                      const label = mode === 'preset' ? t('Preset Actions') : t('Custom Callback');
                      return (
                        <button
                          key={mode}
                          role="radio"
                          aria-checked={active}
                          onClick={() => handleChangeMode(timer, mode)}
                          title={active ? `${label}: ${summary}` : `${label}: ${summary} · ${t('Not in effect')}`}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            gap: '2px',
                            padding: '6px 8px',
                            background: active
                              ? 'var(--vscode-button-background)'
                              : 'var(--vscode-input-background)',
                            color: active
                              ? 'var(--vscode-button-foreground)'
                              : 'var(--vscode-foreground)',
                            border: active
                              ? '1px solid var(--vscode-focusBorder)'
                              : '1px solid var(--vscode-input-border)',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            opacity: active ? 1 : 0.8,
                            textAlign: 'left',
                          }}
                        >
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontWeight: active ? 600 : 400,
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {active ? <Check size={11} /> : <Circle size={11} />}
                            {label}
                          </span>
                          <span
                            style={{
                              fontSize: '9px',
                              opacity: 0.85,
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {active ? summary : `${summary} · ${t('Not in effect')}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 预设动作模式 */}
                  {timer.mode === 'preset' && (
                    <TimerPresetMode
                      timer={timer}
                      componentType={componentType}
                      onUpdate={(updates) => handleUpdateTimer(timer.id, updates)}
                      getAvailableViews={getAvailableViews}
                    />
                  )}

                  {/* 自定义函数模式 */}
                  {timer.mode === 'custom' && (
                    <div style={{ marginTop: '8px' }}>
                      <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                        {t('Animation Callback')}
                      </label>
                      <input
                        type="text"
                        value={timer.callback || ''}
                        onChange={(e) => handleUpdateTimer(timer.id, { callback: e.target.value })}
                        placeholder={`${componentId}_timer_cb`}
                        style={{
                          width: '100%',
                          padding: '4px 8px',
                          backgroundColor: 'var(--vscode-input-background)',
                          color: 'var(--vscode-input-foreground)',
                          border: '1px solid var(--vscode-input-border)',
                          borderRadius: '2px',
                          fontFamily: 'monospace',
                          fontSize: '12px',
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* 添加/导入动画按钮 */}
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', position: 'relative' }}>
          <button
            onClick={handleAddTimer}
            style={{
              flex: 1,
              padding: '6px 12px',
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            + {t('Add Animation')}
          </button>
          <button
            onClick={() => setShowImportPicker(!showImportPicker)}
            disabled={importSources.length === 0}
            title={importSources.length === 0 ? t('No animations available to import') : t('Import Animation')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px 10px',
              background: 'var(--vscode-button-secondaryBackground)',
              color: 'var(--vscode-button-secondaryForeground)',
              border: 'none',
              borderRadius: '2px',
              cursor: importSources.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              opacity: importSources.length === 0 ? 0.5 : 1,
              gap: '4px',
            }}
          >
            <Download size={13} />
            {t('Import')}
          </button>

          {/* Import picker dropdown */}
          {showImportPicker && (
            <div
              ref={importPickerRef}
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                zIndex: 100,
                marginTop: '4px',
                width: '100%',
                maxHeight: '240px',
                overflowY: 'auto',
                background: 'var(--vscode-dropdown-background)',
                border: '1px solid var(--vscode-dropdown-border)',
                borderRadius: '4px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              {importSources.map(source => (
                <div key={source.id}>
                  <div style={{
                    padding: '6px 10px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    opacity: 0.6,
                    borderBottom: '1px solid var(--vscode-panel-border)',
                    background: 'var(--vscode-editor-background)',
                  }}>
                    {source.name} ({source.type}){source.isSelf ? ` - ${t('Current')}` : ''}
                  </div>
                  {source.timers.map((timer, idx) => (
                    <div
                      key={`${source.id}-${idx}`}
                      onClick={() => handleImportAnimation(timer)}
                      style={{
                        padding: '6px 10px 6px 20px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span>{timer.name || `${t('Animation')} ${idx + 1}`}</span>
                      <span style={{ fontSize: '9px', opacity: 0.5 }}>
                        {timer.segments?.length || 0} {t('segments')}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 预设动作模式组件（支持多段动画）
const TimerPresetMode: React.FC<{
  timer: TimerConfig;
  componentType: string;
  onUpdate: (updates: Partial<TimerConfig>) => void;
  getAvailableViews: () => Array<{ id: string; name: string; file: string }>;
}> = ({ timer, componentType, onUpdate, getAvailableViews }) => {
  const segments = timer.segments || [];
  const [expandedSegments, setExpandedSegments] = useState<Set<number>>(
    () => new Set(segments.length > 0 ? [0] : [])
  );

  const toggleSegmentExpand = (index: number) => {
    setExpandedSegments(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };
  
  // 获取当前组件的所有定时动画（从父组件传递）
  const componentId = useDesignerStore((state) => state.selectedComponent);
  const components = useDesignerStore((state) => state.components);
  const currentComponent = components.find(c => c.id === componentId);
  const allTimers = currentComponent?.data?.timers || [];

  const handleAddSegment = () => {
    const newSegment: AnimationSegment = {
      duration: 1000,
      actions: [],
    };
    onUpdate({ segments: [...segments, newSegment] });
    setExpandedSegments(prev => new Set(prev).add(segments.length));
  };

  const handleUpdateSegment = (index: number, updates: Partial<AnimationSegment>) => {
    const newSegments = [...segments];
    newSegments[index] = { ...newSegments[index], ...updates };
    onUpdate({ segments: newSegments });
  };

  const handleDeleteSegment = (index: number) => {
    const newSegments = segments.filter((_, i) => i !== index);
    onUpdate({ segments: newSegments });
    setExpandedSegments(prev => {
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx < index) next.add(idx);
        else if (idx > index) next.add(idx - 1);
      }
      return next;
    });
  };

  // 拖拽相关状态
  const [draggedSegmentIndex, setDraggedSegmentIndex] = React.useState<number | null>(null);
  const [dragOverSegmentIndex, setDragOverSegmentIndex] = React.useState<number | null>(null);

  // 处理拖拽开始
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedSegmentIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  // 处理拖拽经过
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedSegmentIndex !== null && draggedSegmentIndex !== index) {
      setDragOverSegmentIndex(index);
    }
  };

  // 处理拖拽离开
  const handleDragLeave = () => {
    setDragOverSegmentIndex(null);
  };

  // 处理放置
  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedSegmentIndex === null || draggedSegmentIndex === dropIndex) {
      setDraggedSegmentIndex(null);
      setDragOverSegmentIndex(null);
      return;
    }

    // 重新排列动画段
    const newSegments = [...segments];
    const [draggedSegment] = newSegments.splice(draggedSegmentIndex, 1);
    newSegments.splice(dropIndex, 0, draggedSegment);
    
    onUpdate({ segments: newSegments });

    // Update expanded indices after reorder
    setExpandedSegments(prev => {
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx === draggedSegmentIndex) {
          next.add(dropIndex);
        } else {
          let newIdx = idx;
          if (draggedSegmentIndex < idx && dropIndex >= idx) {
            newIdx = idx - 1;
          } else if (draggedSegmentIndex > idx && dropIndex <= idx) {
            newIdx = idx + 1;
          }
          next.add(newIdx);
        }
      }
      return next;
    });

    setDraggedSegmentIndex(null);
    setDragOverSegmentIndex(null);
  };

  // 处理拖拽结束
  const handleDragEnd = () => {
    setDraggedSegmentIndex(null);
    setDragOverSegmentIndex(null);
  };

  const handleAddAction = (segmentIndex: number) => {
    const segment = segments[segmentIndex];
    let newAction: TimerAction;
    if (componentType === 'hg_window') {
      newAction = { type: 'size', fromW: 0, fromH: 0, toW: 0, toH: 0 };
    } else if (componentType === 'hg_image') {
      newAction = { type: 'opacity', from: 255, to: 128 };
    } else {
      newAction = { type: 'position', fromX: 0, fromY: 0, toX: 0, toY: 0 };
    }
    handleUpdateSegment(segmentIndex, { actions: [...segment.actions, newAction] });
  };

  const handleUpdateAction = (segmentIndex: number, actionIndex: number, updates: Partial<TimerAction>) => {
    const segment = segments[segmentIndex];
    const newActions = [...segment.actions];
    newActions[actionIndex] = { ...newActions[actionIndex], ...updates };
    handleUpdateSegment(segmentIndex, { actions: newActions });
  };

  const handleDeleteAction = (segmentIndex: number, actionIndex: number) => {
    const segment = segments[segmentIndex];
    handleUpdateSegment(segmentIndex, { actions: segment.actions.filter((_, i) => i !== actionIndex) });
  };

  // 计算总时间
  const totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);

  return (
    <div style={{ marginTop: '8px' }}>
      {/* 停止选项 */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <PropertyEditor
            type="boolean"
            value={timer.stopOnComplete !== false}
            onChange={(value) => onUpdate({ stopOnComplete: value })}
          />
          <span style={{ fontSize: '12px' }}>{t('Stop on Complete')}</span>
        </div>
      </div>

      {/* 总时间显示 */}
      {segments.length > 0 && (
        <div style={{ marginBottom: '12px', padding: '6px', background: 'var(--vscode-editor-background)', borderRadius: '4px' }}>
          <span style={{ fontSize: '11px', opacity: 0.8 }}>
            {t('Total Duration')}: {totalDuration} ms
          </span>
        </div>
      )}

      {/* 时间轴可视化 */}
      {segments.length > 0 && totalDuration > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ 
            display: 'flex', 
            height: '32px', 
            borderRadius: '4px', 
            overflow: 'hidden',
            border: '1px solid var(--vscode-panel-border)',
          }}>
            {segments.map((segment, idx) => {
              const widthPercent = (segment.duration / totalDuration) * 100;
              const isExpanded = expandedSegments.has(idx);
              const hue = (idx * 137) % 360;
              return (
                <div
                  key={idx}
                  onClick={() => toggleSegmentExpand(idx)}
                  title={`${t('Segment')} ${idx + 1}: ${segment.duration}ms, ${segment.actions.length} ${t('actions')}`}
                  style={{
                    width: `${widthPercent}%`,
                    minWidth: '16px',
                    height: '100%',
                    background: `hsla(${hue}, 50%, ${isExpanded ? '40%' : '30%'}, ${isExpanded ? 0.9 : 0.6})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    borderRight: idx < segments.length - 1 ? '1px solid var(--vscode-panel-border)' : 'none',
                    transition: 'background 0.15s ease',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ 
                    fontSize: '10px', 
                    fontWeight: 'bold', 
                    color: '#fff', 
                    textShadow: '0 0 3px rgba(0,0,0,0.5)',
                    whiteSpace: 'nowrap',
                  }}>
                    {widthPercent > 12 ? `S${idx + 1}` : ''}
                  </span>
                  {widthPercent > 25 && segment.actions.length > 0 && (
                    <span style={{ 
                      fontSize: '8px', 
                      color: 'rgba(255,255,255,0.7)', 
                      marginLeft: '3px',
                      textShadow: '0 0 2px rgba(0,0,0,0.5)',
                    }}>
                      ×{segment.actions.length}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* 时间刻度 - 每段时长 */}
          <div style={{ display: 'flex', marginTop: '2px' }}>
            {segments.map((segment, idx) => {
              const widthPercent = (segment.duration / totalDuration) * 100;
              return (
                <span
                  key={idx}
                  style={{
                    width: `${widthPercent}%`,
                    minWidth: '16px',
                    fontSize: '9px',
                    opacity: 0.6,
                    textAlign: 'center',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {widthPercent > 10 ? `${segment.duration}ms` : ''}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* 动画段列表 */}
      {segments.map((segment, segmentIndex) => (
        <div
          key={segmentIndex}
          onDragOver={(e) => handleDragOver(e, segmentIndex)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, segmentIndex)}
          style={{
            marginBottom: '8px',
            padding: '8px',
            background: 'var(--vscode-input-background)',
            borderRadius: '4px',
            border: dragOverSegmentIndex === segmentIndex 
              ? '2px dashed var(--vscode-focusBorder)' 
              : '1px solid var(--vscode-input-border)',
            opacity: draggedSegmentIndex === segmentIndex ? 0.5 : 1,
            transition: 'border 0.2s, opacity 0.2s',
          }}
        >
          {/* 段头部 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, cursor: 'pointer' }}
              onClick={() => toggleSegmentExpand(segmentIndex)}
            >
              <span 
                draggable
                onDragStart={(e) => handleDragStart(e, segmentIndex)}
                onDragEnd={handleDragEnd}
                onClick={(e) => e.stopPropagation()}
                style={{ 
                  fontSize: '14px', 
                  opacity: 0.6, 
                  cursor: 'grab',
                  padding: '2px 4px',
                  userSelect: 'none',
                }} 
                title={t('Drag to reorder')}
              >
                ⋮⋮
              </span>
              <span style={{ display: 'flex', alignItems: 'center', opacity: 0.7 }}>
                {expandedSegments.has(segmentIndex) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 'bold' }}>
                {t('Segment')} {segmentIndex + 1}
              </span>
              <span style={{ fontSize: '10px', opacity: 0.7 }}>
                ({segment.duration}ms, {segment.actions.length} {t('actions')})
              </span>
            </div>
            <span
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteSegment(segmentIndex);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '20px',
                height: '20px',
                cursor: 'pointer',
                opacity: 0.6,
                borderRadius: '2px',
                marginLeft: '12px',
                flexShrink: 0,
              }}
              title={t('Remove')}
            >
              <Trash2 size={13} />
            </span>
          </div>

          {/* 段详细配置 */}
          {expandedSegments.has(segmentIndex) && (
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--vscode-panel-border)' }}>
              {/* 持续时间 */}
              <div style={{ marginBottom: '8px' }}>
                <label style={{ fontSize: '10px', display: 'block', marginBottom: '4px' }}>
                  {t('Duration (ms)')}
                </label>
                <NumberInput
                  min={0}
                  integer
                  value={segment.duration}
                  onChange={(v) => handleUpdateSegment(segmentIndex, { duration: v })}
                  style={{
                    width: '100%',
                    padding: '4px 8px',
                    backgroundColor: 'var(--vscode-input-background)',
                    color: 'var(--vscode-input-foreground)',
                    border: '1px solid var(--vscode-input-border)',
                    borderRadius: '2px',
                    fontSize: '11px',
                  }}
                />
              </div>

              {/* 动作列表 */}
              {segment.actions.map((action, actionIndex) => (
                <div
                  key={actionIndex}
                  style={{
                    marginBottom: '8px',
                    padding: '6px',
                    background: 'var(--vscode-editor-background)',
                    borderRadius: '4px',
                    border: '1px solid var(--vscode-panel-border)',
                  }}
                >
                  <TimerActionEditor
                    action={action}
                    componentType={componentType}
                    onUpdate={(updates) => handleUpdateAction(segmentIndex, actionIndex, updates)}
                    onDelete={() => handleDeleteAction(segmentIndex, actionIndex)}
                    availableViews={getAvailableViews()}
                    availableTimers={allTimers}
                    currentTimerId={timer.id}
                  />
                </div>
              ))}

              {/* 添加动作按钮 */}
              <button
                onClick={() => handleAddAction(segmentIndex)}
                style={{
                  width: '100%',
                  padding: '4px 8px',
                  background: 'var(--vscode-button-secondaryBackground)',
                  color: 'var(--vscode-button-secondaryForeground)',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontSize: '10px',
                }}
              >
                + {t('Add Action')}
              </button>
            </div>
          )}
        </div>
      ))}

      {/* 添加动画段按钮 */}
      <button
        onClick={handleAddSegment}
        style={{
          width: '100%',
          padding: '4px 8px',
          background: 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
          border: 'none',
          borderRadius: '2px',
          cursor: 'pointer',
          fontSize: '11px',
        }}
      >
        + {t('Add Segment')}
      </button>
    </div>
  );
};

// 动作编辑器组件
const TimerActionEditor: React.FC<{
  action: TimerAction;
  componentType: string;
  onUpdate: (updates: Partial<TimerAction>) => void;
  onDelete: () => void;
  availableViews: Array<{ id: string; name: string; file: string }>;
  availableTimers: TimerConfig[];
  currentTimerId: string;
}> = ({ action, componentType, onUpdate, onDelete, availableViews, availableTimers, currentTimerId }) => {
  const components = useDesignerStore((state) => state.components);
  const [proportionalScale, setProportionalScale] = useState(true);
  
  // 获取除当前定时器外的其他定时器
  const otherTimers = availableTimers.filter(t => t.id !== currentTimerId);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <select
          value={action.type}
          onChange={(e) => {
            const newType = e.target.value as 'size' | 'position' | 'opacity' | 'rotation' | 'scale' | 'value' | 'switchView' | 'changeImage' | 'imageSequence' | 'visibility' | 'switchTimer' | 'setFocus' | 'fgColor' | 'bgColor';
            const newAction: TimerAction = { type: newType };
            if (newType === 'size') {
              newAction.fromW = 0;
              newAction.fromH = 0;
              newAction.toW = 0;
              newAction.toH = 0;
            } else if (newType === 'position') {
              newAction.fromX = 0;
              newAction.fromY = 0;
              newAction.toX = 0;
              newAction.toY = 0;
            } else if (newType === 'opacity') {
              newAction.from = 255;
              newAction.to = 128;
            } else if (newType === 'rotation') {
              newAction.angleOrigin = 0;
              newAction.angleTarget = 360;
            } else if (newType === 'scale') {
              newAction.zoomXOrigin = 1.0;
              newAction.zoomXTarget = 2.0;
              newAction.zoomYOrigin = 1.0;
              newAction.zoomYTarget = 2.0;
            } else if (newType === 'switchView') {
              newAction.target = '';
              newAction.switchOutStyle = 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION';
              newAction.switchInStyle = 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION';
            } else if (newType === 'changeImage') {
              newAction.imagePath = '';
            } else if (newType === 'imageSequence') {
              newAction.imageSequence = [];
            } else if (newType === 'visibility') {
              newAction.visible = true;
            } else if (newType === 'switchTimer') {
              newAction.timerId = '';
            } else if (newType === 'value') {
              newAction.fromValue = 0;
              newAction.toValue = 100;
            } else if (newType === 'fgColor') {
              newAction.fgColorTo = '0xFFFFFFFF';
            } else if (newType === 'bgColor') {
              newAction.bgColorTo = '0xFFFFFFFF';
            }
            // setFocus 不需要额外参数
            onUpdate(newAction);
          }}
          style={{
            padding: '4px 8px',
            backgroundColor: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
            borderRadius: '2px',
            fontSize: '10px',
          }}
        >
          {componentType === 'hg_window' && <option value="size">{t('Adjust Size')}</option>}
          {['hg_progressbar', 'hg_slider'].includes(componentType) && <option value="value">{t('Adjust Value')}</option>}
          <option value="position">{t('Adjust Position')}</option>
          <option value="opacity">{t('Adjust Opacity')}</option>
          {componentType === 'hg_image' && <option value="rotation">{t('Adjust Rotation')}</option>}
          {componentType === 'hg_image' && <option value="scale">{t('Adjust Scale')}</option>}
          {componentType === 'hg_image' && <option value="fgColor">{t('Adjust Foreground Color')}</option>}
          {componentType === 'hg_image' && <option value="bgColor">{t('Adjust Background Color')}</option>}
          {componentType === 'hg_image' && <option value="changeImage">{t('Change Image')}</option>}
          {componentType === 'hg_image' && <option value="imageSequence">{t('Image Sequence')}</option>}
          <option value="switchView">{t('Switch View')}</option>
          <option value="switchTimer">{t('Switch Timer')}</option>
          <option value="visibility">{t('Set Visibility')}</option>
          <option value="setFocus">{t('Set Focus')}</option>
        </select>
        <button
          onClick={onDelete}
          style={{
            padding: '2px 8px',
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
            fontSize: '9px',
          }}
        >
          {t('Remove')}
        </button>
      </div>

      {/* 动作参数 */}
      {action.type === 'visibility' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('Visibility')}</label>
            <select
              value={action.visible ? 'true' : 'false'}
              onChange={(e) => onUpdate({ visible: e.target.value === 'true' })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            >
              <option value="true">{t('Show')}</option>
              <option value="false">{t('Hide')}</option>
            </select>
          </div>
        </div>
      )}

      {action.type === 'changeImage' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('Image Path')}</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input
                type="text"
                value={action.imagePath || ''}
                onChange={(e) => onUpdate({ imagePath: e.target.value })}
                placeholder="assets/image.bin"
                style={{
                  flex: 1,
                  padding: '3px',
                  backgroundColor: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border)',
                  borderRadius: '2px',
                  fontSize: '11px',
                }}
              />
              <button
                onClick={() => {
                  // 生成临时回调 ID
                  const callbackId = `timer_image_${Date.now()}`;
                  
                  // 注册一次性消息监听器来接收保存后的路径
                  const messageHandler = (event: MessageEvent) => {
                    const message = event.data;
                    if (message.command === 'imageSaved' && message.callbackId === callbackId) {
                      // 更新动作的图片路径
                      onUpdate({ imagePath: message.path });
                      // 移除监听器
                      window.removeEventListener('message', messageHandler);
                    }
                  };
                  window.addEventListener('message', messageHandler);
                  
                  // 使用后端的 selectImagePath 命令，让后端处理路径检测和复制
                  window.vscodeAPI?.postMessage({
                    command: 'selectImagePath',
                    callbackId: callbackId
                  });
                }}
                style={{
                  padding: '3px 8px',
                  backgroundColor: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
                title={t('Select Image File')}
              >
                📁
              </button>
            </div>
          </div>
        </div>
      )}

      {action.type === 'imageSequence' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('Image Sequence')}</label>
            
            {/* 文件夹选择按钮 */}
            <div style={{ marginBottom: '8px' }}>
              <button
                onClick={() => {
                  const callbackId = `timer_folder_${Date.now()}`;
                  const messageHandler = (event: MessageEvent) => {
                    const message = event.data;
                    if (message.command === 'folderImagesSelected' && message.callbackId === callbackId) {
                      // 更新图片序列
                      onUpdate({ imageSequence: message.paths });
                      window.removeEventListener('message', messageHandler);
                    }
                  };
                  window.addEventListener('message', messageHandler);
                  window.vscodeAPI?.postMessage({
                    command: 'selectFolderImages',
                    callbackId: callbackId
                  });
                }}
                style={{
                  width: '100%',
                  padding: '6px 12px',
                  backgroundColor: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                📁 {t('Select Folder')}
              </button>
            </div>
            
            {(action.imageSequence || []).map((imgPath, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                <span style={{ fontSize: '10px', minWidth: '20px', opacity: 0.7 }}>{idx + 1}.</span>
                <input
                  type="text"
                  value={imgPath}
                  onChange={(e) => {
                    const newSeq = [...(action.imageSequence || [])];
                    newSeq[idx] = e.target.value;
                    onUpdate({ imageSequence: newSeq });
                  }}
                  placeholder="assets/image.bin"
                  style={{
                    flex: 1,
                    padding: '3px',
                    backgroundColor: 'var(--vscode-input-background)',
                    color: 'var(--vscode-input-foreground)',
                    border: '1px solid var(--vscode-input-border)',
                    borderRadius: '2px',
                    fontSize: '11px',
                  }}
                />
                <button
                  onClick={() => {
                    const callbackId = `timer_seq_${Date.now()}_${idx}`;
                    const messageHandler = (event: MessageEvent) => {
                      const message = event.data;
                      if (message.command === 'imageSaved' && message.callbackId === callbackId) {
                        const newSeq = [...(action.imageSequence || [])];
                        newSeq[idx] = message.path;
                        onUpdate({ imageSequence: newSeq });
                        window.removeEventListener('message', messageHandler);
                      }
                    };
                    window.addEventListener('message', messageHandler);
                    window.vscodeAPI?.postMessage({
                      command: 'selectImagePath',
                      callbackId: callbackId
                    });
                  }}
                  style={{
                    padding: '3px 8px',
                    backgroundColor: 'var(--vscode-button-background)',
                    color: 'var(--vscode-button-foreground)',
                    border: 'none',
                    borderRadius: '2px',
                    cursor: 'pointer',
                    fontSize: '11px'
                  }}
                  title={t('Select Image File')}
                >
                  📁
                </button>
                <button
                  onClick={() => {
                    const newSeq = (action.imageSequence || []).filter((_, i) => i !== idx);
                    onUpdate({ imageSequence: newSeq });
                  }}
                  style={{
                    padding: '3px 8px',
                    backgroundColor: 'var(--vscode-button-secondaryBackground)',
                    color: 'var(--vscode-button-secondaryForeground)',
                    border: 'none',
                    borderRadius: '2px',
                    cursor: 'pointer',
                    fontSize: '11px'
                  }}
                  title={t('Remove')}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                const newSeq = [...(action.imageSequence || []), ''];
                onUpdate({ imageSequence: newSeq });
              }}
              style={{
                width: '100%',
                padding: '4px 8px',
                backgroundColor: 'var(--vscode-button-secondaryBackground)',
                color: 'var(--vscode-button-secondaryForeground)',
                border: 'none',
                borderRadius: '2px',
                cursor: 'pointer',
                fontSize: '10px',
                marginTop: '4px'
              }}
            >
              + {t('Add Image')}
            </button>
          </div>
        </div>
      )}

      {action.type === 'switchView' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('Target View')}</label>
            <select
              value={action.target || ''}
              onChange={(e) => onUpdate({ target: e.target.value })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            >
              <option value="">-- {t('Select')} --</option>
              {availableViews.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name} {v.file !== 'current' ? `(${v.file})` : `(${t('Current File')})`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('Exit Animation')}</label>
            <select
              value={action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION'}
              onChange={(e) => onUpdate({ switchOutStyle: e.target.value })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            >
              {SWITCH_OUT_STYLES.map(s => (
                <option key={s.value} value={s.value}>{t(s.labelKey as any)}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('Enter Animation')}</label>
            <select
              value={action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION'}
              onChange={(e) => onUpdate({ switchInStyle: e.target.value })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            >
              {SWITCH_IN_STYLES.map(s => (
                <option key={s.value} value={s.value}>{t(s.labelKey as any)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {action.type === 'switchTimer' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* 提示信息 */}
          {otherTimers.length === 0 && (
            <div style={{ 
              padding: '8px', 
              backgroundColor: 'var(--vscode-inputValidation-warningBackground)',
              border: '1px solid var(--vscode-inputValidation-warningBorder)',
              borderRadius: '2px',
              fontSize: '11px',
              color: 'var(--vscode-inputValidation-warningForeground)'
            }}>
              ⚠️ {t('No other timers available. Please add another timer first.')}
            </div>
          )}
          
          {/* 定时器控制列表 */}
          {otherTimers.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '10px', fontWeight: 'bold', marginBottom: '2px' }}>
                {t('Timer Controls')}
              </label>
              {otherTimers.map(timer => {
                // 查找当前定时器的控制配置
                const timerTargets = action.timerTargets || [];
                const currentTarget = timerTargets.find(tt => tt.timerId === timer.id);
                const controlAction = currentTarget?.action || 'none';
                
                return (
                  <div 
                    key={timer.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px',
                      backgroundColor: 'var(--vscode-editor-background)',
                      borderRadius: '2px',
                      border: '1px solid var(--vscode-panel-border)',
                    }}
                  >
                    <span style={{ 
                      flex: 1, 
                      fontSize: '11px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {timer.name || timer.id}
                    </span>
                    <select
                      value={controlAction}
                      onChange={(e) => {
                        const newAction = e.target.value as 'none' | 'start' | 'stop';
                        let newTimerTargets = [...timerTargets];
                        
                        if (newAction === 'none') {
                          // 移除该定时器的控制
                          newTimerTargets = newTimerTargets.filter(tt => tt.timerId !== timer.id);
                        } else {
                          // 更新或添加该定时器的控制
                          const existingIndex = newTimerTargets.findIndex(tt => tt.timerId === timer.id);
                          if (existingIndex >= 0) {
                            newTimerTargets[existingIndex] = {
                              ...newTimerTargets[existingIndex],
                              action: newAction
                            };
                          } else {
                            newTimerTargets.push({
                              timerId: timer.id,
                              action: newAction
                            });
                          }
                        }
                        
                        onUpdate({ timerTargets: newTimerTargets });
                      }}
                      style={{
                        padding: '3px 6px',
                        backgroundColor: 'var(--vscode-input-background)',
                        color: 'var(--vscode-input-foreground)',
                        border: '1px solid var(--vscode-input-border)',
                        borderRadius: '2px',
                        fontSize: '11px',
                        minWidth: '80px',
                      }}
                    >
                      <option value="none">-- {t('No Action')} --</option>
                      <option value="start">{t('Start')}</option>
                      <option value="stop">{t('Stop')}</option>
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {action.type === 'size' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('From')} W</label>
            <NumberInput
              value={action.fromW || 0}
              onChange={(v) => onUpdate({ fromW: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('To')} W</label>
            <NumberInput
              value={action.toW || 0}
              onChange={(v) => onUpdate({ toW: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('From')} H</label>
            <NumberInput
              value={action.fromH || 0}
              onChange={(v) => onUpdate({ fromH: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('To')} H</label>
            <NumberInput
              value={action.toH || 0}
              onChange={(v) => onUpdate({ toH: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
        </div>
      )}

      {action.type === 'position' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('From')} X</label>
            <NumberInput
              value={action.fromX || 0}
              onChange={(v) => onUpdate({ fromX: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('To')} X</label>
            <NumberInput
              value={action.toX || 0}
              onChange={(v) => onUpdate({ toX: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('From')} Y</label>
            <NumberInput
              value={action.fromY || 0}
              onChange={(v) => onUpdate({ fromY: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('To')} Y</label>
            <NumberInput
              value={action.toY || 0}
              onChange={(v) => onUpdate({ toY: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
        </div>
      )}

      {action.type === 'opacity' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('From')} (0-255)</label>
            <NumberInput
              min={0}
              max={255}
              integer
              emptyValue={255}
              value={action.from ?? 255}
              onChange={(v) => onUpdate({ from: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('To')} (0-255)</label>
            <NumberInput
              min={0}
              max={255}
              integer
              emptyValue={128}
              value={action.to ?? 128}
              onChange={(v) => onUpdate({ to: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
        </div>
      )}

      {action.type === 'value' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('From')}</label>
            <NumberInput
              value={action.fromValue ?? 0}
              emptyValue={0}
              onChange={(v) => onUpdate({ fromValue: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('To')}</label>
            <NumberInput
              value={action.toValue ?? 100}
              emptyValue={100}
              onChange={(v) => onUpdate({ toValue: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
        </div>
      )}

      {action.type === 'rotation' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('From Angle')} (°)</label>
            <NumberInput
              value={action.angleOrigin || 0}
              onChange={(v) => onUpdate({ angleOrigin: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('To Angle')} (°)</label>
            <NumberInput
              value={action.angleTarget || 360}
              emptyValue={360}
              onChange={(v) => onUpdate({ angleTarget: v })}
              style={{
                width: '100%',
                padding: '3px',
                backgroundColor: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '2px',
                fontSize: '11px',
              }}
            />
          </div>
        </div>
      )}

      {action.type === 'scale' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>{t('Proportional Scale')}</span>
            <button
              className={`scale-link-btn${proportionalScale ? ' active' : ''}`}
              title={proportionalScale ? t('Unlink scale axes') : t('Link scale axes')}
              onClick={() => setProportionalScale(!proportionalScale)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                {proportionalScale ? (
                  <>
                    <path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v1a1.5 1.5 0 0 0 1.06 1.44l1.5-1.5A.5.5 0 0 1 5 5.5v-1a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .06.004l1.5-1.5A1.5 1.5 0 0 0 6.5 3h-2z" />
                    <path d="M11.5 13A1.5 1.5 0 0 0 13 11.5v-1a1.5 1.5 0 0 0-1.06-1.44l-1.5 1.5A.5.5 0 0 1 11 10.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.06-.004l-1.5 1.5A1.5 1.5 0 0 0 9.5 13h2z" />
                    <path d="M5.354 10.354l5-5-.708-.708-5 5 .708.708z" />
                  </>
                ) : (
                  <>
                    <path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v1a1.5 1.5 0 0 0 1.5 1.5h1A1.5 1.5 0 0 0 7 5.5v-1A1.5 1.5 0 0 0 5.5 3h-1zM4 4.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1z" />
                    <path d="M10.5 9A1.5 1.5 0 0 0 9 10.5v1a1.5 1.5 0 0 0 1.5 1.5h1a1.5 1.5 0 0 0 1.5-1.5v-1A1.5 1.5 0 0 0 11.5 9h-1zm-.5 1.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1z" />
                  </>
                )}
              </svg>
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <div>
              <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('From Scale')} X</label>
              <NumberInput
                min={0}
                value={action.zoomXOrigin ?? 1.0}
                onChange={(finalVal) => {
                  if (proportionalScale) {
                    onUpdate({ zoomXOrigin: finalVal, zoomYOrigin: finalVal });
                  } else {
                    onUpdate({ zoomXOrigin: finalVal });
                  }
                }}
                style={{
                  width: '100%',
                  padding: '3px',
                  backgroundColor: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border)',
                  borderRadius: '2px',
                  fontSize: '11px',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('To Scale')} X</label>
              <NumberInput
                min={0}
                value={action.zoomXTarget ?? 2.0}
                onChange={(finalVal) => {
                  if (proportionalScale) {
                    onUpdate({ zoomXTarget: finalVal, zoomYTarget: finalVal });
                  } else {
                    onUpdate({ zoomXTarget: finalVal });
                  }
                }}
                style={{
                  width: '100%',
                  padding: '3px',
                  backgroundColor: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border)',
                  borderRadius: '2px',
                  fontSize: '11px',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('From Scale')} Y</label>
              <NumberInput
                min={0}
                value={action.zoomYOrigin ?? 1.0}
                onChange={(finalVal) => {
                  if (proportionalScale) {
                    onUpdate({ zoomYOrigin: finalVal, zoomXOrigin: finalVal });
                  } else {
                    onUpdate({ zoomYOrigin: finalVal });
                  }
                }}
                style={{
                  width: '100%',
                  padding: '3px',
                  backgroundColor: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border)',
                  borderRadius: '2px',
                  fontSize: '11px',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '10px', display: 'block', marginBottom: '2px' }}>{t('To Scale')} Y</label>
              <NumberInput
                min={0}
                value={action.zoomYTarget ?? 2.0}
                onChange={(finalVal) => {
                  if (proportionalScale) {
                    onUpdate({ zoomYTarget: finalVal, zoomXTarget: finalVal });
                  } else {
                    onUpdate({ zoomYTarget: finalVal });
                  }
                }}
                style={{
                  width: '100%',
                  padding: '3px',
                  backgroundColor: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border)',
                  borderRadius: '2px',
                  fontSize: '11px',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {action.type === 'fgColor' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* 初始前景色（可选） */}
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '4px' }}>
              {t('From Color')} ({t('Optional')})
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="color"
                value={action.fgColorFrom ? `#${action.fgColorFrom.substring(4)}` : '#FFFFFF'}
                onChange={(e) => {
                  const hex = e.target.value.substring(1);
                  onUpdate({ fgColorFrom: `0xFF${hex.toUpperCase()}` });
                }}
                disabled={!action.fgColorFrom}
                style={{ width: '30px', height: '30px', padding: 0, border: 'none' }}
              />
              <input
                type="text"
                value={action.fgColorFrom || ''}
                onChange={(e) => onUpdate({ fgColorFrom: e.target.value })}
                placeholder={t('Leave empty to skip animation')}
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  backgroundColor: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border)',
                  borderRadius: '2px',
                  fontSize: '11px',
                }}
              />
              <button
                onClick={() => onUpdate({ fgColorFrom: action.fgColorFrom ? undefined : '0xFFFFFFFF' })}
                style={{
                  padding: '4px 8px',
                  backgroundColor: 'var(--vscode-button-secondaryBackground)',
                  color: 'var(--vscode-button-secondaryForeground)',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontSize: '10px',
                }}
                title={action.fgColorFrom ? t('Clear') : t('Set')}
              >
                {action.fgColorFrom ? '✕' : '+'}
              </button>
            </div>
          </div>

          {/* 目标前景色（必填） */}
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '4px' }}>
              {t('To Color')}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="color"
                value={action.fgColorTo ? `#${action.fgColorTo.substring(4)}` : '#FFFFFF'}
                onChange={(e) => {
                  const hex = e.target.value.substring(1);
                  onUpdate({ fgColorTo: `0xFF${hex.toUpperCase()}` });
                }}
                style={{ width: '30px', height: '30px', padding: 0, border: 'none' }}
              />
              <input
                type="text"
                value={action.fgColorTo || '0xFFFFFFFF'}
                onChange={(e) => onUpdate({ fgColorTo: e.target.value })}
                placeholder="0xFFRRGGBB"
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  backgroundColor: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border)',
                  borderRadius: '2px',
                  fontSize: '11px',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {action.type === 'bgColor' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* 初始背景色（可选） */}
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '4px' }}>
              {t('From Color')} ({t('Optional')})
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="color"
                value={action.bgColorFrom ? `#${action.bgColorFrom.substring(4)}` : '#FFFFFF'}
                onChange={(e) => {
                  const hex = e.target.value.substring(1);
                  onUpdate({ bgColorFrom: `0xFF${hex.toUpperCase()}` });
                }}
                disabled={!action.bgColorFrom}
                style={{ width: '30px', height: '30px', padding: 0, border: 'none' }}
              />
              <input
                type="text"
                value={action.bgColorFrom || ''}
                onChange={(e) => onUpdate({ bgColorFrom: e.target.value })}
                placeholder={t('Leave empty to skip animation')}
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  backgroundColor: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border)',
                  borderRadius: '2px',
                  fontSize: '11px',
                }}
              />
              <button
                onClick={() => onUpdate({ bgColorFrom: action.bgColorFrom ? undefined : '0xFFFFFFFF' })}
                style={{
                  padding: '4px 8px',
                  backgroundColor: 'var(--vscode-button-secondaryBackground)',
                  color: 'var(--vscode-button-secondaryForeground)',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontSize: '10px',
                }}
                title={action.bgColorFrom ? t('Clear') : t('Set')}
              >
                {action.bgColorFrom ? '✕' : '+'}
              </button>
            </div>
          </div>

          {/* 目标背景色（必填） */}
          <div>
            <label style={{ fontSize: '10px', display: 'block', marginBottom: '4px' }}>
              {t('To Color')}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="color"
                value={action.bgColorTo ? `#${action.bgColorTo.substring(4)}` : '#FFFFFF'}
                onChange={(e) => {
                  const hex = e.target.value.substring(1);
                  onUpdate({ bgColorTo: `0xFF${hex.toUpperCase()}` });
                }}
                style={{ width: '30px', height: '30px', padding: 0, border: 'none' }}
              />
              <input
                type="text"
                value={action.bgColorTo || '0xFFFFFFFF'}
                onChange={(e) => onUpdate({ bgColorTo: e.target.value })}
                placeholder="0xFFRRGGBB"
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  backgroundColor: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-input-border)',
                  borderRadius: '2px',
                  fontSize: '11px',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
