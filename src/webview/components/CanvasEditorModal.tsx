import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as fabric from 'fabric';
import { t } from '../i18n';
import { NumberInput } from './NumberInput';
import './CanvasEditorModal.css';

interface CanvasEditorModalProps {
  isOpen: boolean;
  initialSvg: string;
  onSave: (svgContent: string) => void;
  onClose: () => void;
}

type EditorMode = 'text' | 'designer';
type DrawingTool = 'select' | 'rect' | 'circle' | 'line' | 'path' | 'text' | 'triangle' | 'polygon';
type GradientType = 'none' | 'linear' | 'radial';

/**
 * Canvas SVG 编辑器弹窗
 * 支持 SVG 文本编辑和 Fabric.js 设计器两种模式
 */
export const CanvasEditorModal: React.FC<CanvasEditorModalProps> = ({
  isOpen,
  initialSvg,
  onSave,
  onClose,
}) => {
  const [mode, setMode] = useState<EditorMode>('text');
  const [svgContent, setSvgContent] = useState(initialSvg);
  const [position, setPosition] = useState({ x: 100, y: 50 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  // Fabric.js 状态
  const [fabricCanvas, setFabricCanvas] = useState<any>(null);
  const [currentTool, setCurrentTool] = useState<DrawingTool>('select');
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [fillColor, setFillColor] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [gradientType, setGradientType] = useState<GradientType>('none');
  const [gradientColor1, setGradientColor1] = useState('#ffffff');
  const [gradientColor2, setGradientColor2] = useState('#000000');
  const [history, setHistory] = useState<string[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [strokeDashArray, setStrokeDashArray] = useState<number[]>([]);
  const [strokeLineCap, setStrokeLineCap] = useState<'butt' | 'round' | 'square'>('butt');
  const [opacity, setOpacity] = useState(1);
  
  const modalRef = useRef<HTMLDivElement>(null);
  const fabricCanvasRef = useRef<HTMLCanvasElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 初始化内容
  useEffect(() => {
    if (isOpen) {
      setSvgContent(initialSvg);
    } else {
      // 关闭时清理 Fabric.js
      if (fabricCanvas) {
        try {
          fabricCanvas.dispose();
        } catch (e) {
          // 忽略 dispose 错误（元素可能已被移除）
        }
        setFabricCanvas(null);
      }
    }
  }, [isOpen, initialSvg]);

  // 初始化 Fabric.js
  useEffect(() => {
    if (isOpen && mode === 'designer' && fabricCanvasRef.current && !fabricCanvas) {
      // 延迟初始化，确保 DOM 已渲染
      const timer = setTimeout(() => {
        initFabricCanvas();
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen, mode, fabricCanvas]);

  const initFabricCanvas = () => {
    if (!fabricCanvasRef.current) return;
    
    const canvas: any = new fabric.Canvas(fabricCanvasRef.current, {
      width: size.width - 40,
      height: size.height - 180,
      backgroundColor: '#ffffff',
      selection: true,
    });

    // 如果有初始 SVG，加载它
    if (svgContent) {
      fabric.loadSVGFromString(svgContent).then((result: any) => {
        const objects = result.objects.filter((o: any): o is fabric.FabricObject => o !== null);
        if (objects.length > 0) {
          const group = fabric.util.groupSVGElements(objects, result.options);
          canvas.add(group);
          canvas.renderAll();
        }
      });
    }

    // 自由绘制模式
    canvas.isDrawingMode = false;
    if (canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = strokeColor;
      canvas.freeDrawingBrush.width = strokeWidth;
    }

    setFabricCanvas(canvas);
  };

  // 工具切换
  useEffect(() => {
    if (!fabricCanvas) return;

    fabricCanvas.isDrawingMode = currentTool === 'path';
    fabricCanvas.selection = currentTool === 'select';

    if (fabricCanvas.freeDrawingBrush) {
      fabricCanvas.freeDrawingBrush.color = strokeColor;
      fabricCanvas.freeDrawingBrush.width = strokeWidth;
    }
  }, [currentTool, fabricCanvas, strokeColor, strokeWidth]);

  // 键盘快捷键
  useEffect(() => {
    if (!fabricCanvas || !isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框，不处理快捷键
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const canvas = fabricCanvas;
      
      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const active = canvas.getActiveObjects();
        if (active.length > 0) {
          active.forEach((obj: any) => canvas.remove(obj));
          canvas.discardActiveObject();
          canvas.renderAll();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [fabricCanvas, isOpen]);

  // 添加图形
  const addShape = (tool: DrawingTool) => {
    if (!fabricCanvas) return;

    let shape: any;
    const centerX = fabricCanvas.width / 2;
    const centerY = fabricCanvas.height / 2;

    // 创建渐变
    const createGradient = (width: number, height: number) => {
      if (gradientType === 'none') return fillColor;
      
      if (gradientType === 'linear') {
        return new fabric.Gradient({
          type: 'linear',
          coords: { x1: 0, y1: 0, x2: width, y2: 0 },
          colorStops: [
            { offset: 0, color: gradientColor1 },
            { offset: 1, color: gradientColor2 }
          ]
        });
      } else {
        return new fabric.Gradient({
          type: 'radial',
          coords: { 
            x1: width / 2, y1: height / 2, r1: 0,
            x2: width / 2, y2: height / 2, r2: Math.max(width, height) / 2
          },
          colorStops: [
            { offset: 0, color: gradientColor1 },
            { offset: 1, color: gradientColor2 }
          ]
        });
      }
    };

    const commonProps = {
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      strokeDashArray: strokeDashArray,
      strokeLineCap: strokeLineCap,
      opacity: opacity,
    };

    switch (tool) {
      case 'rect':
        shape = new fabric.Rect({
          left: centerX - 50,
          top: centerY - 30,
          width: 100,
          height: 60,
          fill: createGradient(100, 60),
          ...commonProps,
        });
        break;
      case 'circle':
        shape = new fabric.Circle({
          left: centerX - 40,
          top: centerY - 40,
          radius: 40,
          fill: createGradient(80, 80),
          ...commonProps,
        });
        break;
      case 'triangle':
        shape = new fabric.Triangle({
          left: centerX - 40,
          top: centerY - 40,
          width: 80,
          height: 80,
          fill: createGradient(80, 80),
          ...commonProps,
        });
        break;
      case 'polygon':
        shape = new fabric.Polygon([
          { x: 0, y: -50 },
          { x: 50, y: -15 },
          { x: 30, y: 40 },
          { x: -30, y: 40 },
          { x: -50, y: -15 }
        ], {
          left: centerX - 50,
          top: centerY - 50,
          fill: createGradient(100, 100),
          ...commonProps,
        });
        break;
      case 'line':
        shape = new fabric.Line([centerX - 50, centerY, centerX + 50, centerY], {
          ...commonProps,
        });
        break;
      case 'text':
        shape = new fabric.IText('Text', {
          left: centerX - 30,
          top: centerY - 15,
          fill: fillColor,
          fontSize: 24,
          fontFamily: 'Arial',
        });
        break;
    }

    if (shape) {
      fabricCanvas.add(shape);
      fabricCanvas.setActiveObject(shape);
      fabricCanvas.renderAll();
    }
  };

  // 删除选中对象
  const deleteSelected = useCallback(() => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObjects();
    if (active.length > 0) {
      active.forEach((obj: any) => fabricCanvas.remove(obj));
      fabricCanvas.discardActiveObject();
      fabricCanvas.renderAll();
    }
  }, [fabricCanvas]);

  // 历史记录
  const saveHistory = useCallback(() => {
    if (!fabricCanvas) return;
    const json = JSON.stringify(fabricCanvas.toJSON());
    setHistory(prev => {
      const newHistory = prev.slice(0, historyStep + 1);
      newHistory.push(json);
      return newHistory.slice(-50); // 最多保存50步
    });
    setHistoryStep(prev => Math.min(prev + 1, 49));
  }, [fabricCanvas, historyStep]);

  // 撤销
  const undo = useCallback(() => {
    if (historyStep > 0 && fabricCanvas) {
      const newStep = historyStep - 1;
      fabricCanvas.loadFromJSON(history[newStep]).then(() => {
        fabricCanvas.renderAll();
        setHistoryStep(newStep);
      });
    }
  }, [fabricCanvas, history, historyStep]);

  // 重做
  const redo = useCallback(() => {
    if (historyStep < history.length - 1 && fabricCanvas) {
      const newStep = historyStep + 1;
      fabricCanvas.loadFromJSON(history[newStep]).then(() => {
        fabricCanvas.renderAll();
        setHistoryStep(newStep);
      });
    }
  }, [fabricCanvas, history, historyStep]);

  // 复制
  const copySelected = useCallback(() => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) {
      active.clone().then((cloned: any) => {
        (window as any)._clipboard = cloned;
      });
    }
  }, [fabricCanvas]);

  // 粘贴
  const pasteSelected = useCallback(() => {
    if (!fabricCanvas) return;
    const clipboard = (window as any)._clipboard;
    if (clipboard) {
      clipboard.clone().then((cloned: any) => {
        cloned.set({
          left: cloned.left + 10,
          top: cloned.top + 10,
        });
        fabricCanvas.add(cloned);
        fabricCanvas.setActiveObject(cloned);
        fabricCanvas.renderAll();
      });
    }
  }, [fabricCanvas]);

  // 复制
  const duplicateSelected = useCallback(() => {
    copySelected();
    setTimeout(() => pasteSelected(), 50);
  }, [copySelected, pasteSelected]);

  // 组合
  const groupSelected = useCallback(() => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObjects();
    if (active.length > 1) {
      const group = new fabric.Group(active);
      fabricCanvas.remove(...active);
      fabricCanvas.add(group);
      fabricCanvas.setActiveObject(group);
      fabricCanvas.renderAll();
    }
  }, [fabricCanvas]);

  // 取消组合
  const ungroupSelected = useCallback(() => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active && active.type === 'group') {
      const items = (active as any)._objects;
      (active as any)._restoreObjectsState();
      fabricCanvas.remove(active);
      items.forEach((item: any) => fabricCanvas.add(item));
      fabricCanvas.renderAll();
    }
  }, [fabricCanvas]);

  // 对齐
  const alignObjects = useCallback((alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObjects();
    if (active.length === 0) return;

    const bounds = {
      left: Math.min(...active.map((o: any) => o.left)),
      right: Math.max(...active.map((o: any) => o.left + o.width * o.scaleX)),
      top: Math.min(...active.map((o: any) => o.top)),
      bottom: Math.max(...active.map((o: any) => o.top + o.height * o.scaleY)),
    };

    active.forEach((obj: any) => {
      switch (alignment) {
        case 'left':
          obj.set({ left: bounds.left });
          break;
        case 'center':
          obj.set({ left: bounds.left + (bounds.right - bounds.left) / 2 - (obj.width * obj.scaleX) / 2 });
          break;
        case 'right':
          obj.set({ left: bounds.right - obj.width * obj.scaleX });
          break;
        case 'top':
          obj.set({ top: bounds.top });
          break;
        case 'middle':
          obj.set({ top: bounds.top + (bounds.bottom - bounds.top) / 2 - (obj.height * obj.scaleY) / 2 });
          break;
        case 'bottom':
          obj.set({ top: bounds.bottom - obj.height * obj.scaleY });
          break;
      }
      obj.setCoords();
    });
    fabricCanvas.renderAll();
  }, [fabricCanvas]);

  // 图层操作
  const bringToFront = useCallback(() => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) {
      fabricCanvas.bringToFront(active);
      fabricCanvas.renderAll();
    }
  }, [fabricCanvas]);

  const sendToBack = useCallback(() => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) {
      fabricCanvas.sendToBack(active);
      fabricCanvas.renderAll();
    }
  }, [fabricCanvas]);

  const bringForward = useCallback(() => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) {
      fabricCanvas.bringForward(active);
      fabricCanvas.renderAll();
    }
  }, [fabricCanvas]);

  const sendBackward = useCallback(() => {
    if (!fabricCanvas) return;
    const active = fabricCanvas.getActiveObject();
    if (active) {
      fabricCanvas.sendBackward(active);
      fabricCanvas.renderAll();
    }
  }, [fabricCanvas]);

  // 导入图片
  const importImage = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file && fabricCanvas) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const imgUrl = ev.target?.result as string;
          fabric.FabricImage.fromURL(imgUrl).then((img: any) => {
            img.scaleToWidth(200);
            fabricCanvas.add(img);
            fabricCanvas.renderAll();
          });
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, [fabricCanvas]);

  // 拖动逻辑
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('modal-header')) {
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
    }
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    }
    if (isResizing) {
      setSize({
        width: Math.max(500, e.clientX - position.x),
        height: Math.max(400, e.clientY - position.y),
      });
    }
  }, [isDragging, isResizing, dragOffset, position]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
    return undefined;
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  // 从 Fabric.js 获取 SVG
  const getSvgFromDesigner = useCallback((): string => {
    if (fabricCanvas) {
      return fabricCanvas.toSVG();
    }
    return svgContent;
  }, [fabricCanvas, svgContent]);

  // 保存
  const handleSave = useCallback(() => {
    let content = svgContent;
    if (mode === 'designer') {
      content = getSvgFromDesigner();
    }
    onSave(content);
    onClose();
  }, [mode, svgContent, getSvgFromDesigner, onSave, onClose]);

  // 从文件导入
  const handleImportFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svg';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const content = ev.target?.result as string;
          setSvgContent(content);
          // 如果在设计器模式，也加载到 canvas
          if (mode === 'designer' && fabricCanvas) {
            fabricCanvas.clear();
            fabric.loadSVGFromString(content).then((result: any) => {
              const objects = result.objects.filter((o: any): o is fabric.FabricObject => o !== null);
              if (objects.length > 0) {
                const group = fabric.util.groupSVGElements(objects, result.options);
                fabricCanvas.add(group);
                fabricCanvas.renderAll();
              }
            });
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }, [mode, fabricCanvas]);

  // 切换模式时同步内容
  const handleModeChange = useCallback((newMode: EditorMode) => {
    if (mode === 'designer' && newMode === 'text') {
      const content = getSvgFromDesigner();
      setSvgContent(content);
    } else if (mode === 'text' && newMode === 'designer' && fabricCanvas) {
      // 从文本加载到 canvas
      fabricCanvas.clear();
      if (svgContent) {
        fabric.loadSVGFromString(svgContent).then((result: any) => {
          const objects = result.objects.filter((o: any): o is fabric.FabricObject => o !== null);
          if (objects.length > 0) {
            const group = fabric.util.groupSVGElements(objects, result.options);
            fabricCanvas.add(group);
            fabricCanvas.renderAll();
          }
        });
      }
    }
    setMode(newMode);
  }, [mode, svgContent, fabricCanvas, getSvgFromDesigner]);

  if (!isOpen) return null;

  return (
    <div className="canvas-editor-overlay">
      <div
        ref={modalRef}
        className="canvas-editor-modal"
        style={{
          left: position.x,
          top: position.y,
          width: size.width,
          height: size.height,
        }}
      >
        {/* 标题栏 */}
        <div className="modal-header" onMouseDown={handleMouseDown}>
          <span className="modal-title">{t('canvasEditor.title')}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* 模式切换 Tab */}
        <div className="modal-tabs">
          <button
            className={`tab-btn ${mode === 'text' ? 'active' : ''}`}
            onClick={() => handleModeChange('text')}
          >
            {t('canvasEditor.textMode')}
          </button>
          <button
            className={`tab-btn ${mode === 'designer' ? 'active' : ''}`}
            onClick={() => handleModeChange('designer')}
          >
            {t('canvasEditor.designerMode')}
          </button>
        </div>

        {/* 编辑区域 */}
        <div className="modal-content">
          {mode === 'text' ? (
            <div className="text-editor">
              <textarea
                ref={textareaRef}
                className="svg-textarea"
                value={svgContent}
                onChange={(e) => setSvgContent(e.target.value)}
                placeholder={t('canvasEditor.placeholder')}
                spellCheck={false}
              />
              {/* SVG 预览 */}
              <div className="svg-preview">
                <div className="preview-label">{t('canvasEditor.preview')}</div>
                <div
                  className="preview-content"
                  dangerouslySetInnerHTML={{ __html: svgContent }}
                />
              </div>
            </div>
          ) : (
            <div className="designer-editor">
              {/* 工具栏 */}
              <div className="designer-toolbar">
                {/* 基础工具 */}
                <div className="toolbar-group">
                  <button
                    className={`tool-btn ${currentTool === 'select' ? 'active' : ''}`}
                    onClick={() => setCurrentTool('select')}
                    title={`${t('Select')} (V)`}
                  >
                    ↖
                  </button>
                  <button
                    className={`tool-btn ${currentTool === 'path' ? 'active' : ''}`}
                    onClick={() => setCurrentTool('path')}
                    title={`${t('Pen')} (P)`}
                  >
                    ✎
                  </button>
                </div>

                <div className="toolbar-separator" />

                {/* 形状工具 */}
                <div className="toolbar-group">
                  <button className="tool-btn" onClick={() => addShape('rect')} title={`${t('Rectangle')} (R)`}>▢</button>
                  <button className="tool-btn" onClick={() => addShape('circle')} title={`${t('Circle')} (C)`}>○</button>
                  <button className="tool-btn" onClick={() => addShape('triangle')} title={`${t('Triangle')} (T)`}>△</button>
                  <button className="tool-btn" onClick={() => addShape('polygon')} title={t('Polygon')}>⬟</button>
                  <button className="tool-btn" onClick={() => addShape('line')} title={`${t('Line')} (L)`}>╱</button>
                  <button className="tool-btn" onClick={() => addShape('text')} title={`${t('Text')} (T)`}>T</button>
                </div>

                <div className="toolbar-separator" />

                {/* 颜色工具 */}
                <div className="toolbar-group">
                  <label className="color-picker" title={t('Stroke Color')}>
                    <span>边</span>
                    <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
                  </label>
                  <label className="color-picker" title={t('Fill Color')}>
                    <span>填</span>
                    <input type="color" value={fillColor} onChange={(e) => setFillColor(e.target.value)} />
                  </label>
                  <label className="stroke-width" title={t('Line Width')}>
                    <span>宽</span>
                    <NumberInput min={1} max={20} integer emptyValue={1} value={strokeWidth} onChange={(v) => setStrokeWidth(v)} />
                  </label>
                  <label className="stroke-width" title={t('Opacity')}>
                    <span>透</span>
                    <NumberInput min={0} max={1} emptyValue={1} value={opacity} onChange={(v) => setOpacity(v)} />
                  </label>
                </div>

                <div className="toolbar-separator" />

                {/* 渐变工具 */}
                <div className="toolbar-group">
                  <select value={gradientType} onChange={(e) => setGradientType(e.target.value as GradientType)} title={t('Gradient Type')}>
                    <option value="none">{t('Solid Color')}</option>
                    <option value="linear">{t('Linear Gradient')}</option>
                    <option value="radial">{t('Radial Gradient')}</option>
                  </select>
                  {gradientType !== 'none' && (
                    <>
                      <input type="color" value={gradientColor1} onChange={(e) => setGradientColor1(e.target.value)} title={`${t('Gradient Type')} 1`} />
                      <input type="color" value={gradientColor2} onChange={(e) => setGradientColor2(e.target.value)} title={`${t('Gradient Type')} 2`} />
                    </>
                  )}
                </div>

                <div className="toolbar-separator" />

                {/* 线条样式 */}
                <div className="toolbar-group">
                  <select value={strokeLineCap} onChange={(e) => setStrokeLineCap(e.target.value as any)} title={t('Line Cap Style')}>
                    <option value="butt">{t('Butt')}</option>
                    <option value="round">{t('Round')}</option>
                    <option value="square">{t('Square')}</option>
                  </select>
                  <button className="tool-btn" onClick={() => setStrokeDashArray([])} title={t('Solid Line')}>━</button>
                  <button className="tool-btn" onClick={() => setStrokeDashArray([5, 5])} title={t('Dashed Line')}>┄</button>
                  <button className="tool-btn" onClick={() => setStrokeDashArray([1, 3])} title={t('Dotted Line')}>┈</button>
                </div>

                <div className="toolbar-separator" />

                {/* 编辑工具 */}
                <div className="toolbar-group">
                  <button className="tool-btn" onClick={undo} disabled={historyStep <= 0} title={`${t('Undo')} (Ctrl+Z)`}>↶</button>
                  <button className="tool-btn" onClick={redo} disabled={historyStep >= history.length - 1} title={`${t('Redo')} (Ctrl+Y)`}>↷</button>
                  <button className="tool-btn" onClick={copySelected} title={`${t('Copy')} (Ctrl+C)`}>📋</button>
                  <button className="tool-btn" onClick={pasteSelected} title={`${t('Paste')} (Ctrl+V)`}>📄</button>
                  <button className="tool-btn" onClick={duplicateSelected} title={`${t('Duplicate')} (Ctrl+D)`}>⎘</button>
                  <button className="tool-btn" onClick={deleteSelected} title={`${t('Delete')} (Del)`}>🗑</button>
                </div>

                <div className="toolbar-separator" />

                {/* 对齐工具 */}
                <div className="toolbar-group">
                  <button className="tool-btn" onClick={() => alignObjects('left')} title={t('Align Left')}>⫷</button>
                  <button className="tool-btn" onClick={() => alignObjects('center')} title={t('Align Center')}>⫼</button>
                  <button className="tool-btn" onClick={() => alignObjects('right')} title={t('Align Right')}>⫸</button>
                  <button className="tool-btn" onClick={() => alignObjects('top')} title={t('Align Top')}>⫴</button>
                  <button className="tool-btn" onClick={() => alignObjects('middle')} title={t('Vertical Center')}>⫽</button>
                  <button className="tool-btn" onClick={() => alignObjects('bottom')} title={t('Bottom Align')}>⫵</button>
                </div>

                <div className="toolbar-separator" />

                {/* 图层工具 */}
                <div className="toolbar-group">
                  <button className="tool-btn" onClick={bringToFront} title="置顶">⤒</button>
                  <button className="tool-btn" onClick={bringForward} title="上移">↑</button>
                  <button className="tool-btn" onClick={sendBackward} title="下移">↓</button>
                  <button className="tool-btn" onClick={sendToBack} title="置底">⤓</button>
                </div>

                <div className="toolbar-separator" />

                {/* 组合工具 */}
                <div className="toolbar-group">
                  <button className="tool-btn" onClick={groupSelected} title="组合 (Ctrl+G)">⊞</button>
                  <button className="tool-btn" onClick={ungroupSelected} title="取消组合 (Ctrl+Shift+G)">⊟</button>
                </div>

                <div className="toolbar-separator" />

                {/* 导入工具 */}
                <div className="toolbar-group">
                  <button className="tool-btn" onClick={importImage} title="导入图片">🖼</button>
                </div>
              </div>
              {/* Fabric.js Canvas */}
              <div className="fabric-container">
                <canvas ref={fabricCanvasRef} />
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="modal-footer">
          <button className="btn-import" onClick={handleImportFile}>
            {t('canvasEditor.importFile')}
          </button>
          <div className="footer-right">
            <button className="btn-cancel" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn-save" onClick={handleSave}>
              {t('common.confirm')}
            </button>
          </div>
        </div>

        {/* 调整大小手柄 */}
        <div
          className="resize-handle"
          onMouseDown={() => setIsResizing(true)}
        />
      </div>
    </div>
  );
};
