import { useEffect } from 'react';
import { useDesignerStore, applyHostComponents, clearDesignerHistory } from '../store';
import { withoutHistory } from '../store/history';
import { Component } from '../types';
import type { NavEditResultMessage } from '../types';
import { handleCreateComponentMessage } from '../services/messageHandler';
import { clearUriCache } from './useWebviewUri';
import { beginImageLoadTracking, waitForTrackedImages } from '../utils/imageLoadTracker';
import { setLocale, t } from '../i18n';
import type { PanelState } from './usePanelResize';

export type LeftPanelTab = 'components' | 'assets' | 'tree';

/** loadHml 恢复文件视图状态时要改的 App 局部 UI 状态 */
export interface HostMessageUi {
  activeTab: LeftPanelTab;
  setActiveTab: (tab: LeftPanelTab) => void;
  leftPanel: PanelState;
  rightPanel: PanelState;
  setIsLoadingFile: (loading: boolean) => void;
}

/** 处理一条宿主消息。大多数消息只写 store；loadHml 还会恢复面板布局 */
function dispatchHostMessage(message: any, ui: HostMessageUi): void {
  const { activeTab, setActiveTab, leftPanel, rightPanel, setIsLoadingFile } = ui;

  switch (message.command) {
    case 'updateProjectConfig':
      // 更新项目配置（project.json 文件变化时触发）
      if (message.projectConfig) {
        const store = useDesignerStore.getState();
        store.setProjectConfig(message.projectConfig);

        // 即时刷新画布：把内存中所有 hg_view 尺寸对齐新分辨率，让用户立即看到变化。
        // 注意：这里【不】落盘。磁盘写入统一由后端 FileManager._syncAllViewSizes 负责
        // （含当前文件），避免前端 saveToFile 与后端写盘对同一文件产生双写竞态。
        // 后端写盘后会触发 reload，最终以 sendLoadHmlMessage 规范化后的数据为准。
        const res = message.projectConfig.resolution;
        if (res) {
          const parts = res.split('X');
          const newWidth = parseInt(parts[0], 10);
          const newHeight = parseInt(parts[1], 10);
          if (newWidth > 0 && newHeight > 0) {
            const views = store.components.filter(c => c.type === 'hg_view');
            // 跟随工程分辨率的派生同步，不进入撤销历史
            withoutHistory(() => views.forEach(v => {
              store.updateComponent(v.id, {
                position: { ...v.position, width: newWidth, height: newHeight }
              }, { save: false });
            }));
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
      const loadReceivedAt = performance.now();
      if (message.loadId) {
        const imageComponentIds = (message.components || [])
          .filter((component: Component) => component.type === 'hg_image' && component.data?.src)
          .map((component: Component) => component.id);
        beginImageLoadTracking(message.loadId, imageComponentIds);
      }

      // 切换文件前，确保防抖中的视图状态已写入 localStorage
      store.flushSaveViewState();

      // 记录是否已有组件（区分首次加载和保存后刷新）
      const hadComponentsBefore = store.components.length > 0;

      // 首次加载时清空旧组件并显示加载状态，保存后刷新时保持当前状态
      if (!hadComponentsBefore) {
        setIsLoadingFile(true);
        applyHostComponents(() => useDesignerStore.setState({ components: [] }));
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

          if (message.projectI18nCatalog) {
            const savedPreviewLocale = window.vscodeAPI?.getState?.()?.projectPreviewLocale;
            batchUpdate.projectI18nCatalog = message.projectI18nCatalog;
            batchUpdate.previewLocale = message.projectI18nCatalog.locales?.includes(savedPreviewLocale)
              ? savedPreviewLocale
              : (message.previewLocale || message.projectI18nCatalog.defaultLocale);
          }

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
          // （宿主推送的内容，components 变化不记为未保存改动）
          applyHostComponents(() => useDesignerStore.setState(batchUpdate));
          const storeUpdatedAt = performance.now();

          // 应用宿主内容后 store 与磁盘同步，复位脏状态并通知宿主；
          // 旧快照不再对应磁盘内容（切换文件、外部修改、导航编辑），清空撤销历史
          if (message.components) {
            clearDesignerHistory();
            useDesignerStore.getState().resetDirty();
          }

          // 导航图"打开所在页面"：文件加载完成后选中目标控件
          {
            const pendingSelect = useDesignerStore.getState().pendingSelectComponentId;
            if (pendingSelect) {
              useDesignerStore.getState().setPendingSelectComponent(null);
              const loaded = useDesignerStore.getState().components;
              if (loaded.some(c => c.id === pendingSelect)) {
                useDesignerStore.getState().selectComponent(pendingSelect);
              }
            }
          }

          if (message.loadId) {
            // 性能测试等待真实可操作点：首批组件绘制、loading 隐藏和视口适配均完成。
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setIsLoadingFile(false);
                requestAnimationFrame(() => {
                  if (message.components && !hadComponentsBefore) {
                    store.fitContentToView();
                  }
                  requestAnimationFrame(() => {
                    void (async () => {
                      const imageWaitStartedAt = performance.now();
                      const imageResult = await waitForTrackedImages(message.loadId);
                      const canvasReadyAt = performance.now();
                      window.vscodeAPI?.postMessage({
                        command: 'canvasReady',
                        loadId: message.loadId,
                        hostStartedAt: message.hostStartedAt,
                        hostMetrics: message.hostMetrics,
                        webviewMetrics: {
                          storeUpdateMs: storeUpdatedAt - loadReceivedAt,
                          firstRenderMs: imageWaitStartedAt - storeUpdatedAt,
                          imageWaitMs: canvasReadyAt - imageWaitStartedAt,
                          imageExpected: imageResult.expected,
                          imageCompleted: imageResult.completed,
                          imageFailed: imageResult.failed,
                          imageTimedOut: imageResult.timedOut,
                        },
                      });
                    })();
                  });
                });
              });
            });
          } else {
            // 普通加载保持原有渲染时序，性能探针不改变生产行为。
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setIsLoadingFile(false);
              });
            });
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
          }
        } else {
          // 没有 currentFilePath 的情况（旧逻辑兼容）
          store.setProjectConfig(message.projectConfig || null);

          if (message.projectI18nCatalog) {
            const savedPreviewLocale = window.vscodeAPI?.getState?.()?.projectPreviewLocale;
            useDesignerStore.setState({
              projectI18nCatalog: message.projectI18nCatalog,
              previewLocale: message.projectI18nCatalog.locales?.includes(savedPreviewLocale)
                ? savedPreviewLocale
                : (message.previewLocale || message.projectI18nCatalog.defaultLocale),
            });
          }

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
            // 宿主推送的内容，components 变化不记为未保存改动
            applyHostComponents(() => store.setComponents(message.components));
            clearDesignerHistory();
            useDesignerStore.getState().resetDirty();
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

    case 'projectI18nCatalogSaved':
      if (message.projectI18nCatalog) {
        // 不调用 setPreviewLocale：它会再次触发保存，和这条"保存已完成"的回显消息形成死循环。
        // setProjectI18nCatalog 已经会从 catalog.activeLocale 同步 previewLocale。
        useDesignerStore.getState().setProjectI18nCatalog(message.projectI18nCatalog);
      }
      break;

    case 'projectI18nIndexLoaded': {
      const state = useDesignerStore.getState();
      const errors = message.error
        ? [{ filePath: '', message: message.error }]
        : (message.errors || []);
      state.setProjectI18nIndex(message.index, errors);
      break;
    }

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

    case 'navLayoutLoaded':
      // 导航图持久化布局回推（T7：打开弹窗时请求）
      useDesignerStore.setState({ navLayout: message.layout || {} });
      break;

    case 'navLayoutSaveFailed':
      // 布局写入失败，不阻塞交互，仅提示（T7）；具体文案由 ViewRelationModal 走 t() 渲染
      useDesignerStore.setState({
        navLayoutSaveError: message.error ? String(message.error) : '',
      });
      break;

    case 'navLayoutSaved':
      // 布局写入成功回执：清除之前的失败横幅（若有）
      useDesignerStore.setState({ navLayoutSaveError: null });
      break;

    case 'viewControlsLoaded':
      // getViewControls 回执（T9，UI 用在 T11）
      useDesignerStore.setState({
        viewControls: message.controls || [],
        viewControlsForKey: message.viewKey ?? null,
        viewControlsError: message.error ? String(message.error) : null,
      });
      break;

    case 'navEditResult': {
      // 导航写事务回执（T11）：requestId 由 ViewRelationModal 生成并校验匹配；
      // 成功时宿主已另行重扫并回推 updateAllViews 刷新图。
      // 判别联合回执（评审 I5）：errorCode 为 NavEditErrorCode、字段与服务端 NavEditResult 一致。
      const result = message as NavEditResultMessage;
      useDesignerStore.setState({
        navEditPending: false,
        navEditResult: {
          requestId: result.requestId,
          success: result.success === true,
          op: result.op,
          needsConfirm: result.needsConfirm,
          confirmReasons: result.confirmReasons,
          confirmDetail: result.confirmDetail,
          errorCode: result.errorCode,
          errorDetail: result.errorDetail,
          usedFileHistory: result.usedFileHistory,
          panelResyncFailed: result.panelResyncFailed,
          hintKey: result.hintKey,
        },
        ...(typeof result.undoCount === 'number' ? { navUndoCount: result.undoCount } : {}),
      });
      break;
    }

    case 'navUndoState':
      // 可撤销导航编辑条数（弹窗打开时查询回推）
      useDesignerStore.setState({ navUndoCount: typeof message.count === 'number' ? message.count : 0 });
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

    case 'projectConfigsLoaded':
      // 加载可选工程配置列表及当前激活配置
      {
        const store = useDesignerStore.getState();
        store.setProjectConfigs({
          configs: Array.isArray(message.configs) ? message.configs : [],
          active: message.active ?? null,
        });
      }
      break;


    case 'hmlSaved':
      // 宿主保存成功回执：本地脏标记已在发出 save 消息时乐观复位
      // （markSaveRequested，H4），这里不得再无条件清零——保存窗口内的
      // 新编辑已把 isDirty 置回 true 并上报宿主（seq 递增），此时清零会
      // 让本地漏报后续 dirty。宿主侧缓存由 handleSave 按 dirty 序号清除
      break;

    case 'hmlSaveFailed':
      // 宿主保存失败回执：磁盘没有落下我们要保存的内容，把乐观复位的
      // 本地脏标记置回（markDirty 兼发 dirtyStateChanged(true) 同步宿主；
      // 已因保存期间新编辑为 true 时是幂等 no-op）（H4）
      useDesignerStore.getState().markDirty();
      break;
  }
}

/**
 * 与宿主的连接：发送 ready 握手、接收宿主消息、把全局错误转发到宿主输出通道。
 * 只在挂载时注册一次，ui 取挂载时的值（与拆分前的闭包行为一致）。
 */
export function useHostMessages(ui: HostMessageUi): void {
  const setVSCodeAPI = useDesignerStore(state => state.setVSCodeAPI);
  const setComponents = useDesignerStore(state => state.setComponents);

  useEffect(() => {
    let readySent = false;
    
    // 添加错误处理；同时转发到宿主输出通道（Output → HoneyGUI），
    // 用户遇到前端问题可直接复制日志，不必截图（同一错误 2 秒内去重）
    let lastForwarded = '';
    let lastForwardedAt = 0;
    const forwardToHost = (message: string) => {
      const now = Date.now();
      if (message === lastForwarded && now - lastForwardedAt < 2000) {
        return;
      }
      lastForwarded = message;
      lastForwardedAt = now;
      window.vscodeAPI?.postMessage({ command: 'webviewLog', level: 'error', message });
    };

    const handleGlobalError = (e: ErrorEvent) => {
      console.error('[HoneyDesigner] Global error:', e.error);
      forwardToHost(`Global error: ${e.error?.message || e.message || 'Unknown error'}\n${e.error?.stack || ''}`);
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c62828;color:white;padding:10px;z-index:9999;font-family:monospace;font-size:12px;white-space:pre-wrap;';
      errorDiv.textContent = t('Error') + ': ' + (e.error?.message || 'Unknown error') + '\n' + (e.error?.stack || 'No stack trace');
      document.body.appendChild(errorDiv);
    };

    const handleUnhandledRejection = (e: PromiseRejectionEvent) => {
      console.error('[HoneyDesigner] Unhandled promise rejection:', e.reason);
      const reason = e.reason instanceof Error ? `${e.reason.message}\n${e.reason.stack || ''}` : String(e.reason);
      forwardToHost(`Unhandled promise rejection: ${reason}`);
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
      const readyDispatchedAt = performance.now();
      const perf = window.__honeyguiPerf;
      const resourceEntry = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .find(entry => entry.name.endsWith('.js'));
      window.vscodeAPI.postMessage({
        command: 'ready',
        webviewMetrics: perf ? {
          webviewResourceLoadMs: resourceEntry ? resourceEntry.responseEnd : readyDispatchedAt,
          webviewScriptLoadMs: perf.scriptStartedAt !== undefined && resourceEntry
            ? Math.max(0, resourceEntry.responseEnd - perf.scriptStartedAt)
            : 0,
          webviewScriptEvaluateMs: perf.scriptEvaluatedAt !== undefined && resourceEntry
            ? Math.max(0, perf.scriptEvaluatedAt - resourceEntry.responseEnd)
            : 0,
          webviewReactMountMs: perf.reactRenderStartedAt !== undefined
            ? Math.max(0, readyDispatchedAt - perf.reactRenderStartedAt)
            : 0,
          webviewReadyDispatchMs: Math.max(0, readyDispatchedAt - perf.htmlStartedAt),
        } : undefined,
      });
      readySent = true;
    }

    // Listen for messages from extension
    const handleHostMessage = (event: MessageEvent) => dispatchHostMessage(event.data, ui);
    window.addEventListener('message', handleHostMessage);

    // 添加错误监听器
    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // 检查React是否渲染成功
    setTimeout(() => {
      if (!document.getElementById('root')?.hasChildNodes()) {
        console.error('[HoneyDesigner] React app did not render!');
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#c62828;color:white;padding:20px;border-radius:4px;font-family:monospace;';
        errorDiv.innerHTML = `<h3>${t('React App not rendered')}</h3><p>${t('Please check console for error details')}</p>`;
        document.body.appendChild(errorDiv);
      }
    }, 2000);

    // 清理函数
    return () => {
      window.removeEventListener('message', handleHostMessage);
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [setVSCodeAPI, setComponents]);
}
