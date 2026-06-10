import React, { useState, useRef, useEffect } from 'react';
import { useDesignerStore } from '../store';
import { Save, Code, RotateCcw, RotateCw, ZoomIn, ZoomOut, Maximize2, GitBranch, Palette, AlignLeft, Grid, Download, Rocket, BrushCleaning, Square, Info, ChevronDown, Package, Check } from 'lucide-react';
import { AlignType, DistributeType, ResizeType, getAlignmentConfigsByCategory } from '../utils/alignmentUtils';
import { t } from '../i18n';
import './Toolbar.css';

const Toolbar: React.FC = () => {
  const {
    setZoom,
    zoom,
    setEditingMode,
    editingMode,
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
  } = useDesignerStore();

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showAlignMenu, setShowAlignMenu] = useState(false);
  const [showSimMenu, setShowSimMenu] = useState(false);
  const alignMenuRef = useRef<HTMLDivElement>(null);
  const simMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭颜色选择器
  React.useEffect(() => {
    if (!showColorPicker && !showAlignMenu && !showSimMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showColorPicker && !target.closest('.background-color-picker')) {
        setShowColorPicker(false);
      }
      if (showAlignMenu && alignMenuRef.current && !alignMenuRef.current.contains(target)) {
        setShowAlignMenu(false);
      }
      if (showSimMenu && simMenuRef.current && !simMenuRef.current.contains(target)) {
        setShowSimMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColorPicker, showAlignMenu, showSimMenu]);

  // 从 webview 持久化状态中恢复仿真流程配置（缺省全部启用）
  React.useEffect(() => {
    const saved = window.vscodeAPI?.getState?.()?.simulationFlow;
    if (saved && typeof saved === 'object') {
      setSimulationFlow(saved);
    }
  }, []);

  const handleZoomIn = () => {
    setZoom(Math.min(zoom * 1.2, 8));
  };

  const handleZoomOut = () => {
    setZoom(Math.max(zoom / 1.2, 0.25));
  };

  const handleZoomFit = () => {
    setZoom(1);
  };

  const handleSelectMode = () => {
    setEditingMode('select');
  };

  const handleToggleViewConnections = () => {
    setShowViewRelationModal(!showViewRelationModal);
  };

  const handleBackgroundColorChange = (color: string) => {
    setCanvasBackgroundColor(color);
    setShowColorPicker(false);
  };

  const handleSave = () => {
    window.vscodeAPI?.postMessage({
      command: 'save',
      content: {},
    });
  };

  // 是否有操作正在进行（用于禁用按钮）
  const isBusy = operationInProgress !== null || isSimulationRunning;

  const handleGenerateAllCode = () => {
    if (isBusy) return;
    setOperationInProgress('codegen');
    window.vscodeAPI?.postMessage({
      command: 'generateCode',
      content: {},
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

  const handleSimulation = () => {
    // 操作仿真时收起流程配置菜单
    setShowSimMenu(false);
    if (isSimulationRunning) {
      // 停止仿真始终允许
      window.vscodeAPI?.postMessage({
        command: 'executeCommand',
        commandId: 'honeygui.simulation.stop',
      });
    } else {
      if (isBusy) return;
      // 至少需勾选一个流程
      if (!simulationFlow.convert && !simulationFlow.codegen && !simulationFlow.simulate) return;
      setOperationInProgress('simulate');
      window.vscodeAPI?.postMessage({
        command: 'executeCommand',
        commandId: 'honeygui.simulation',
        args: { flow: simulationFlow },
      });
    }
  };

  // 独立的资源转换流程
  const handleConvertResource = () => {
    if (isBusy) return;
    setOperationInProgress('convert');
    window.vscodeAPI?.postMessage({
      command: 'executeCommand',
      commandId: 'honeygui.convertResource',
    });
  };

  // 切换某个流程阶段的勾选状态（在下拉中操作，不关闭菜单），并持久化到 webview 状态
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

  const handleClean = () => {
    if (isBusy) return;
    setOperationInProgress('clean');
    window.vscodeAPI?.postMessage({
      command: 'executeCommand',
      commandId: 'honeygui.simulation.clean',
    });
  };

  const handleUndo = () => {
    undo();
  };

  const handleRedo = () => {
    redo();
  };

  return (
    <div className="toolbar" onContextMenu={(e) => e.preventDefault()}>
      <div className="toolbar-section">
        <button
          className="toolbar-button"
          onClick={handleSave}
          title={`${t('Save')} (Ctrl+S)`}
        >
          <Save size={16} strokeWidth={1.4} />
          <span>{t('Save')}</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-section">
        <div className="toolbar-segmented">
          <button
            className="toolbar-icon-button"
            onClick={handleUndo}
            title={`${t('Undo')} (Ctrl+Z)`}
            disabled={!canUndo()}
          >
            <RotateCcw size={16} strokeWidth={1.4} />
          </button>
          <button
            className="toolbar-icon-button"
            onClick={handleRedo}
            title={`${t('Redo')} (Ctrl+Y)`}
            disabled={!canRedo()}
          >
            <RotateCw size={16} strokeWidth={1.4} />
          </button>
        </div>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-section">
        <button
          className="toolbar-icon-button"
          onClick={handleToggleViewConnections}
          title={t('View Relations')}
        >
          <GitBranch size={16} strokeWidth={1.4} />
        </button>
        
        <button
          className={`toolbar-icon-button ${showAlignmentGuides ? 'active' : ''}`}
          onClick={() => setShowAlignmentGuides(!showAlignmentGuides)}
          title={showAlignmentGuides ? t('Hide guides') : t('Show guides')}
        >
          <Grid size={16} strokeWidth={1.4} />
        </button>
        
        {/* Align button */}
        <div className="align-menu-container" ref={alignMenuRef}>
          <button
            className={`toolbar-icon-button ${selectedComponents.length < 2 ? 'disabled' : ''}`}
            onClick={() => selectedComponents.length >= 2 && setShowAlignMenu(!showAlignMenu)}
            title={selectedComponents.length < 2 ? t('Select at least 2 components') : t('Align and distribute')}
            disabled={selectedComponents.length < 2}
          >
            <AlignLeft size={16} strokeWidth={1.4} />
            {selectedComponents.length >= 2 && (
              <span className="selection-badge">{selectedComponents.length}</span>
            )}
          </button>
          {showAlignMenu && selectedComponents.length >= 2 && (
            <div className="align-dropdown-menu">
              <div className="align-menu-section">
                <div className="align-menu-title">{t('Align')}</div>
                {getAlignmentConfigsByCategory('align').map(config => (
                  <button
                    key={config.type}
                    className="align-menu-item"
                    onClick={() => {
                      alignSelectedComponents(config.type as AlignType);
                      setShowAlignMenu(false);
                    }}
                  >
                    <span>{config.label}</span>
                    {config.shortcut && <span className="shortcut">{config.shortcut}</span>}
                  </button>
                ))}
              </div>
              <div className="align-menu-divider" />
              <div className="align-menu-section">
                <div className="align-menu-title">{t('Distribute')}</div>
                {getAlignmentConfigsByCategory('distribute').map(config => (
                  <button
                    key={config.type}
                    className={`align-menu-item ${selectedComponents.length < config.minComponents ? 'disabled' : ''}`}
                    onClick={() => {
                      if (selectedComponents.length >= config.minComponents) {
                        distributeSelectedComponents(config.type as DistributeType);
                        setShowAlignMenu(false);
                      }
                    }}
                    disabled={selectedComponents.length < config.minComponents}
                    title={selectedComponents.length < config.minComponents ? `${t('Requires at least')} ${config.minComponents}` : ''}
                  >
                    <span>{config.label}</span>
                    {config.shortcut && <span className="shortcut">{config.shortcut}</span>}
                  </button>
                ))}
              </div>
              <div className="align-menu-divider" />
              <div className="align-menu-section">
                <div className="align-menu-title">{t('Size')}</div>
                {getAlignmentConfigsByCategory('resize').map(config => (
                  <button
                    key={config.type}
                    className="align-menu-item"
                    onClick={() => {
                      resizeSelectedComponents(config.type as ResizeType);
                      setShowAlignMenu(false);
                    }}
                  >
                    <span>{config.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="background-color-picker">
          <button
            className="toolbar-icon-button"
            onClick={() => setShowColorPicker(!showColorPicker)}
            title={t('Background Color')}
          >
            <Palette size={16} strokeWidth={1.4} />
          </button>
          {showColorPicker && (
            <div className="color-picker-dropdown">
              <button
                className={`color-option ${canvasBackgroundColor === '#ffffff' ? 'active' : ''}`}
                onClick={() => handleBackgroundColorChange('#ffffff')}
                title={t('White')}
              >
                <div className="color-preview" style={{ backgroundColor: '#ffffff', border: '1px solid #ccc' }} />
                <span>{t('White')}</span>
              </button>
              <button
                className={`color-option ${canvasBackgroundColor === '#000000' ? 'active' : ''}`}
                onClick={() => handleBackgroundColorChange('#000000')}
                title={t('Black')}
              >
                <div className="color-preview" style={{ backgroundColor: '#000000' }} />
                <span>{t('Black')}</span>
              </button>
              <button
                className={`color-option ${canvasBackgroundColor === '#3c3c3c' ? 'active' : ''}`}
                onClick={() => handleBackgroundColorChange('#3c3c3c')}
                title={t('Dark Gray')}
              >
                <div className="color-preview" style={{ backgroundColor: '#3c3c3c' }} />
                <span>{t('Dark Gray')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-section">
        <div className="toolbar-segmented">
          <button
            className="toolbar-icon-button"
            onClick={handleZoomOut}
            title={t('Zoom Out')}
          >
            <ZoomOut size={16} strokeWidth={1.4} />
          </button>
          <div className="segmented-value zoom-level">{Math.round(zoom * 100)}%</div>
          <button
            className="toolbar-icon-button"
            onClick={handleZoomIn}
            title={t('Zoom In')}
          >
            <ZoomIn size={16} strokeWidth={1.4} />
          </button>
          <button
            className="toolbar-icon-button"
            onClick={handleZoomFit}
            title={t('Fit to Screen')}
          >
            <Maximize2 size={16} strokeWidth={1.4} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {guiVersion && (
        <div className="toolbar-section">
          <div
            className="gui-version-badge"
            title={guiVersion.engine === 'LVGL'
              ? `LVGL ${guiVersion.tag}`
              : `HoneyGUI ${guiVersion.tag}\n${t('Branch')}: ${guiVersion.branch}\nCommit: ${guiVersion.commit}\n${t('Build Date')}: ${guiVersion.buildDate}`
            }
          >
            <Info size={14} strokeWidth={1.4} />
            <span>{guiVersion.engine} {guiVersion.tag}</span>
          </div>
        </div>
      )}

      <div className="toolbar-section">
        <button
          className={`toolbar-button primary ${operationInProgress === 'convert' ? 'running' : ''}`}
          onClick={handleConvertResource}
          title={t('Convert Resource Tooltip')}
          disabled={isBusy && operationInProgress !== 'convert'}
        >
          <Package size={16} strokeWidth={1.4} />
          <span>{operationInProgress === 'convert' ? t('Converting...') : t('Convert Resource')}</span>
        </button>
        <button
          className={`toolbar-button primary ${isBusy && operationInProgress === 'codegen' ? 'running' : ''}`}
          onClick={handleGenerateAllCode}
          title={t('Generate Code')}
          disabled={isBusy && operationInProgress !== 'codegen'}
        >
          <Code size={16} strokeWidth={1.4} />
          <span>{operationInProgress === 'codegen' ? t('Generating...') : t('Generate Code')}</span>
        </button>
        <div className="toolbar-split-button" ref={simMenuRef}>
          {/* 显性展示已勾选的流程阶段：仿真期间仍显示，但不可点击 */}
          <div
            className={`sim-flow-indicator ${isBusy ? 'disabled' : ''}`}
            onClick={() => !isBusy && setShowSimMenu(!showSimMenu)}
            title={t('Configured simulation flow')}
          >
            {flowSteps.map(({ key, label, Icon }) => (
              <span
                key={key}
                className={`flow-chip ${simulationFlow[key] ? 'active' : ''}`}
                title={`${label}: ${simulationFlow[key] ? t('Enabled') : t('Disabled')}`}
              >
                <Icon size={11} strokeWidth={1.6} />
              </span>
            ))}
          </div>
          <button
            className={`toolbar-button primary split-main ${isSimulationRunning ? 'running' : ''}`}
            onClick={handleSimulation}
            title={isSimulationRunning ? t('Stop Simulation') : t('Compile & Simulate')}
            disabled={isBusy && !isSimulationRunning}
          >
            {isSimulationRunning ? <Square size={16} strokeWidth={1.4} /> : <Rocket size={16} strokeWidth={1.4} />}
            <span>{isSimulationRunning ? t('Stop') : operationInProgress === 'simulate' ? t('Starting...') : t('Simulate')}</span>
          </button>
          {!isSimulationRunning && (
            <button
              className="toolbar-button primary split-arrow"
              onClick={() => setShowSimMenu(!showSimMenu)}
              disabled={isBusy}
              title={t('Configure simulation flow')}
            >
              <ChevronDown size={12} strokeWidth={2} />
            </button>
          )}
          {showSimMenu && (
            <div className="sim-dropdown-menu">
              <div className="sim-menu-title">{t('Simulation Flow')}</div>
              {flowSteps.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  className="sim-menu-item"
                  onClick={() => toggleFlowStep(key)}
                >
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
        <div className="toolbar-segmented">
          <button
            className="toolbar-icon-button"
            onClick={handleUartDownload}
            title={t('UART Download')}
            disabled={isBusy}
          >
            <Download size={16} strokeWidth={1.4} />
          </button>
          <button
            className="toolbar-icon-button"
            onClick={handleClean}
            title={t('Clean Build')}
            disabled={isBusy}
          >
            <BrushCleaning size={16} strokeWidth={1.4} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Toolbar;
