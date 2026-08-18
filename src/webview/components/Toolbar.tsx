import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDesignerStore } from '../store';
import {
  AlignLeft,
  BrushCleaning,
  Check,
  ChevronDown,
  Code,
  Download,
  GitBranch,
  Grid,
  Info,
  Languages,
  Maximize2,
  MoreHorizontal,
  Package,
  Palette,
  Rocket,
  RotateCcw,
  RotateCw,
  Save,
  Square,
} from 'lucide-react';
import { AlignType, DistributeType, ResizeType, getAlignmentConfigsByCategory } from '../utils/alignmentUtils';
import { t } from '../i18n';
import ProjectI18nLocaleSelect from './ProjectI18nLocaleSelect';
import ProjectConfigSelect from './ProjectConfigSelect';
import './Toolbar.css';

type ToolbarItemId =
  | 'relations'
  | 'guides'
  | 'alignment'
  | 'background'
  | 'fit'
  | 'projectConfig'
  | 'locale'
  | 'i18nManager'
  | 'guiVersion'
  | 'convert'
  | 'codegen'
  | 'download'
  | 'clean';

// 从前到后依次收入“更多”。高频构建操作最后折叠。
const COLLAPSE_ORDER: ToolbarItemId[] = [
  'guiVersion',
  'clean',
  'download',
  'i18nManager',
  'background',
  'relations',
  'guides',
  'alignment',
  'fit',
  'projectConfig',
  'locale',
  'convert',
  'codegen',
];

const setsEqual = (left: Set<ToolbarItemId>, right: Set<ToolbarItemId>): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  return Array.from(left).every((item) => right.has(item));
};

const Toolbar: React.FC = () => {
  const {
    fitContentToView,
    showViewRelationModal,
    setShowViewRelationModal,
    canvasBackgroundColor,
    setCanvasBackgroundColor,
    showAlignmentGuides,
    setShowAlignmentGuides,
    selectedComponents,
    alignSelectedComponents,
    distributeSelectedComponents,
    resizeSelectedComponents,
    undo,
    redo,
    canUndo,
    canRedo,
    isSimulationRunning,
    operationInProgress,
    setOperationInProgress,
    simulationFlow,
    setSimulationFlow,
    guiVersion,
    setProjectI18nManagerOpen,
  } = useDesignerStore();

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showAlignMenu, setShowAlignMenu] = useState(false);
  const [showSimMenu, setShowSimMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showOverflowAlignMenu, setShowOverflowAlignMenu] = useState(false);
  const [overflowedItems, setOverflowedItems] = useState<Set<ToolbarItemId>>(new Set());

  const toolbarRef = useRef<HTMLDivElement>(null);
  const documentActionsRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<ToolbarItemId, HTMLDivElement>());
  const alignMenuRef = useRef<HTMLDivElement>(null);
  const simMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const setItemRef = (id: ToolbarItemId, node: HTMLDivElement | null) => {
    if (node) {
      itemRefs.current.set(id, node);
    } else {
      itemRefs.current.delete(id);
    }
  };

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const documentActions = documentActionsRef.current;
    const divider = dividerRef.current;
    const simulation = simulationRef.current;
    const more = moreRef.current;
    if (!toolbar || !documentActions || !divider || !simulation || !more) {
      return;
    }

    let animationFrame = 0;
    const calculateOverflow = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const styles = window.getComputedStyle(toolbar);
        const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
        const horizontalPadding = (Number.parseFloat(styles.paddingLeft) || 0)
          + (Number.parseFloat(styles.paddingRight) || 0);
        const availableWidth = toolbar.clientWidth - horizontalPadding - 12;
        const existingItems = COLLAPSE_ORDER.filter((id) => itemRefs.current.has(id));

        // 固定区域：文档操作、分隔线、弹性空白的最小宽度、仿真和更多按钮。
        const fixedWidth = documentActions.getBoundingClientRect().width
          + divider.getBoundingClientRect().width
          + simulation.getBoundingClientRect().width
          + 4;
        const itemWidth = existingItems.reduce((total, id) => {
          return total + (itemRefs.current.get(id)?.getBoundingClientRect().width || 0);
        }, 0);
        // 全部项目可见时不为“更多”预留空间；首次发生折叠时再计入该按钮。
        let requiredWidth = fixedWidth + itemWidth + Math.max(0, existingItems.length + 3) * gap;
        const nextOverflow = new Set<ToolbarItemId>();
        if (requiredWidth > availableWidth) {
          requiredWidth += more.getBoundingClientRect().width + gap;
        }

        for (const id of COLLAPSE_ORDER) {
          if (requiredWidth <= availableWidth) {
            break;
          }
          const item = itemRefs.current.get(id);
          if (!item) {
            continue;
          }
          nextOverflow.add(id);
          requiredWidth -= item.getBoundingClientRect().width + gap;
        }

        setOverflowedItems((current) => setsEqual(current, nextOverflow) ? current : nextOverflow);
      });
    };

    const observer = new ResizeObserver(calculateOverflow);
    observer.observe(toolbar);
    observer.observe(documentActions);
    observer.observe(simulation);
    observer.observe(more);
    itemRefs.current.forEach((item) => observer.observe(item));
    calculateOverflow();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [guiVersion]);

  useEffect(() => {
    if (overflowedItems.size === 0) {
      setShowMoreMenu(false);
    }
  }, [overflowedItems]);

  useEffect(() => {
    const hasOpenMenu = showColorPicker || showAlignMenu || showSimMenu || showMoreMenu;
    if (!hasOpenMenu) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showColorPicker && !target.closest('.background-color-picker')) {
        setShowColorPicker(false);
      }
      if (showAlignMenu && alignMenuRef.current && !alignMenuRef.current.contains(target)) {
        setShowAlignMenu(false);
      }
      if (showSimMenu && simMenuRef.current && !simMenuRef.current.contains(target)) {
        setShowSimMenu(false);
      }
      if (showMoreMenu && moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setShowMoreMenu(false);
        setShowOverflowAlignMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColorPicker, showAlignMenu, showSimMenu, showMoreMenu]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      setShowColorPicker(false);
      setShowAlignMenu(false);
      setShowSimMenu(false);
      setShowMoreMenu(false);
      setShowOverflowAlignMenu(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 从 webview 持久化状态中恢复仿真流程配置（缺省全部启用）。
  useEffect(() => {
    const saved = window.vscodeAPI?.getState?.()?.simulationFlow;
    if (saved && typeof saved === 'object') {
      setSimulationFlow(saved);
    }
  }, []);

  const isBusy = operationInProgress !== null || isSimulationRunning;
  const isOverflowed = (id: ToolbarItemId) => overflowedItems.has(id);
  const itemClassName = (id: ToolbarItemId) => `toolbar-responsive-item ${isOverflowed(id) ? 'toolbar-overflowed' : ''}`;

  const handleSave = () => {
    window.vscodeAPI?.postMessage({ command: 'save', content: {} });
    useDesignerStore.getState().markSaveRequested();
  };

  const handleGenerateAllCode = () => {
    if (isBusy) return;
    setOperationInProgress('codegen');
    window.vscodeAPI?.postMessage({ command: 'generateCode', content: {} });
  };

  const handleConvertResource = () => {
    if (isBusy) return;
    setOperationInProgress('convert');
    window.vscodeAPI?.postMessage({
      command: 'executeCommand',
      commandId: 'honeygui.convertResource',
    });
  };

  const handleUartDownload = () => {
    if (isBusy) return;
    setOperationInProgress('download');
    window.vscodeAPI?.postMessage({
      command: 'executeCommand',
      commandId: 'honeygui.uartDownload',
    });
  };

  const handleClean = () => {
    if (isBusy) return;
    setOperationInProgress('clean');
    window.vscodeAPI?.postMessage({
      command: 'executeCommand',
      commandId: 'honeygui.simulation.clean',
    });
  };

  const handleSimulation = () => {
    setShowSimMenu(false);
    if (isSimulationRunning) {
      window.vscodeAPI?.postMessage({
        command: 'executeCommand',
        commandId: 'honeygui.simulation.stop',
      });
      return;
    }
    if (isBusy || (!simulationFlow.convert && !simulationFlow.codegen && !simulationFlow.simulate)) {
      return;
    }
    setOperationInProgress('simulate');
    window.vscodeAPI?.postMessage({
      command: 'executeCommand',
      commandId: 'honeygui.simulation',
      args: { flow: simulationFlow },
    });
  };

  const toggleFlowStep = (step: 'convert' | 'codegen' | 'simulate') => {
    const next = { ...simulationFlow, [step]: !simulationFlow[step] };
    setSimulationFlow({ [step]: !simulationFlow[step] });
    const saved = window.vscodeAPI?.getState() || {};
    window.vscodeAPI?.setState({ ...saved, simulationFlow: next });
  };

  const flowSteps: Array<{ key: 'convert' | 'codegen' | 'simulate'; label: string; Icon: typeof Code }> = [
    { key: 'convert', label: t('Convert Resource'), Icon: Package },
    { key: 'codegen', label: t('Generate Code'), Icon: Code },
    { key: 'simulate', label: t('Simulate'), Icon: Rocket },
  ];

  const handleAlign = (type: AlignType, fromOverflow = false) => {
    alignSelectedComponents(type);
    setShowAlignMenu(false);
    if (fromOverflow) {
      setShowMoreMenu(false);
      setShowOverflowAlignMenu(false);
    }
  };

  const handleDistribute = (type: DistributeType, fromOverflow = false) => {
    distributeSelectedComponents(type);
    setShowAlignMenu(false);
    if (fromOverflow) {
      setShowMoreMenu(false);
      setShowOverflowAlignMenu(false);
    }
  };

  const handleResize = (type: ResizeType, fromOverflow = false) => {
    resizeSelectedComponents(type);
    setShowAlignMenu(false);
    if (fromOverflow) {
      setShowMoreMenu(false);
      setShowOverflowAlignMenu(false);
    }
  };

  const closeMoreAndRun = (action: () => void) => {
    setShowMoreMenu(false);
    setShowOverflowAlignMenu(false);
    action();
  };

  const guiVersionTitle = guiVersion
    ? guiVersion.engine === 'LVGL'
      ? `LVGL ${guiVersion.tag}`
      : `HoneyGUI ${guiVersion.tag}\n${t('Branch')}: ${guiVersion.branch}\nCommit: ${guiVersion.commit}\n${t('Build Date')}: ${guiVersion.buildDate}`
    : '';
  const hasCanvasOverflow = ['relations', 'guides', 'alignment', 'background', 'fit']
    .some((id) => isOverflowed(id as ToolbarItemId));
  const hasProjectOverflow = ['projectConfig', 'locale', 'i18nManager', 'guiVersion']
    .some((id) => isOverflowed(id as ToolbarItemId));
  const hasBuildOverflow = isOverflowed('convert') || isOverflowed('codegen');
  const hasOverflowedOperation = (operationInProgress === 'convert' && isOverflowed('convert'))
    || (operationInProgress === 'codegen' && isOverflowed('codegen'))
    || (operationInProgress === 'download' && isOverflowed('download'))
    || (operationInProgress === 'clean' && isOverflowed('clean'));

  return (
    <div ref={toolbarRef} className="toolbar" onContextMenu={(event) => event.preventDefault()}>
      <div ref={documentActionsRef} className="toolbar-section toolbar-document-actions">
        <button
          className="toolbar-button secondary"
          onClick={handleSave}
          title={`${t('Save')} (Ctrl+S)`}
          aria-label={t('Save')}
        >
          <Save size={16} strokeWidth={1.4} />
          <span>{t('Save')}</span>
        </button>
        <div className="toolbar-segmented">
          <button
            className="toolbar-icon-button"
            onClick={() => undo()}
            title={`${t('Undo')} (Ctrl+Z)`}
            aria-label={t('Undo')}
            disabled={!canUndo()}
          >
            <RotateCcw size={16} strokeWidth={1.4} />
          </button>
          <button
            className="toolbar-icon-button"
            onClick={() => redo()}
            title={`${t('Redo')} (Ctrl+Y)`}
            aria-label={t('Redo')}
            disabled={!canRedo()}
          >
            <RotateCw size={16} strokeWidth={1.4} />
          </button>
        </div>
      </div>

      <div ref={dividerRef} className="toolbar-divider" />

      <div ref={(node) => setItemRef('relations', node)} className={itemClassName('relations')}>
        <button
          className={`toolbar-icon-button ${showViewRelationModal ? 'active' : ''}`}
          onClick={() => setShowViewRelationModal(!showViewRelationModal)}
          title={t('View Relations')}
          aria-label={t('View Relations')}
        >
          <GitBranch size={16} strokeWidth={1.4} />
        </button>
      </div>

      <div ref={(node) => setItemRef('guides', node)} className={itemClassName('guides')}>
        <button
          className={`toolbar-icon-button ${showAlignmentGuides ? 'active' : ''}`}
          onClick={() => setShowAlignmentGuides(!showAlignmentGuides)}
          title={showAlignmentGuides ? t('Hide guides') : t('Show guides')}
          aria-label={showAlignmentGuides ? t('Hide guides') : t('Show guides')}
        >
          <Grid size={16} strokeWidth={1.4} />
        </button>
      </div>

      <div ref={(node) => setItemRef('alignment', node)} className={itemClassName('alignment')}>
        <div className="align-menu-container" ref={alignMenuRef}>
          <button
            className={`toolbar-icon-button ${selectedComponents.length < 2 ? 'disabled' : ''}`}
            onClick={() => selectedComponents.length >= 2 && setShowAlignMenu(!showAlignMenu)}
            title={selectedComponents.length < 2 ? t('Select at least 2 components') : t('Align and distribute')}
            aria-label={t('Align and distribute')}
            disabled={selectedComponents.length < 2}
          >
            <AlignLeft size={16} strokeWidth={1.4} />
            {selectedComponents.length >= 2 && <span className="selection-badge">{selectedComponents.length}</span>}
          </button>
          {showAlignMenu && selectedComponents.length >= 2 && (
            <div className="align-dropdown-menu">
              <div className="align-menu-section">
                <div className="align-menu-title">{t('Align')}</div>
                {getAlignmentConfigsByCategory('align').map((config) => (
                  <button key={config.type} className="align-menu-item" onClick={() => handleAlign(config.type as AlignType)}>
                    <span>{config.label}</span>
                    {config.shortcut && <span className="shortcut">{config.shortcut}</span>}
                  </button>
                ))}
              </div>
              <div className="align-menu-divider" />
              <div className="align-menu-section">
                <div className="align-menu-title">{t('Distribute')}</div>
                {getAlignmentConfigsByCategory('distribute').map((config) => (
                  <button
                    key={config.type}
                    className="align-menu-item"
                    onClick={() => handleDistribute(config.type as DistributeType)}
                    disabled={selectedComponents.length < config.minComponents}
                  >
                    <span>{config.label}</span>
                    {config.shortcut && <span className="shortcut">{config.shortcut}</span>}
                  </button>
                ))}
              </div>
              <div className="align-menu-divider" />
              <div className="align-menu-section">
                <div className="align-menu-title">{t('Size')}</div>
                {getAlignmentConfigsByCategory('resize').map((config) => (
                  <button key={config.type} className="align-menu-item" onClick={() => handleResize(config.type as ResizeType)}>
                    <span>{config.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div ref={(node) => setItemRef('background', node)} className={itemClassName('background')}>
        <div className="background-color-picker">
          <button
            className="toolbar-icon-button"
            onClick={() => setShowColorPicker(!showColorPicker)}
            title={t('Background Color')}
            aria-label={t('Background Color')}
          >
            <Palette size={16} strokeWidth={1.4} />
          </button>
          {showColorPicker && (
            <div className="color-picker-dropdown">
              {[
                { color: '#ffffff', label: t('White') },
                { color: '#000000', label: t('Black') },
                { color: '#3c3c3c', label: t('Dark Gray') },
              ].map(({ color, label }) => (
                <button
                  key={color}
                  className={`color-option ${canvasBackgroundColor === color ? 'active' : ''}`}
                  onClick={() => {
                    setCanvasBackgroundColor(color);
                    setShowColorPicker(false);
                  }}
                >
                  <span
                    className="color-preview"
                    style={{ backgroundColor: color, border: color === '#ffffff' ? '1px solid #ccc' : undefined }}
                  />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div ref={(node) => setItemRef('fit', node)} className={itemClassName('fit')}>
        <button className="toolbar-icon-button" onClick={fitContentToView} title={t('Fit All Content')} aria-label={t('Fit All Content')}>
          <Maximize2 size={16} strokeWidth={1.4} />
        </button>
      </div>

      <div className="toolbar-spacer" />

      <div ref={(node) => setItemRef('projectConfig', node)} className={itemClassName('projectConfig')}>
        <ProjectConfigSelect />
      </div>

      <div ref={(node) => setItemRef('locale', node)} className={itemClassName('locale')}>
        <ProjectI18nLocaleSelect />
      </div>

      <div ref={(node) => setItemRef('i18nManager', node)} className={itemClassName('i18nManager')}>
        <button
          className="toolbar-button"
          onClick={() => setProjectI18nManagerOpen(true)}
          title={t('Open I18n Manager')}
        >
          <Languages size={16} strokeWidth={1.4} />
          <span>{t('I18n Manager')}</span>
        </button>
      </div>

      {guiVersion && (
        <div ref={(node) => setItemRef('guiVersion', node)} className={itemClassName('guiVersion')}>
          <div className="toolbar-version-badge" title={guiVersionTitle}>
            <Info size={14} strokeWidth={1.4} />
            <span>{guiVersion.engine} {guiVersion.tag}</span>
          </div>
        </div>
      )}

      <div ref={(node) => setItemRef('convert', node)} className={itemClassName('convert')}>
        <button
          className={`toolbar-button secondary toolbar-build-button ${operationInProgress === 'convert' ? 'running' : ''}`}
          onClick={handleConvertResource}
          title={t('Convert Resource Tooltip')}
          disabled={isBusy}
        >
          <Package size={16} strokeWidth={1.4} />
          <span>{operationInProgress === 'convert' ? t('Converting...') : t('Convert Resource')}</span>
        </button>
      </div>

      <div ref={(node) => setItemRef('codegen', node)} className={itemClassName('codegen')}>
        <button
          className={`toolbar-button secondary toolbar-build-button ${operationInProgress === 'codegen' ? 'running' : ''}`}
          onClick={handleGenerateAllCode}
          title={t('Generate Code')}
          disabled={isBusy}
        >
          <Code size={16} strokeWidth={1.4} />
          <span>{operationInProgress === 'codegen' ? t('Generating...') : t('Generate Code')}</span>
        </button>
      </div>

      <div
        ref={(node) => {
          simulationRef.current = node;
          simMenuRef.current = node;
        }}
        className="toolbar-split-button"
      >
        <button
          className={`toolbar-button primary split-main ${isSimulationRunning ? 'running' : ''}`}
          onClick={handleSimulation}
          title={isSimulationRunning ? t('Stop Simulation') : t('Compile & Simulate')}
          disabled={isBusy && !isSimulationRunning}
        >
          {isSimulationRunning ? <Square size={15} strokeWidth={1.5} /> : <Rocket size={16} strokeWidth={1.4} />}
          <span>{isSimulationRunning ? t('Stop') : operationInProgress === 'simulate' ? t('Starting...') : t('Simulate')}</span>
        </button>
        {!isSimulationRunning && (
          <button
            className="toolbar-button primary split-arrow"
            onClick={() => {
              setShowMoreMenu(false);
              setShowSimMenu(!showSimMenu);
            }}
            disabled={isBusy}
            title={t('Configure simulation flow')}
            aria-label={t('Configure simulation flow')}
          >
            <ChevronDown size={12} strokeWidth={2} />
          </button>
        )}
        {showSimMenu && (
          <div className="sim-dropdown-menu">
            <div className="sim-menu-title">{t('Simulation Flow')}</div>
            {flowSteps.map(({ key, label, Icon }) => (
              <button key={key} className="sim-menu-item" onClick={() => toggleFlowStep(key)}>
                <span className={`flow-checkbox ${simulationFlow[key] ? 'checked' : ''}`}>
                  {simulationFlow[key] && <Check size={12} strokeWidth={3} />}
                </span>
                <Icon size={14} strokeWidth={1.4} />
                <span>{label}</span>
              </button>
            ))}
            <div className="sim-menu-hint">{t('Simulation Flow Hint')}</div>
          </div>
        )}
      </div>

      <div ref={(node) => setItemRef('download', node)} className={itemClassName('download')}>
        <button className="toolbar-icon-button" onClick={handleUartDownload} title={t('UART Download')} aria-label={t('UART Download')} disabled={isBusy}>
          <Download size={16} strokeWidth={1.4} />
        </button>
      </div>

      <div ref={(node) => setItemRef('clean', node)} className={itemClassName('clean')}>
        <button className="toolbar-icon-button" onClick={handleClean} title={t('Clean Build')} aria-label={t('Clean Build')} disabled={isBusy}>
          <BrushCleaning size={16} strokeWidth={1.4} />
        </button>
      </div>

      <div ref={moreRef} className={`toolbar-menu-container toolbar-more-container ${overflowedItems.size === 0 ? 'empty' : ''}`}>
        <div ref={moreMenuRef}>
          <button
            className={`toolbar-icon-button ${showMoreMenu ? 'active' : ''}`}
            onClick={() => {
              setShowSimMenu(false);
              setShowMoreMenu(!showMoreMenu);
              if (showMoreMenu) setShowOverflowAlignMenu(false);
            }}
            title={t('More Actions')}
            aria-label={t('More Actions')}
            aria-haspopup="menu"
            aria-expanded={showMoreMenu}
            tabIndex={overflowedItems.size === 0 ? -1 : 0}
          >
            <MoreHorizontal size={17} strokeWidth={1.6} />
            {hasOverflowedOperation && <span className="toolbar-operation-dot" />}
          </button>

          {showMoreMenu && overflowedItems.size > 0 && (
            <div className="toolbar-popover-menu toolbar-more-menu" role="menu">
              {hasCanvasOverflow && (
                <>
                  <div className="toolbar-menu-title">{t('Canvas Tools')}</div>
                  {isOverflowed('relations') && (
                    <button className={`toolbar-menu-item ${showViewRelationModal ? 'active' : ''}`} onClick={() => closeMoreAndRun(() => setShowViewRelationModal(!showViewRelationModal))}>
                      <GitBranch size={15} strokeWidth={1.4} />
                      <span>{t('View Relations')}</span>
                    </button>
                  )}
                  {isOverflowed('guides') && (
                    <button className={`toolbar-menu-item ${showAlignmentGuides ? 'active' : ''}`} onClick={() => closeMoreAndRun(() => setShowAlignmentGuides(!showAlignmentGuides))}>
                      <Grid size={15} strokeWidth={1.4} />
                      <span>{showAlignmentGuides ? t('Hide guides') : t('Show guides')}</span>
                    </button>
                  )}
                  {isOverflowed('alignment') && (
                    <>
                      <button
                        className="toolbar-menu-item"
                        onClick={() => setShowOverflowAlignMenu(!showOverflowAlignMenu)}
                        disabled={selectedComponents.length < 2}
                        title={selectedComponents.length < 2 ? t('Select at least 2 components') : ''}
                      >
                        <AlignLeft size={15} strokeWidth={1.4} />
                        <span>{t('Align and distribute')}</span>
                        <ChevronDown className={showOverflowAlignMenu ? 'expanded' : ''} size={13} strokeWidth={1.6} />
                      </button>
                      {showOverflowAlignMenu && selectedComponents.length >= 2 && (
                        <div className="toolbar-inline-submenu">
                          <div className="toolbar-menu-subtitle">{t('Align')}</div>
                          {getAlignmentConfigsByCategory('align').map((config) => (
                            <button key={config.type} className="toolbar-menu-item" onClick={() => handleAlign(config.type as AlignType, true)}>
                              <span>{config.label}</span>
                              {config.shortcut && <span className="shortcut">{config.shortcut}</span>}
                            </button>
                          ))}
                          <div className="toolbar-menu-subtitle">{t('Distribute')}</div>
                          {getAlignmentConfigsByCategory('distribute').map((config) => (
                            <button
                              key={config.type}
                              className="toolbar-menu-item"
                              onClick={() => handleDistribute(config.type as DistributeType, true)}
                              disabled={selectedComponents.length < config.minComponents}
                            >
                              <span>{config.label}</span>
                              {config.shortcut && <span className="shortcut">{config.shortcut}</span>}
                            </button>
                          ))}
                          <div className="toolbar-menu-subtitle">{t('Size')}</div>
                          {getAlignmentConfigsByCategory('resize').map((config) => (
                            <button key={config.type} className="toolbar-menu-item" onClick={() => handleResize(config.type as ResizeType, true)}>
                              <span>{config.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {isOverflowed('background') && (
                    <>
                      <div className="toolbar-menu-subtitle">{t('Background Color')}</div>
                      {[
                        { color: '#ffffff', label: t('White') },
                        { color: '#000000', label: t('Black') },
                        { color: '#3c3c3c', label: t('Dark Gray') },
                      ].map(({ color, label }) => (
                        <button
                          key={color}
                          className={`toolbar-menu-item ${canvasBackgroundColor === color ? 'active' : ''}`}
                          onClick={() => closeMoreAndRun(() => setCanvasBackgroundColor(color))}
                        >
                          <span className="toolbar-color-swatch" style={{ backgroundColor: color, border: color === '#ffffff' ? '1px solid #999' : undefined }} />
                          <span>{label}</span>
                          {canvasBackgroundColor === color && <Check size={13} strokeWidth={2} />}
                        </button>
                      ))}
                    </>
                  )}
                  {isOverflowed('fit') && (
                    <button className="toolbar-menu-item" onClick={() => closeMoreAndRun(fitContentToView)}>
                      <Maximize2 size={15} strokeWidth={1.4} />
                      <span>{t('Fit All Content')}</span>
                    </button>
                  )}
                  <div className="toolbar-menu-divider" />
                </>
              )}

              {hasProjectOverflow && (
                <>
                  <div className="toolbar-menu-title">{t('Project')}</div>
                  {(isOverflowed('projectConfig') || isOverflowed('locale')) && (
                    <div className="toolbar-menu-controls">
                      {isOverflowed('projectConfig') && <ProjectConfigSelect />}
                      {isOverflowed('locale') && <ProjectI18nLocaleSelect />}
                    </div>
                  )}
                  {isOverflowed('i18nManager') && (
                    <button className="toolbar-menu-item" onClick={() => closeMoreAndRun(() => setProjectI18nManagerOpen(true))}>
                      <Languages size={15} strokeWidth={1.4} />
                      <span>{t('I18n Manager')}</span>
                    </button>
                  )}
                  {isOverflowed('guiVersion') && guiVersion && (
                    <div className="toolbar-version-details" title={guiVersionTitle}>
                      <Info size={14} strokeWidth={1.4} />
                      <span>{guiVersion.engine} {guiVersion.tag}</span>
                    </div>
                  )}
                  <div className="toolbar-menu-divider" />
                </>
              )}

              {hasBuildOverflow && (
                <>
                  <div className="toolbar-menu-title">{t('Build Actions')}</div>
                  {isOverflowed('convert') && (
                    <button className="toolbar-menu-item" onClick={() => closeMoreAndRun(handleConvertResource)} disabled={isBusy}>
                      <Package size={15} strokeWidth={1.4} />
                      <span>{operationInProgress === 'convert' ? t('Converting...') : t('Convert Resource')}</span>
                    </button>
                  )}
                  {isOverflowed('codegen') && (
                    <button className="toolbar-menu-item" onClick={() => closeMoreAndRun(handleGenerateAllCode)} disabled={isBusy}>
                      <Code size={15} strokeWidth={1.4} />
                      <span>{operationInProgress === 'codegen' ? t('Generating...') : t('Generate Code')}</span>
                    </button>
                  )}
                  <div className="toolbar-menu-divider" />
                </>
              )}

              {isOverflowed('download') && (
                <>
                  <div className="toolbar-menu-title">{t('Deployment')}</div>
                  <button className="toolbar-menu-item" onClick={() => closeMoreAndRun(handleUartDownload)} disabled={isBusy}>
                    <Download size={15} strokeWidth={1.4} />
                    <span>{t('UART Download')}</span>
                  </button>
                  <div className="toolbar-menu-divider" />
                </>
              )}

              {isOverflowed('clean') && (
                <>
                  <div className="toolbar-menu-title">{t('Maintenance')}</div>
                  <button className="toolbar-menu-item" onClick={() => closeMoreAndRun(handleClean)} disabled={isBusy}>
                    <BrushCleaning size={15} strokeWidth={1.4} />
                    <span>{t('Clean Build')}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Toolbar;
