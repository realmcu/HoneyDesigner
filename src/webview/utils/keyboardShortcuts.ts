/**
 * Keyboard Shortcuts Handler
 * Manages all keyboard shortcuts for the designer
 */

import { useEffect } from 'react';
import { useDesignerStore } from '../store';

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

        // Undo (Ctrl+Z)
        case 'z':
        case 'Z':
          if (isModKey && !isShift) {
            e.preventDefault();
            window.vscodeAPI?.postMessage({ command: 'undo' });
          }
          // Redo (Ctrl+Shift+Z)
          else if (isModKey && isShift) {
            e.preventDefault();
            window.vscodeAPI?.postMessage({ command: 'redo' });
          }
          break;

        // Redo (Ctrl+Y)
        case 'y':
        case 'Y':
          if (isModKey) {
            e.preventDefault();
            window.vscodeAPI?.postMessage({ command: 'redo' });
          }
          break;

        // Delete (Delete key only, Backspace is reserved for text input)
        case 'Delete':
          if (e.repeat) break;
          e.preventDefault();
          
          // 多选删除
          if (selectedComponents.length > 1) {
            const { removeComponents } = useDesignerStore.getState();
            console.log('[键盘快捷键] 批量删除组件:', selectedComponents);
            removeComponents(selectedComponents);
          }
          // 单选删除
          else if (selectedComponent) {
            const component = components.find(c => c.id === selectedComponent);
            
            // 禁止删除列表项
            if (component?.type === 'hg_list_item') {
              console.log('[键盘快捷键] 禁止删除列表项');
              // 发送提示消息
              if (window.vscodeAPI) {
                window.vscodeAPI.postMessage({
                  command: 'showInfo',
                  text: '列表项由父列表自动管理，请调整父列表的"项数量"属性'
                });
              }
              return;
            }
            
            console.log('[键盘快捷键] 删除组件:', selectedComponent);
            removeComponent(selectedComponent);
          }
          break;

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

        // Duplicate (Ctrl+D)
        case 'd':
        case 'D':
          if (isModKey && !e.repeat) {
            e.preventDefault();
            if (selectedComponent) {
              duplicateComponent(selectedComponent);
            }
          }
          // Ctrl+Shift+D: 水平分布
          else if (isModKey && isShift && selectedComponents.length >= 3) {
            e.preventDefault();
            distributeSelectedComponents('horizontal');
          }
          // Ctrl+Alt+D: 垂直分布
          else if (isModKey && isAlt && selectedComponents.length >= 3) {
            e.preventDefault();
            distributeSelectedComponents('vertical');
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
