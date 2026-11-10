/**
 * Keyboard Shortcuts Handler
 * Manages all keyboard shortcuts for the designer
 */

import { useEffect } from 'react';
import { useDesignerStore } from '../store';
import { t } from '../i18n';

export const useKeyboardShortcuts = () => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框、文本域或可编辑元素中，不处理快捷键
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // 直接从 store 获取最新状态，避免闭包问题
      const { 
        selectedComponent, 
        selectedComponents,
        removeComponent, 
        duplicateComponent, 
        components,
        copyComponent,
        cutComponent,
        copySelectedComponents,
        cutSelectedComponents,
        pasteComponent,
        alignSelectedComponents,
        distributeSelectedComponents
      } = useDesignerStore.getState();

      const isModKey = e.ctrlKey || e.metaKey; // Ctrl on Windows/Linux, Command on Mac
      const isShift = e.shiftKey;
      const isAlt = e.altKey;

      // Prevent default behavior for our shortcuts
      let handled = true;

      switch (e.key) {
        // Save (Ctrl+S)
        case 's':
        case 'S':
          if (isModKey) {
            e.preventDefault();
            window.vscodeAPI?.postMessage({
              command: 'save',
              content: {},
            });
            // 乐观复位本地脏标记：保存窗口内的新编辑才能再次上报 dirty（H4）
            useDesignerStore.getState().markSaveRequested();
          }
          break;

        // Undo (Ctrl+Z) / Redo (Ctrl+Shift+Z)：撤销历史由 webview store 按文件维护
        case 'z':
        case 'Z':
          if (isModKey) {
            e.preventDefault();
            if (isShift) {
              useDesignerStore.getState().redo();
            } else {
              useDesignerStore.getState().undo();
            }
          }
          break;

        // Redo (Ctrl+Y)
        case 'y':
        case 'Y':
          if (isModKey) {
            e.preventDefault();
            useDesignerStore.getState().redo();
          }
          break;

        // Delete (Delete key only, Backspace is reserved for text input)
        // 设计器内唯一的 Delete 键删除入口，删除可通过 Ctrl+Z 撤销
        case 'Delete': {
          if (e.repeat) break;
          e.preventDefault();

          const ids = selectedComponents.length > 0
            ? selectedComponents
            : (selectedComponent ? [selectedComponent] : []);
          if (ids.length === 0) break;

          // 列表项由父列表的数量属性管理，不允许直接删除
          const deletableIds = ids.filter(id => components.find(c => c.id === id)?.type !== 'hg_list_item');
          if (deletableIds.length < ids.length) {
            window.vscodeAPI?.postMessage({
              command: 'showInfo',
              text: t('List items are managed by the parent list; adjust its Item Count property')
            });
          }
          if (deletableIds.length === 0) break;

          if (deletableIds.length > 1) {
            useDesignerStore.getState().removeComponents(deletableIds);
          } else {
            removeComponent(deletableIds[0]);
          }
          // 主视图/入口视图会被 store 拒绝删除，只清掉确实已删除的选中项
          const remaining = new Set(useDesignerStore.getState().components.map(c => c.id));
          if (ids.some(id => !remaining.has(id))) {
            useDesignerStore.getState().setSelectedComponents(ids.filter(id => remaining.has(id)));
          }
          break;
        }

        // Copy (Ctrl+C)
        case 'c':
        case 'C':
          if (isModKey) {
            e.preventDefault();
            if (selectedComponents.length > 1) {
              copySelectedComponents();
            } else if (selectedComponent) {
              copyComponent(selectedComponent);
            }
          }
          break;

        // Cut (Ctrl+X)
        case 'x':
        case 'X':
          if (isModKey) {
            e.preventDefault();
            if (selectedComponents.length > 1) {
              cutSelectedComponents();
            } else if (selectedComponent) {
              cutComponent(selectedComponent);
            }
          }
          break;

        // Paste (Ctrl+V)
        case 'v':
        case 'V':
          if (isModKey && !e.repeat) {
            e.preventDefault();
            pasteComponent();
          }
          break;

        // Ctrl+Shift+D: 水平分布；Ctrl+Alt+D: 垂直分布；Ctrl+D: 复制
        // 带修饰键的分支必须先判断，否则会被 Ctrl+D 吞掉
        case 'd':
        case 'D':
          if (!isModKey || e.repeat) break;
          e.preventDefault();
          if (isShift) {
            if (selectedComponents.length >= 3) distributeSelectedComponents('horizontal');
          } else if (isAlt) {
            if (selectedComponents.length >= 3) distributeSelectedComponents('vertical');
          } else if (selectedComponent) {
            duplicateComponent(selectedComponent);
          }
          break;

        // Alignment shortcuts (Ctrl+Shift+L/R/T/B/H/V)
        case 'l':
        case 'L':
          if (isModKey && isShift && selectedComponents.length >= 2) {
            e.preventDefault();
            alignSelectedComponents('left');
          }
          break;

        case 'r':
        case 'R':
          if (isModKey && isShift && selectedComponents.length >= 2) {
            e.preventDefault();
            alignSelectedComponents('right');
          }
          break;

        case 't':
        case 'T':
          if (isModKey && isShift && selectedComponents.length >= 2) {
            e.preventDefault();
            alignSelectedComponents('top');
          }
          break;

        case 'b':
        case 'B':
          if (isModKey && isShift && selectedComponents.length >= 2) {
            e.preventDefault();
            alignSelectedComponents('bottom');
          }
          break;

        case 'h':
        case 'H':
          if (isModKey && isShift && selectedComponents.length >= 2) {
            e.preventDefault();
            alignSelectedComponents('centerH');
          }
          break;

        // Generate Code (Ctrl+G)
        case 'g':
        case 'G':
          if (isModKey) {
            e.preventDefault();
            window.vscodeAPI?.postMessage({
              command: 'codegen',
              language: 'cpp',
              content: {},
            });
          }
          break;

        // Preview (F5)
        case 'F5':
          e.preventDefault();
          window.vscodeAPI?.postMessage({
            command: 'preview',
            content: {},
          });
          break;

        // Escape (Deselect)
        case 'Escape':
          e.preventDefault();
          useDesignerStore.getState().selectComponent(null);
          break;

        default:
          handled = false;
          break;
      }

      if (handled) {
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []); // 空依赖数组，只注册一次事件监听器
};

export default useKeyboardShortcuts;
