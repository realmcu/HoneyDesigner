import React, { useEffect, useState, useCallback } from 'react';
import { useDesignerStore } from './store';
import DesignerCanvas from './components/DesignerCanvas';
import ComponentLibrary, { componentDefinitions } from './components/ComponentLibrary';
import PropertiesPanel from './components/PropertiesPanel';
import ConversionConfigPanel from './components/ConversionConfigPanel';
import ComponentTree from './components/ComponentTree';
import AssetsPanel from './components/AssetsPanel';
import Toolbar from './components/Toolbar';
import { ViewRelationModal } from './components/ViewRelationModal';
import { CanvasEditorModal } from './components/CanvasEditorModal';
import { Component, ComponentType } from './types';
import useKeyboardShortcuts from './utils/keyboardShortcuts';
import { generateComponentId } from './utils/componentNaming';
import { getAbsolutePosition, findComponentAtPosition, isDropTargetType, isContainerType } from './utils/componentUtils';
import { handleCreateComponentMessage, createLabelComponentAtPosition } from './services/messageHandler';
import { processImageFiles } from './utils/fileUtils';
import { parseObjDependencies, parseMtlDependencies, findDependencyFiles } from './utils/objDependencyParser';
import { clearUriCache } from './hooks/useWebviewUri';
import { setLocale, t } from './i18n';
import './App.css';

// 从types.ts导入已有的Window接口扩展
import './types';

// 调试开关 - 生产环境应设为false
const DEBUG_DROP = false;

import { usePanelResize, usePanelShortcuts } from './hooks/usePanelResize';

const App: React.FC = () => {
  const {
    setVSCodeAPI,
    setComponents,
    selectComponent,
    selectedComponent,
    addComponent,
    setProjectConfig,
    setCanvasBackgroundColor,
    components,
    showViewRelationModal,
    setShowViewRelationModal,
    updateComponent,
    selectedAsset,
    setSelectedAsset,
  } = useDesignerStore();

  // Tab 切换状态
  const [activeTab, setActiveTab] = React.useState<'components' | 'assets' | 'tree'>('components');
  
  // 文件加载状态（用于避免切换时的闪烁）
  const [isLoadingFile, setIsLoadingFile] = React.useState(false);

  // 保存 Tab 状态到 store（当 Tab 切换时）
  React.useEffect(() => {
    const store = useDesignerStore.getState();
    store.saveViewState({
      leftPanelTab: activeTab,
      leftPanelVisible: !leftPanel.isCollapsed,
      rightPanelVisible: !rightPanel.isCollapsed,
      leftPanelWidth: leftPanel.width,
      rightPanelWidth: rightPanel.width,
    });
  }, [activeTab]);

  // Canvas 编辑器弹窗状态
  const [canvasEditorOpen, setCanvasEditorOpen] = useState(false);
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);

  // 面板状态管理
  const leftPanel = usePanelResize({ defaultWidth: 280, minWidth: 200, maxWidth: 500 });
  const rightPanel = usePanelResize({ defaultWidth: 300, minWidth: 250, maxWidth: 500 });
  
  // 保存面板状态（当面板可见性或宽度改变时）
  React.useEffect(() => {
    const store = useDesignerStore.getState();
    store.saveViewState({
      leftPanelTab: activeTab,
      leftPanelVisible: !leftPanel.isCollapsed,
      rightPanelVisible: !rightPanel.isCollapsed,
      leftPanelWidth: leftPanel.width,
      rightPanelWidth: rightPanel.width,
    });
  }, [leftPanel.isCollapsed, rightPanel.isCollapsed, leftPanel.width, rightPanel.width, activeTab]);
  
  // 面板快捷键
  usePanelShortcuts(leftPanel.toggle, rightPanel.toggle);

  // Initialize keyboard shortcuts
  useKeyboardShortcuts();

  // 打开 Canvas 编辑器
  const openCanvasEditor = useCallback((componentId: string) => {
    setEditingCanvasId(componentId);
    setCanvasEditorOpen(true);
  }, []);

  // 监听来自属性面板的 Canvas 编辑请求
  useEffect(() => {
    const handleOpenCanvasEditor = (e: CustomEvent<{ componentId: string }>) => {
      openCanvasEditor(e.detail.componentId);
    };
    window.addEventListener('openCanvasEditor', handleOpenCanvasEditor as EventListener);
    return () => {
      window.removeEventListener('openCanvasEditor', handleOpenCanvasEditor as EventListener);
    };
  }, [openCanvasEditor]);

  // 保存 Canvas SVG 内容
  const handleCanvasSvgSave = useCallback((svgContent: string) => {
    if (editingCanvasId) {
      const comp = components.find(c => c.id === editingCanvasId);
      if (comp) {
        updateComponent(editingCanvasId, {
          data: { ...comp.data, svgContent },
        });
      }
    }
  }, [editingCanvasId, components, updateComponent]);

  // 获取当前编辑的 Canvas 的 SVG 内容
  const getEditingCanvasSvg = useCallback(() => {
    if (editingCanvasId) {
      const comp = components.find(c => c.id === editingCanvasId);
      return (comp?.data?.svgContent as string) || '';
    }
    return '';
  }, [editingCanvasId, components]);

  // 安全初始化VSCode API（确保只使用已有的实例）
  useEffect(() => {
    let readySent = false;
    
    // 添加错误处理
    const handleGlobalError = (e: ErrorEvent) => {
      console.error('[HoneyGUI Designer] Global error:', e.error);
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c62828;color:white;padding:10px;z-index:9999;font-family:monospace;font-size:12px;white-space:pre-wrap;';
      errorDiv.textContent = t('Error') + ': ' + (e.error?.message || 'Unknown error') + '\n' + (e.error?.stack || 'No stack trace');
      document.body.appendChild(errorDiv);
    };

    const handleUnhandledRejection = (e: PromiseRejectionEvent) => {
      console.error('[HoneyGUI Designer] Unhandled promise rejection:', e.reason);
    };

    // 检查是否已经有VSCode API实例
    if (!window.vscodeAPI) {
      console.warn('[HoneyGUI App] VSCode API not initialized yet, will retry...');
      return;
    }
    
    // 使用现有的API实例，绝对不尝试重新获取
    setVSCodeAPI(window.vscodeAPI);
    console.log('[HoneyGUI App] Using existing VSCode API instance');
    
    // 主动请求加载数据（只发送一次）
    if (!readySent) {
      console.log('[HoneyGUI App] 发送ready消息请求数据...');
      window.vscodeAPI.postMessage({ command: 'ready' });
      readySent = true;
    }

    // Listen for messages from extension
    window.addEventListener('message', (event) => {
      const message = event.data;

      switch (message.command) {
        case 'updateProjectConfig':
          // 更新项目配置（project.json 文件变化时触发）
          if (message.projectConfig) {
            const store = useDesignerStore.getState();
            store.setProjectConfig(message.projectConfig);

            // 同步所有 hg_view 的尺寸为新的分辨率（与 cornerRadius 逻辑一致）
            const res = message.projectConfig.resolution;
            if (res) {
              const parts = res.split('X');
              const newWidth = parseInt(parts[0], 10);
              const newHeight = parseInt(parts[1], 10);
              if (newWidth > 0 && newHeight > 0) {
                const views = store.components.filter(c => c.type === 'hg_view');
                if (views.length > 0) {
                  views.forEach(v => {
                    store.updateComponent(v.id, {
                      position: { ...v.position, width: newWidth, height: newHeight }
                    }, { save: false });
                  });
                  store.saveToFile();
                }
              }
            }
          }
          break;
          
        case 'setLocale':
          // Set locale from extension
          if (message.locale) {
            setLocale(message.locale);
            // 【关键】保存语言设置到 VSCode 状态，下次加载时可以直接使用
            try {
              const currentState = window.vscodeAPI?.getState() || {};
              window.vscodeAPI?.setState({ ...currentState, locale: message.locale });
            } catch (error) {
              console.warn('[HoneyGUI] Failed to save locale to state:', error);
            }
          }
          break;

        case 'loadHml':
          // 直接使用store方法，避免闭包问题
          const store = useDesignerStore.getState();

          // 切换文件前，确保防抖中的视图状态已写入 localStorage
          store.flushSaveViewState();

          // 记录是否已有组件（区分首次加载和保存后刷新）
          const hadComponentsBefore = store.components.length > 0;
          
          // 首次加载时清空旧组件并显示加载状态，保存后刷新时保持当前状态
          if (!hadComponentsBefore) {
            setIsLoadingFile(true);
            useDesignerStore.setState({ components: [] });
          }
          
          // Set locale if provided（同时保存到状态）
          if (message.locale) {
            setLocale(message.locale);
            try {
              const currentState = window.vscodeAPI?.getState() || {};
              window.vscodeAPI?.setState({ ...currentState, locale: message.locale });
            } catch (error) {
              console.warn('[HoneyGUI] Failed to save locale to state:', error);
            }
          }
          
          // 【优化】使用 setTimeout 延迟处理，确保清空操作先完成
          setTimeout(() => {
            // 先恢复 UI 状态（面板），再批量更新 store，减少渲染次数
            if (message.currentFilePath) {
              // 恢复该文件的视图状态（不触发渲染）
              const { restored, state: savedState } = store.restoreViewState(message.currentFilePath);
              
              // 先恢复 UI 状态（面板），这些操作会触发 React 状态更新
              if (restored && savedState) {
                // 恢复左侧面板 Tab（同步更新，避免闪烁）
                if (savedState.leftPanelTab && savedState.leftPanelTab !== activeTab) {
                  setActiveTab(savedState.leftPanelTab);
                }
                
                // 恢复面板可见性
                const shouldLeftPanelBeCollapsed = !savedState.leftPanelVisible;
                const shouldRightPanelBeCollapsed = !savedState.rightPanelVisible;
                
                if (shouldLeftPanelBeCollapsed !== leftPanel.isCollapsed) {
                  leftPanel.toggle();
                }
                if (shouldRightPanelBeCollapsed !== rightPanel.isCollapsed) {
                  rightPanel.toggle();
                }
                
                // 恢复面板宽度
                if (savedState.leftPanelWidth && savedState.leftPanelWidth !== leftPanel.width) {
                  leftPanel.setWidth(savedState.leftPanelWidth);
                }
                if (savedState.rightPanelWidth && savedState.rightPanelWidth !== rightPanel.width) {
                  rightPanel.setWidth(savedState.rightPanelWidth);
                }
              }
              
              // 【关键】批量更新所有 store 状态，只触发一次渲染
              const batchUpdate: any = {
                currentFilePath: message.currentFilePath,
              };
              
              // 添加项目配置
              if (message.projectConfig) {
                batchUpdate.projectConfig = message.projectConfig;
                // 同时更新画布尺寸
                const resolution = message.projectConfig.resolution;
                if (resolution) {
                  const parts = resolution.split('X');
                  if (parts.length === 2) {
                    batchUpdate.canvasSize = {
                      width: parseInt(parts[0], 10),
                      height: parseInt(parts[1], 10)
                    };
                  }
                }
              }
              
              // 添加画布背景色
              if (message.designerConfig?.canvasBackgroundColor) {
                batchUpdate.canvasBackgroundColor = message.designerConfig.canvasBackgroundColor;
              }
              
              // 添加 view 列表
              if (message.allViews) {
                batchUpdate.allViews = message.allViews;
              }
              
              // 添加 HML 文件列表
              if (message.allHmlFiles) {
                batchUpdate.allHmlFiles = message.allHmlFiles;
              }
              
              // 添加其他文件的组件 ID（跨文件命名去重）
              if (message.otherFileComponentIds) {
                batchUpdate.otherFileComponentIds = message.otherFileComponentIds;
              }
              
              // 如果有组件数据，添加到批量更新中
              if (message.components) {
                batchUpdate.components = message.components;
              }
              
              // 恢复选中状态：首次加载从 savedState 恢复，保存后刷新保持当前选中
              if (hadComponentsBefore) {
                // 保存后刷新：保持当前选中状态不变（不设置 selectedComponent）
                console.log('[ViewState] 保存后刷新，保持当前选中状态');
              } else if (restored && savedState) {
                batchUpdate.selectedComponent = savedState.selectedComponent;
                console.log('[ViewState] 首次加载，恢复选中状态');
              }
              
              // 添加仿真状态
              if (typeof message.isSimulationRunning === 'boolean') {
                batchUpdate.isSimulationRunning = message.isSimulationRunning;
              }
              
              // 添加 GUI 库版本信息
              if (message.guiVersion) {
                batchUpdate.guiVersion = message.guiVersion;
              }
              
              // 【关键】一次性更新所有状态，只触发一次渲染
              useDesignerStore.setState(batchUpdate);
              
              // 【关键】延迟隐藏加载状态，确保渲染完成
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  setIsLoadingFile(false);
                });
              });
              
              // 首次打开文件时自适应居中显示，保存后刷新不重置视图
              if (message.components) {
                if (!hadComponentsBefore) {
                  console.log('[ViewState] 首次加载，自适应居中显示内容');
                  setTimeout(() => {
                    store.fitContentToView();
                  }, 0);
                } else {
                  console.log('[ViewState] 保存后刷新，保持当前视图');
                }
              }
            } else {
              // 没有 currentFilePath 的情况（旧逻辑兼容）
              store.setProjectConfig(message.projectConfig || null);
              
              if (message.designerConfig?.canvasBackgroundColor) {
                store.setCanvasBackgroundColor(message.designerConfig.canvasBackgroundColor);
              }

              if (message.allViews) {
                useDesignerStore.setState({ allViews: message.allViews });
              }

              if (message.allHmlFiles) {
                useDesignerStore.setState({ allHmlFiles: message.allHmlFiles });
              }
              
              if (message.otherFileComponentIds) {
                useDesignerStore.setState({ otherFileComponentIds: message.otherFileComponentIds });
              }
              
              if (message.guiVersion) {
                useDesignerStore.setState({ guiVersion: message.guiVersion });
              }
              
              if (message.components) {
                store.setComponents(message.components);
                // 仅首次加载时自适应居中
                if (!hadComponentsBefore) {
                  setTimeout(() => { store.fitContentToView(); }, 0);
                }
              }
              
              // 隐藏加载状态
              setIsLoadingFile(false);
            }
          }, 0);
          break;

        case 'showMessage':
          // Show success message
          console.log(message.text);
          break;

        case 'updateOtherFileComponentIds':
          // 刷新跨文件组件 ID（面板获得焦点时触发）
          if (message.otherFileComponentIds) {
            useDesignerStore.setState({ otherFileComponentIds: message.otherFileComponentIds });
          }
          break;

        case 'updateAllViews':
          // 刷新所有视图列表（保存文件后触发）
          if (message.allViews || message.allHmlFiles) {
            const updates: any = {};
            if (message.allViews) {
              updates.allViews = message.allViews;
            }
            if (message.allHmlFiles) {
              updates.allHmlFiles = message.allHmlFiles;
            }
            useDesignerStore.setState(updates);
          }
          break;

        case 'error':
          // Show error message
          console.error(message.text);
          break;

        case 'updateImagePath':
          // 更新图片组件的路径和尺寸
          if (message.componentId && message.path) {
            const store = useDesignerStore.getState();
            const component = store.components.find(c => c.id === message.componentId);
            if (component) {
              // 支持不同的属性名（src, imageOn, imageOff 等）
              const propertyName = message.propertyName || 'src';
              // iconImages 是数组，追加而非覆盖
              if (propertyName === 'iconImages') {
                const existing: string[] = Array.isArray(component.data?.iconImages) ? component.data.iconImages : [];
                store.updateComponent(message.componentId, {
                  data: {
                    ...component.data,
                    iconImages: [...existing, message.path]
                  }
                });
              } else {
                const updates: any = {
                  data: {
                    ...component.data,
                    [propertyName]: message.path
                  }
                };
                // 如果有图片尺寸，同时更新组件尺寸（仅对 src 属性）
                if (message.imageSize && propertyName === 'src') {
                  updates.position = {
                    ...component.position,
                    width: message.imageSize.width,
                    height: message.imageSize.height
                  };
                }
                store.updateComponent(message.componentId, updates);
              }
            }
          }
          break;

        case 'folderPathSelected':
          // 接收后端扫描文件夹的结果，更新 hg_menu_cellular 的 iconImages 和 iconFolder
          if (message.componentId && Array.isArray(message.imagePaths)) {
            const store = useDesignerStore.getState();
            const component = store.components.find(c => c.id === message.componentId);
            if (component) {
              store.updateComponent(message.componentId, {
                data: {
                  ...component.data,
                  iconImages: message.imagePaths,
                  iconFolder: message.folderPath || ''
                }
              });
            }
          }
          break;

        case 'updateGlassPath':
          // 更新玻璃组件的形状路径
          if (message.componentId && message.path) {
            const store = useDesignerStore.getState();
            const component = store.components.find(c => c.id === message.componentId);
            if (component) {
              store.updateComponent(message.componentId, {
                data: {
                  ...component.data,
                  src: message.path
                }
              });
            }
          }
          break;

        case 'fontPathSelected':
          if (message.componentId && message.path) {
            const store = useDesignerStore.getState();
            const component = store.components.find(c => c.id === message.componentId);
            if (component) {
              store.updateComponent(message.componentId, {
                data: { ...component.data, fontFile: message.path }
              });
            }
          }
          break;

        case 'createImageComponent':
        case 'createGifComponent':
        case 'create3DComponent':
        case 'createVideoComponent':
        case 'createSvgComponent':
        case 'createGlassComponent':
        case 'createLottieComponent':
          {
            const store = useDesignerStore.getState();
            const newId = handleCreateComponentMessage(message);
            if (newId) store.selectComponent(newId);
          }
          break;

        case 'updateVideoSize':
          if (message.componentId && message.videoSize) {
            const store = useDesignerStore.getState();
            const component = store.components.find(c => c.id === message.componentId);
            if (component) {
              store.updateComponent(message.componentId, {
                position: {
                  ...component.position,
                  width: message.videoSize.width,
                  height: message.videoSize.height
                }
              });
            }
          }
          break;

        case 'componentPropertyUpdated':
          // 更新组件属性（来自文件浏览器）
          if (message.success && message.componentId && message.propertyName) {
            const store = useDesignerStore.getState();
            const component = store.components.find(c => c.id === message.componentId);
            if (component) {
              store.updateComponent(message.componentId, {
                data: {
                  ...component.data,
                  [message.propertyName]: message.value
                }
              });
              console.log(`[Webview App] 更新组件属性: ${message.propertyName} = ${message.value}`);
            }
          }
          break;

        case 'assetDeleted':
          // 资源文件被删除，清除 URI 缓存并清空引用该资源的组件 src
          if (message.assetPath) {
            clearUriCache(message.assetPath);
            const store = useDesignerStore.getState();
            store.components.forEach(c => {
              if (c.data?.src === message.assetPath) {
                store.updateComponent(c.id, {
                  data: { ...c.data, src: '' }
                });
              }
            });
            console.log(`[Webview App] 资源已删除，清除引用: ${message.assetPath}`);
          }
          break;

        case 'simulationStatus':
          // 更新仿真状态
          if (typeof message.isRunning === 'boolean') {
            const store = useDesignerStore.getState();
            store.setSimulationRunning(message.isRunning);
            // 仿真启动成功后清除 operationInProgress（由 isSimulationRunning 接管）
            // 仿真停止后也清除
            if (store.operationInProgress === 'simulate') {
              store.setOperationInProgress(null);
            }
          }
          break;

        case 'operationComplete':
          // 操作完成，清除忙碌状态
          {
            const store = useDesignerStore.getState();
            store.setOperationInProgress(null);
          }
          break;

        case 'conversionConfigLoaded':
          // 加载转换配置
          if (message.config) {
            const store = useDesignerStore.getState();
            store.setConversionConfig(message.config);
            console.log('[Webview App] 转换配置已加载');
          } else if (message.error) {
            console.error('[Webview App] 加载转换配置失败:', message.error);
          }
          break;


        case 'undoRedoState':
          if (typeof message.canUndo === 'boolean') {
            useDesignerStore.setState({
              undoStack: message.canUndo ? ['placeholder'] : [],
              redoStack: message.canRedo ? ['placeholder'] : [],
            });
          }
          break;
      }
    });

    // 添加错误监听器
    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // 检查React是否渲染成功
    setTimeout(() => {
      if (!document.getElementById('root')?.hasChildNodes()) {
        console.error('[HoneyGUI Designer] React app did not render!');
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#c62828;color:white;padding:20px;border-radius:4px;font-family:monospace;';
        errorDiv.innerHTML = `<h3>${t('React App not rendered')}</h3><p>${t('Please check console for error details')}</p>`;
        document.body.appendChild(errorDiv);
      }
    }, 2000);

    // 清理函数
    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [setVSCodeAPI, setComponents]);

  /**
   * 处理画布上的拖放事件，将组件从组件库添加到设计器画布
   *
   * 组件添加策略：
   * 1. **容器组件** (View/Panel/Window): 作为顶级组件放置在画布上
   *    - parent = null
   *    - 可以包含其他组件作为子组件
   *
   * 2. **UI组件** (Button/Label/Input等): 必须放在某个组件内
   *    - 优先放到当前选中的组件内
   *    - 如果没有选中组件，放到第一个容器内
   *    - 如果没有任何容器，提示用户先创建容器
   *
   * @param e 拖放事件对象
   */
  
  /**
   * 查找拖放目标容器
   */
  const findDropTarget = (e: React.DragEvent): Component | null => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const state = useDesignerStore.getState();
    // 使用 effectiveZoom 以匹配画布的 transform scale
    const effectiveZoom = state.zoom / (window.devicePixelRatio || 1);
    const x = Math.round((e.clientX - rect.left - state.canvasOffset.x) / effectiveZoom);
    const y = Math.round((e.clientY - rect.top - state.canvasOffset.y) / effectiveZoom);

    return findComponentAtPosition(x, y, state.components);
  };

  const handleImageFileDrop = async (e: React.DragEvent, files: FileList, createComponent: boolean = true) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const state = useDesignerStore.getState();
    // 使用 effectiveZoom 以匹配画布的 transform scale
    const effectiveZoom = state.zoom / (window.devicePixelRatio || 1);
    const x = Math.round((e.clientX - rect.left - state.canvasOffset.x) / effectiveZoom);
    const y = Math.round((e.clientY - rect.top - state.canvasOffset.y) / effectiveZoom);

    let targetContainer: Component | null = null;

    if (createComponent) {
      targetContainer = findDropTarget(e);
      
      if (!targetContainer) {
        const api = useDesignerStore.getState().vscodeAPI;
        if (api) {
          api.postMessage({
            command: 'error',
            text: t('Please drop image into container (View/Window)')
          });
        }
        return;
      }
    }

    // 使用工具函数处理图片文件
    await processImageFiles(files, (file, index, data) => {
      const api = useDesignerStore.getState().vscodeAPI;
      if (api) {
        api.postMessage({
          command: 'saveImageToAssets',
          fileName: file.name,
          fileData: Array.from(data),
          dropPosition: createComponent ? { x: x + index * 20, y: y + index * 20 } : undefined,
          targetContainerId: createComponent ? targetContainer!.id : undefined
        });
      }
    });
  };

  const handleModelFileDrop = async (e: React.DragEvent, files: FileList) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const state = useDesignerStore.getState();
    // 使用 effectiveZoom 以匹配画布的 transform scale
    const effectiveZoom = state.zoom / (window.devicePixelRatio || 1);
    const x = Math.round((e.clientX - rect.left - state.canvasOffset.x) / effectiveZoom);
    const y = Math.round((e.clientY - rect.top - state.canvasOffset.y) / effectiveZoom);

    const targetContainer = findDropTarget(e);
    if (!targetContainer) {
      const api = useDesignerStore.getState().vscodeAPI;
      if (api) {
        api.postMessage({
          command: 'error',
          text: t('Please drop 3D model into container (View/Window)')
        });
      }
      return;
    }

    // 处理 3D 模型文件
    const modelExts = ['obj', 'gltf', 'glb'];
    const fileArray = Array.from(files);
    const objFiles = fileArray.filter(f => f.name.toLowerCase().endsWith('.obj'));
    
    let offset = 0;
    
    // 处理 OBJ 文件及其依赖
    for (const objFile of objFiles) {
      const deps = await parseObjDependencies(objFile);
      const depFiles = findDependencyFiles(objFile.name, deps, files);
      
      // 如果找到 MTL，解析其贴图依赖
      if (depFiles.mtl) {
        const mtlDeps = await parseMtlDependencies(depFiles.mtl, deps);
        deps.textures = mtlDeps.textures;
        depFiles.textures = fileArray.filter(f => deps.textures.includes(f.name));
      }
      
      // 上传所有文件
      const filesToUpload = [objFile];
      if (depFiles.mtl) filesToUpload.push(depFiles.mtl);
      filesToUpload.push(...depFiles.textures);
      
      for (const file of filesToUpload) {
        await uploadFileToAssets(file);
      }
      
      // 检查缺失的依赖并提示
      const missingFiles: string[] = [];
      if (deps.mtlFile && !depFiles.mtl) {
        missingFiles.push(deps.mtlFile);
      }
      const missingTextures = deps.textures.filter(t => 
        !depFiles.textures.some(f => f.name === t)
      );
      missingFiles.push(...missingTextures);
      
      if (missingFiles.length > 0) {
        const api = useDesignerStore.getState().vscodeAPI;
        if (api) {
          api.postMessage({
            command: 'notify',
            text: `${objFile.name} 缺少依赖文件: ${missingFiles.join(', ')}。请同时选中这些文件一起拖拽。`
          });
        }
      }
      
      // 创建 3D 组件（只为 OBJ 文件创建）
      const api = useDesignerStore.getState().vscodeAPI;
      if (api) {
        api.postMessage({
          command: 'create3DComponent',
          modelPath: `assets/${objFile.name}`,
          dropPosition: { x: x + offset, y: y + offset },
          targetContainerId: targetContainer.id
        });
      }
      
      offset += 20;
      
      console.log(`[OBJ依赖] ${objFile.name} 已导入到画布，包含:`, {
        mtl: depFiles.mtl?.name,
        textures: depFiles.textures.map(f => f.name),
        missing: missingFiles
      });
    }
    
    // 处理其他 3D 模型文件（gltf, glb）
    const otherModels = fileArray.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext && modelExts.includes(ext) && ext !== 'obj';
    });
    
    for (const file of otherModels) {
      await uploadFileToAssets(file);
      
      const api = useDesignerStore.getState().vscodeAPI;
      if (api) {
        api.postMessage({
          command: 'create3DComponent',
          modelPath: `assets/${file.name}`,
          dropPosition: { x: x + offset, y: y + offset },
          targetContainerId: targetContainer.id
        });
      }
      offset += 20;
    }
  };

  const uploadFileToAssets = (file: File): Promise<void> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const uint8Array = new Uint8Array(arrayBuffer);
        
        const api = useDesignerStore.getState().vscodeAPI;
        if (api) {
          api.postMessage({
            command: 'saveImageToAssets',
            fileName: file.name,
            fileData: Array.from(uint8Array),
            relativePath: '',
            dropPosition: undefined,
            targetContainerId: undefined
          });
        }
        resolve();
      };
      reader.readAsArrayBuffer(file);
    });
  };

  /**
   * 从组件库右键菜单创建组件
   * 在当前选中的容器或第一个 hg_view 中创建组件
   */
  const handleCreateComponentFromLibrary = (componentType: ComponentType, preset?: any) => {
    const componentDef = componentDefinitions.find(def => def.type === componentType);
    if (!componentDef) {
      console.error(`未找到组件类型 ${componentType} 的定义配置`);
      return;
    }

    const components = useDesignerStore.getState().components;
    const currentSelected = useDesignerStore.getState().selectedComponent;
    
    // 查找目标容器：优先使用当前选中的容器，否则使用第一个 hg_view
    let targetContainer: Component | null = null;
    
    if (currentSelected) {
      const selectedComp = components.find(c => c.id === currentSelected);
      if (selectedComp && isDropTargetType(selectedComp.type)) {
        targetContainer = selectedComp;
      } else if (selectedComp?.parent) {
        // 如果选中的不是容器，使用其父容器
        const parentComp = components.find(c => c.id === selectedComp.parent);
        if (parentComp && isDropTargetType(parentComp.type)) {
          targetContainer = parentComp;
        }
      }
    }
    
    // 如果没有找到目标容器，使用第一个 hg_view
    if (!targetContainer) {
      targetContainer = components.find(c => c.type === 'hg_view') || null;
    }
    
    if (!targetContainer) {
      const api = useDesignerStore.getState().vscodeAPI;
      if (api) {
        api.postMessage({
          command: 'error',
          text: t('Please drop component into container (View/Window)')
        });
      }
      return;
    }

    // 生成唯一组件ID（含跨文件去重）
    const otherIds1 = useDesignerStore.getState().otherFileComponentIds;
    const componentId = generateComponentId(componentType, components, otherIds1);
    
    // 默认位置和尺寸
    let defWidth = componentDef.defaultSize.width;
    let defHeight = componentDef.defaultSize.height;
    
    // 对于 hg_view，使用项目配置的分辨率作为默认大小
    if (componentType === 'hg_view') {
      const state = useDesignerStore.getState();
      // 优先从 canvasSize 读取（已加载的文件）
      if (state.canvasSize && (state.canvasSize.width !== 800 || state.canvasSize.height !== 480)) {
        defWidth = state.canvasSize.width;
        defHeight = state.canvasSize.height;
      } 
      // 如果 canvasSize 是默认值，从 projectConfig 读取
      else if (state.projectConfig?.resolution) {
        const parts = state.projectConfig.resolution.split('X');
        if (parts.length === 2) {
          defWidth = parseInt(parts[0], 10) || defWidth;
          defHeight = parseInt(parts[1], 10) || defHeight;
        }
      }
    }
    
    const positionX = Math.max(0, Math.floor((targetContainer.position.width - defWidth) / 2));
    const positionY = Math.max(0, Math.floor((targetContainer.position.height - defHeight) / 2));

    // 应用默认样式
    const defaultStyle: Record<string, any> = {};
    componentDef.properties
      .filter(prop => prop.group === 'style' && prop.defaultValue !== undefined)
      .forEach(prop => {
        defaultStyle[prop.name] = prop.defaultValue;
      });

    // 应用默认数据
    const defaultData: Record<string, any> = {};
    componentDef.properties
      .filter(prop => prop.group === 'data' && prop.defaultValue !== undefined)
      .forEach(prop => {
        defaultData[prop.name] = prop.defaultValue;
      });

    // 时间标签：自动添加时间字符集
    if (componentType === 'hg_time_label') {
      defaultData.characterSets = [
        { type: 'string', value: '0123456789:- ' }
      ];
    }

    // 计时器标签：自动添加计时器字符集
    if (componentType === 'hg_timer_label') {
      defaultData.characterSets = [
        { type: 'string', value: '0123456789:- ' }
      ];
    }

    // 应用默认通用属性
    componentDef.properties
      .filter(prop => prop.group === 'general' && prop.defaultValue !== undefined)
      .forEach(prop => {
        defaultData[prop.name] = prop.defaultValue;
      });

    // 应用预设属性（如果有）
    if (preset) {
      Object.assign(defaultData, preset);
    }

    // 创建新组件对象
    const newComponent: Component = {
      id: componentId,
      type: componentType,
      name: componentId,
      position: {
        x: positionX,
        y: positionY,
        width: defWidth,
        height: defHeight,
      },
      visible: true,
      enabled: true,
      locked: false,
      showOverflow: false,
      zIndex: 1,
      children: [],
      parent: targetContainer.id,
      style: defaultStyle,
      data: defaultData,
    };

    addComponent(newComponent);
    selectComponent(newComponent.id);
  };

  // 监听从组件库创建带预设的组件
  useEffect(() => {
    const handleCreateWithPreset = (e: CustomEvent<{ componentType: ComponentType; preset: any }>) => {
      handleCreateComponentFromLibrary(e.detail.componentType, e.detail.preset);
    };
    window.addEventListener('createComponentWithPreset', handleCreateWithPreset as EventListener);
    return () => {
      window.removeEventListener('createComponentWithPreset', handleCreateWithPreset as EventListener);
    };
  }, []);

  // 防止短时间内重复处理 drop 事件的时间戳守卫
  const lastDropTimeRef = React.useRef(0);

  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 防重复：200ms 内不允许第二次 drop
    const now = Date.now();
    if (now - lastDropTimeRef.current < 200) {
      console.warn('[拖放] 忽略重复的 drop 事件');
      return;
    }
    lastDropTimeRef.current = now;

    console.log('========== [拖放] handleCanvasDrop 开始 ==========');
    console.log('[拖放] dataTransfer.types:', e.dataTransfer.types);
    console.log('[拖放] dataTransfer.files.length:', e.dataTransfer.files.length);
    
    if (DEBUG_DROP) {
      console.log('[拖放] ⚠️ 如果看不到日志，请右键设计器画布 → 检查元素，打开Webview开发者工具');
    }
    
    // 检查是否是从资源面板拖拽
    const assetPath = e.dataTransfer.getData('asset-path');
    console.log('[拖放] asset-path 数据:', assetPath);
    if (assetPath) {
      // 从资源面板拖拽资源到画布
      const targetContainer = findDropTarget(e);
      console.log('[拖放] 找到的目标容器:', targetContainer);
      if (!targetContainer) {
        console.log('[拖放] ❌ 未找到目标容器，需要拖放到容器内');
        const api = useDesignerStore.getState().vscodeAPI;
        if (api) {
          api.postMessage({
            command: 'error',
            text: t('Please drop asset into container (View/Window)')
          });
        }
        return;
      }
      console.log('[拖放] ✅ 目标容器:', targetContainer.type, targetContainer.id);

      const canvasRect = document.querySelector('.designer-canvas')?.getBoundingClientRect();
      if (!canvasRect) return;

      const state = useDesignerStore.getState();
      
      // 使用 effectiveZoom 以匹配画布的 transform scale
      const effectiveZoom = state.zoom / (window.devicePixelRatio || 1);
      
      // 将鼠标坐标转换为画布坐标系（考虑 canvasOffset 和 effectiveZoom）
      const x = (e.clientX - canvasRect.left - state.canvasOffset.x) / effectiveZoom;
      const y = (e.clientY - canvasRect.top - state.canvasOffset.y) / effectiveZoom;

      const api = useDesignerStore.getState().vscodeAPI;
      if (api) {
        // 判断文件类型
        const ext = assetPath.split('.').pop()?.toLowerCase();
        const is3DModel = ext && ['obj', 'gltf', 'glb'].includes(ext);
        const isVideo = ext && ['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(ext);
        const isSvg = ext === 'svg';
        const isGlass = ext === 'glass';  // .glass 文件作为 SVG 处理
        const isLottie = ext && ['json', 'lottie'].includes(ext);
        const isGif = ext === 'gif';  // GIF 动画
        const isFont = ext && ['ttf', 'otf', 'woff', 'woff2'].includes(ext);
        
        if (isFont) {
          // 字体文件：直接创建 Label 组件，fontFile 使用 VFS 路径格式
          const fontFileName = assetPath.split('/').pop() || assetPath;
          const store = useDesignerStore.getState();
          const newId = createLabelComponentAtPosition(
            `/${fontFileName}`,
            { x, y },
            targetContainer.id,
            store.components,
            store.addComponent
          );
          if (newId) store.selectComponent(newId);
        } else if (is3DModel) {
          // 3D 模型：直接创建组件
          api.postMessage({
            command: 'create3DComponent',
            modelPath: `assets/${assetPath}`,
            dropPosition: { x, y },
            targetContainerId: targetContainer.id
          });
        } else if (isLottie) {
            // Lottie 动画
            api.postMessage({
                command: 'createLottieComponent',
                lottiePath: `assets/${assetPath}`,
                dropPosition: { x, y },
                targetContainerId: targetContainer.id
            });
        } else if (isVideo) {
          // 视频：获取尺寸后创建组件
          api.postMessage({
            command: 'getVideoSize',
            videoPath: `assets/${assetPath}`,
            dropPosition: { x, y },
            targetContainerId: targetContainer.id
          });
        } else if (isSvg) {
          // SVG：创建 SVG 组件
          api.postMessage({
            command: 'createSvgComponent',
            svgPath: `assets/${assetPath}`,
            dropPosition: { x, y },
            targetContainerId: targetContainer.id
          });
        } else if (isGlass) {
          // Glass：创建 Glass 组件
          api.postMessage({
            command: 'createGlassComponent',
            glassPath: `assets/${assetPath}`,
            dropPosition: { x, y },
            targetContainerId: targetContainer.id
          });
        } else if (isGif) {
          // GIF 动画：获取尺寸后创建 GIF 组件
          api.postMessage({
            command: 'getGifSize',
            gifPath: `assets/${assetPath}`,
            dropPosition: { x, y },
            targetContainerId: targetContainer.id
          });
        } else {
          // 图片：获取尺寸后创建
          api.postMessage({
            command: 'getImageSize',
            imagePath: `assets/${assetPath}`,
            dropPosition: { x, y },
            targetContainerId: targetContainer.id
          });
        }
      }
      return;
    }
    
    // 检查是否是文件拖拽
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = e.dataTransfer.files;
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
      const modelExts = ['obj', 'gltf', 'glb'];
      
      // 检查是否有图片或 3D 文件
      const hasImage = Array.from(files).some(file => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        return ext && imageExts.includes(ext);
      });
      
      const hasModel = Array.from(files).some(file => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        return ext && modelExts.includes(ext);
      });
      
      if (hasModel) {
        // 优先处理 3D 模型文件拖拽（包含依赖的贴图）
        handleModelFileDrop(e, files);
        return;
      }
      
      if (hasImage) {
        // 处理图片文件拖拽（支持多文件）
        handleImageFileDrop(e, files, true);
        return;
      }
    }
    
    const componentType = e.dataTransfer.getData('component-type') as ComponentType;
    if (!componentType) {
      if (DEBUG_DROP) console.log('[拖放] 没有组件类型，退出');
      return;
    }

    const componentDef = componentDefinitions.find(def => def.type === componentType);
    if (!componentDef) {
      console.error(`[拖放] 未找到组件类型 ${componentType} 的定义配置`);
      return;
    }

    const components = useDesignerStore.getState().components;
    const currentSelected = useDesignerStore.getState().selectedComponent;

    if (DEBUG_DROP) {
      console.log(`[拖放] 组件类型: ${componentType}`);
      console.log(`[拖放] 当前选中: ${currentSelected || '无'}`);
    }

    // 计算鼠标释放时的画布坐标位置
    const canvasRect = document.querySelector('.designer-canvas')?.getBoundingClientRect();
    if (!canvasRect) return;

    const state = useDesignerStore.getState();
    
    // 使用 effectiveZoom 以匹配画布的 transform scale
    const effectiveZoom = state.zoom / (window.devicePixelRatio || 1);
    
    // 将鼠标坐标转换为画布坐标系
    // 注意：不能用 Math.max(0, ...) 截断，因为画布可能被拖动到负坐标区域
    const x = Math.round((e.clientX - canvasRect.left - state.canvasOffset.x) / effectiveZoom);
    const y = Math.round((e.clientY - canvasRect.top - state.canvasOffset.y) / effectiveZoom);

    if (DEBUG_DROP) {
      console.log(`[拖放] ========== 坐标计算 ==========`);
      console.log(`[拖放] e.clientX: ${e.clientX}, e.clientY: ${e.clientY}`);
      console.log(`[拖放] canvasRect: left=${canvasRect.left}, top=${canvasRect.top}`);
      console.log(`[拖放] canvasOffset: x=${state.canvasOffset.x}, y=${state.canvasOffset.y}`);
      console.log(`[拖放] zoom: ${state.zoom}, effectiveZoom: ${effectiveZoom}`);
      console.log(`[拖放] 最终画布坐标: x=${x}, y=${y}`);
    }

    // 生成唯一组件ID（含跨文件去重）
    const otherIds2 = useDesignerStore.getState().otherFileComponentIds;
    const componentId = generateComponentId(componentType, components, otherIds2);

    let positionX = x;
    let positionY = y;
    
    // 对于hg_view，使用项目配置的分辨率作为默认大小
    let width = componentDef.defaultSize.width;
    let height = componentDef.defaultSize.height;
    
    if (componentType === 'hg_view') {
      // 优先从 canvasSize 读取（已加载的文件）
      if (state.canvasSize && (state.canvasSize.width !== 800 || state.canvasSize.height !== 480)) {
        width = state.canvasSize.width;
        height = state.canvasSize.height;
      } 
      // 如果 canvasSize 是默认值，从 projectConfig 读取
      else if (state.projectConfig?.resolution) {
        const parts = state.projectConfig.resolution.split('X');
        if (parts.length === 2) {
          width = parseInt(parts[0], 10) || width;
          height = parseInt(parts[1], 10) || height;
        }
      }
    }
    
    let parent: string | null = null;

    // 判断是否为顶级容器组件（只有 hg_view）
    const isTopLevelContainer = componentType === 'hg_view';
    // 判断是否为可嵌套的容器组件（hg_window, hg_list, hg_canvas 等）
    const isNestedContainer = isContainerType(componentType) && !isTopLevelContainer;

    if (isTopLevelContainer) {
      // 顶级容器组件：作为顶级组件
      parent = null;
      if (DEBUG_DROP) console.info(`[拖放] 顶级容器组件 ${componentType} 作为顶级组件`);
    } else {
      // UI组件或可嵌套容器：必须放在某个容器内
      // 根据鼠标位置查找目标容器
      let targetContainer: Component | null = null;
      
      if (DEBUG_DROP) {
        console.log(`[拖放] ========== 开始查找目标容器 ==========`);
        console.log(`[拖放] 鼠标画布坐标: (${x}, ${y})`);
        console.log(`[拖放] 当前组件总数: ${components.length}`);
      }
      
      // 遍历所有组件，找到鼠标位置下的最内层容器
      for (const comp of components) {
        // 只有可作为拖放目标的容器类型才能作为目标
        if (!isDropTargetType(comp.type)) {
          continue;
        }
        
        if (DEBUG_DROP) console.log(`[拖放] 检查容器: ${comp.type}(${comp.id})`);
        const absPos = getAbsolutePosition(comp, components);
        const { width: cw, height: ch } = comp.position;
        
        if (DEBUG_DROP) {
          console.log(`[拖放]   绝对位置: (${absPos.x}, ${absPos.y}), 尺寸: ${cw}x${ch}`);
          console.log(`[拖放]   范围: X[${absPos.x} - ${absPos.x + cw}], Y[${absPos.y} - ${absPos.y + ch}]`);
        }
        
        // 检查鼠标是否在组件范围内
        const inRangeX = x >= absPos.x && x <= absPos.x + cw;
        const inRangeY = y >= absPos.y && y <= absPos.y + ch;
        if (DEBUG_DROP) console.log(`[拖放]   鼠标在X范围内: ${inRangeX}, 在Y范围内: ${inRangeY}`);
        
        if (inRangeX && inRangeY) {
          if (DEBUG_DROP) console.log(`[拖放]   ✓ 鼠标在此组件范围内`);
          // 如果还没有目标，或者当前组件比已找到的更内层（面积更小）
          if (!targetContainer || (cw * ch < targetContainer.position.width * targetContainer.position.height)) {
            if (DEBUG_DROP) console.log(`[拖放]   ✓ 设置为目标容器 (面积: ${cw * ch})`);
            targetContainer = comp;
          } else {
            if (DEBUG_DROP) console.log(`[拖放]   × 面积更大，不是最内层 (当前: ${cw * ch}, 已有: ${targetContainer.position.width * targetContainer.position.height})`);
          }
        } else {
          if (DEBUG_DROP) console.log(`[拖放]   × 鼠标不在此组件范围内`);
        }
      }
      
      if (DEBUG_DROP) {
        console.log(`[拖放] ========== 查找结果 ==========`);
        console.log(`[拖放] 找到目标容器:`, targetContainer ? `${targetContainer.type}(${targetContainer.id})` : '未找到');
      }
      
      if (targetContainer) {
        parent = targetContainer.id;
        // 转换为相对于目标容器的坐标
        const targetAbsPos = getAbsolutePosition(targetContainer, components);
        positionX = Math.max(0, x - targetAbsPos.x);
        positionY = Math.max(0, y - targetAbsPos.y);
        if (DEBUG_DROP) {
          console.log(`[拖放] 目标容器绝对位置: (${targetAbsPos.x}, ${targetAbsPos.y})`);
          console.log(`[拖放] UI组件相对坐标: (${positionX}, ${positionY})`);
          console.info(`[拖放] ✓ ${isNestedContainer ? '嵌套容器' : 'UI组件'} ${componentType} 添加到容器 ${targetContainer.id}`);
        }
      } else {
        // 没有找到容器，提示用户
        console.error('[拖放] 鼠标位置下没有容器组件');
        const api = useDesignerStore.getState().vscodeAPI;
        if (api) {
          // 所有组件类型统一使用国际化错误提示
          api.postMessage({
            command: 'error',
            text: t('Please drop component into container (View/Window)')
          });
        }
        return;
      }
    }

    // 应用默认样式
    const defaultStyle: Record<string, any> = {};
    componentDef.properties
      .filter(prop => prop.group === 'style' && prop.defaultValue !== undefined)
      .forEach(prop => {
        defaultStyle[prop.name] = prop.defaultValue;
      });

    // hg_particle 特殊处理：默认宽高为屏幕宽高，因为 effect 支持自适应
    if (componentType === 'hg_particle') {
      const projectConfig = useDesignerStore.getState().projectConfig;
      const resolution = projectConfig?.resolution || '480X272';
      const [resWidth, resHeight] = resolution.split('X').map(Number);
      width = resWidth;
      height = resHeight;
    }

    // hg_menu_cellular 特殊处理：默认宽高为屏幕分辨率
    if (componentType === 'hg_menu_cellular') {
      const projectConfig = useDesignerStore.getState().projectConfig;
      const resolution = projectConfig?.resolution || '480X272';
      const [resWidth, resHeight] = resolution.split('X').map(Number);
      width = resWidth;
      height = resHeight;
    }

    // hg_list 特殊处理：默认宽高为屏幕宽高，项尺寸根据方向自动计算
    if (componentType === 'hg_list') {
      const projectConfig = useDesignerStore.getState().projectConfig;
      const resolution = projectConfig?.resolution || '480X272';
      const [resWidth, resHeight] = resolution.split('X').map(Number);
      
      // 列表宽高默认为屏幕宽高
      width = resWidth;
      height = resHeight;
      
      // 默认垂直列表，项宽度=列表宽度，项高度=屏幕高度/5
      defaultStyle.itemWidth = resWidth;
      defaultStyle.itemHeight = Math.round(resHeight / 5);
    }

    // 应用默认数据
    const defaultData: Record<string, any> = {
      text: componentType === 'hg_button' ? 'Button' :
            componentType === 'hg_label' ? 'Label' : '',
    };
    componentDef.properties
      .filter(prop => prop.group === 'data' && prop.defaultValue !== undefined)
      .forEach(prop => {
        defaultData[prop.name] = prop.defaultValue;
      });

    // 应用默认通用属性（general group）
    componentDef.properties
      .filter(prop => prop.group === 'general' && prop.defaultValue !== undefined)
      .forEach(prop => {
        defaultData[prop.name] = prop.defaultValue;
      });

    // 创建新组件对象
    const newComponent: Component = {
      id: componentId,
      type: componentType,
      name: componentId,
      position: {
        x: positionX,
        y: positionY,
        width,
        height,
      },
      visible: true,
      enabled: true,
      locked: false,
      showOverflow: componentType === 'hg_list', // hg_list 默认勾选超出父容器
      zIndex: 1,
      children: [],
      parent,
      style: defaultStyle,
      data: defaultData,
    };

    addComponent(newComponent);
    selectComponent(newComponent.id);
  };

  const handleCanvasDragOver= (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    // 只有点击canvas本身（不是子元素）时才清除选择
    if (e.target === e.currentTarget) {
      selectComponent(null);
    }
  };

  const handleComponentSelect = (id: string | null) => {
    selectComponent(id);
    // 当选择画布上的组件时，清除资源选择，显示属性面板
    if (id !== null) {
      setSelectedAsset(null);
    }
  };

  // 统一的右键菜单处理（传递给Canvas和Tree）
  const handleComponentContextMenu = (e: React.MouseEvent, componentId: string) => {
    // 转发给 DesignerCanvas 处理
    // 这里通过自定义事件实现
    const event = new CustomEvent('component-context-menu', {
      detail: { mouseEvent: e, componentId }
    });
    window.dispatchEvent(event);
  };

  // 处理面板宽度调整
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (leftPanel.isResizing) {
        const newWidth = e.clientX;
        if (newWidth >= 200 && newWidth <= 500) {
          leftPanel.setWidth(newWidth);
        }
      } else if (rightPanel.isResizing) {
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth >= 250 && newWidth <= 500) {
          rightPanel.setWidth(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      leftPanel.stopResize();
      rightPanel.stopResize();
    };

    if (leftPanel.isResizing || rightPanel.isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [leftPanel.isResizing, rightPanel.isResizing]);

  return (
    <div className="app">
      {/* 文件加载遮罩 - 避免切换时的闪烁 */}
      {isLoadingFile && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'var(--vscode-editor-background)',
          zIndex: 9999,
          opacity: 1
        }} />
      )}
      
      {/* Toolbar */}
      <Toolbar />

      {/* Main Content */}
      <div className="main-content" onContextMenu={(e) => e.preventDefault()}>
        {/* Left Panel - Tabbed */}
        <div className="left-panel" style={{ width: `${leftPanel.width}px`, display: leftPanel.isCollapsed ? 'none' : 'flex' }}>
          {/* Tab Headers */}
          <div className="tab-headers">
            <button 
              className={`tab-header ${activeTab === 'components' ? 'active' : ''}`}
              onClick={() => setActiveTab('components')}
            >
              {t('Component Library')}
            </button>
            <button 
              className={`tab-header ${activeTab === 'assets' ? 'active' : ''}`}
              onClick={() => setActiveTab('assets')}
            >
              {t('Assets')}
            </button>
            <button 
              className={`tab-header ${activeTab === 'tree' ? 'active' : ''}`}
              onClick={() => setActiveTab('tree')}
            >
              {t('Component Tree')}
            </button>
          </div>

          {/* Tab Content */}
          <div className="tab-content">
            <div style={{ display: activeTab === 'components' ? 'contents' : 'none' }}>
              <ComponentLibrary onComponentDragStart={() => {}} onCreateComponent={handleCreateComponentFromLibrary} />
            </div>
            <div style={{ display: activeTab === 'assets' ? 'contents' : 'none' }}>
              <AssetsPanel />
            </div>
            <div style={{ display: activeTab === 'tree' ? 'contents' : 'none' }}>
              <ComponentTree onContextMenu={handleComponentContextMenu} isTabActive={activeTab === 'tree'} />
            </div>
          </div>
        </div>

        {/* Resizer for left panel */}
        <div 
          className={`panel-resizer ${leftPanel.isResizing ? 'resizing' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); leftPanel.startResize(); }}
          style={{ display: leftPanel.isCollapsed ? 'none' : 'block' }}
        >
          <button
            className="collapse-button left"
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); leftPanel.toggle(); }}
            title="收起左侧面板 (Ctrl+B)"
          >
            ◀
          </button>
        </div>

        {/* Left Panel Collapsed Button */}
        {leftPanel.isCollapsed && (
          <button 
            className="expand-button left"
            onClick={leftPanel.toggle}
            title="展开左侧面板 (Ctrl+B)"
          >
            ▶
          </button>
        )}

        {/* Center - Canvas */}
        <div
          className="canvas-container"
        >
          <DesignerCanvas 
            onComponentSelect={handleComponentSelect}
            onDrop={handleCanvasDrop}
            onDragOver={handleCanvasDragOver}
            onCanvasDoubleClick={openCanvasEditor}
          />
        </div>

        {/* Right Panel Collapsed Button */}
        {rightPanel.isCollapsed && (
          <button 
            className="expand-button right"
            onClick={rightPanel.toggle}
            title="展开右侧面板 (Ctrl+Shift+B)"
          >
            ◀
          </button>
        )}

        {/* Resizer for right panel */}
        <div 
          className={`panel-resizer ${rightPanel.isResizing ? 'resizing' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); rightPanel.startResize(); }}
          style={{ display: rightPanel.isCollapsed ? 'none' : 'block' }}
        >
          <button
            className="collapse-button right"
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); rightPanel.toggle(); }}
            title="收起右侧面板 (Ctrl+Shift+B)"
          >
            ▶
          </button>
        </div>

        {/* Right Panel - Properties or Conversion Config */}
        <div className="right-panel" style={{ width: `${rightPanel.width}px`, display: rightPanel.isCollapsed ? 'none' : 'flex' }}>
          {selectedAsset ? (
            <ConversionConfigPanel />
          ) : (
            <PropertiesPanel />
          )}
        </div>
      </div>

      {/* View Relation Modal */}
      <ViewRelationModal
        visible={showViewRelationModal}
        onClose={() => setShowViewRelationModal(false)}
      />

      {/* Canvas Editor Modal */}
      <CanvasEditorModal
        isOpen={canvasEditorOpen}
        initialSvg={getEditingCanvasSvg()}
        onSave={handleCanvasSvgSave}
        onClose={() => setCanvasEditorOpen(false)}
      />

    </div>
  );
};

export default App;
