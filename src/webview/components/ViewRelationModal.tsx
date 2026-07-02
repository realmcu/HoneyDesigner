import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { useDesignerStore } from '../store';
import { t } from '../i18n';
import type { ViewInfo } from '../types';
import './ViewRelationModal.css';

interface ViewRelationModalProps {
  visible: boolean;
  onClose: () => void;
}

interface ViewNode {
  id: string;
  name: string;
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isCurrentFile: boolean;
}

interface ViewEdge {
  id: string;
  from: string;
  to: string;
  event: string;
  isValid: boolean;
}

const eventTypeToLabel: Record<string, string> = {
  'onSwipeLeft': '←',
  'onSwipeRight': '→',
  'onSwipeUp': '↑',
  'onSwipeDown': '↓',
  'onSwipeLeftQuick': '⇠',
  'onSwipeRightQuick': '⇢',
  'onSwipeUpQuick': '⇡',
  'onSwipeDownQuick': '⇣',
  'onClick': 'Click',
};

// 紧凑网格布局：按文件分组 + 近似正方形排布
// 说明：早期版本让"每个文件占一列"，当项目里有几十个各含 1~2 个 view 的
// 文件时会退化成一条超宽的横排（宽度 = 文件数 × 列距），自动缩放只能压到
// 个位数百分比、全部糊成一条线。这里改成全局网格：先按 (当前文件优先, 文件名)
// 排序让同文件的 view 相邻聚拢，再按 ≈√n 的列数铺成接近正方形的二维网格，
// 无论 view / 文件如何分布都能保持紧凑可读。
const layoutNodes = (views: ViewInfo[], currentFile: string): ViewNode[] => {
  const nodeWidth = 140;
  const nodeHeight = 56;
  const gapX = 64;   // 列间距（除节点宽度外的空隙）
  const gapY = 60;   // 行间距（除节点高度外的空隙）
  const cellW = nodeWidth + gapX;
  const cellH = nodeHeight + gapY;
  const margin = 40;

  if (views.length === 0) return [];

  // 当前文件优先，其次按文件名分组，使同文件 view 在网格中连续相邻
  const ordered = [...views].sort((a, b) => {
    const aCur = a.file === currentFile;
    const bCur = b.file === currentFile;
    if (aCur !== bCur) return aCur ? -1 : 1;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.name.localeCompare(b.name);
  });

  const n = ordered.length;
  // 网格宽高比略偏横向，贴合弹窗画布（宽 > 高）
  const cols = Math.max(1, Math.round(Math.sqrt(n * 1.6)));

  return ordered.map((v, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      id: v.id,
      name: v.name,
      file: v.file,
      x: margin + col * cellW,
      y: margin + row * cellH,
      width: nodeWidth,
      height: nodeHeight,
      isCurrentFile: v.file === currentFile,
    };
  });
};

export const ViewRelationModal: React.FC<ViewRelationModalProps> = ({ visible, onClose }) => {
  const { allViews, currentFilePath } = useDesignerStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // 获取当前文件所属的设计目录名
  const currentFile = useMemo(() => {
    if (!currentFilePath) return '';
    const match = currentFilePath.match(/ui[\/\\]([^\/\\]+)[\/\\]/);
    return match ? match[1] : '';
  }, [currentFilePath]);

  const { views, edges } = useMemo(() => {
    const views = allViews || [];
    const edges: ViewEdge[] = [];
    const viewIds = new Set(views.map(v => v.id));
    
    views.forEach((view, viewIdx) => {
      if (view.edges) {
        view.edges.forEach((edge, edgeIdx) => {
          if (edge.target && view.id !== edge.target) {
            edges.push({
              id: `${view.id}-${edge.target}-${viewIdx}-${edgeIdx}`,
              from: view.id,
              to: edge.target,
              event: eventTypeToLabel[edge.event] || edge.event,
              isValid: viewIds.has(edge.target),
            });
          }
        });
      }
    });
    
    return { views, edges };
  }, [allViews]);

  const nodes = useMemo(() => layoutNodes(views, currentFile), [views, currentFile]);

  // 缩放边界
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 2.5;

  // 适应窗口：把整张图居中并缩放到刚好放进画布
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container || nodes.length === 0) return;
    const minX = Math.min(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    const maxX = Math.max(...nodes.map(n => n.x + n.width));
    const maxY = Math.max(...nodes.map(n => n.y + n.height));
    const graphW = maxX - minX || 1;
    const graphH = maxY - minY || 1;
    const pad = 32;
    const scaleX = (container.clientWidth - pad * 2) / graphW;
    const scaleY = (container.clientHeight - pad * 2) / graphH;
    const newZoom = Math.max(MIN_ZOOM, Math.min(scaleX, scaleY, 1.2));
    setZoom(newZoom);
    setPan({
      x: (container.clientWidth - graphW * newZoom) / 2 - minX * newZoom,
      y: (container.clientHeight - graphH * newZoom) / 2 - minY * newZoom,
    });
  }, [nodes]);

  // 打开或数据变化时自动适应
  useEffect(() => {
    if (visible && nodes.length > 0) {
      fitToView();
    }
  }, [visible, nodes, fitToView]);

  const handleReset = fitToView;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };

  const handleMouseUp = () => setIsPanning(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * (e.deltaY > 0 ? 0.9 : 1.1))));
  };

  if (!visible) return null;

  const getEdgePath = (fromNode: ViewNode, toNode: ViewNode) => {
    // 中心点
    const fromCx = fromNode.x + fromNode.width / 2;
    const fromCy = fromNode.y + fromNode.height / 2;
    const toCx = toNode.x + toNode.width / 2;
    const toCy = toNode.y + toNode.height / 2;
    
    // 中心到中心的方向
    const dx = toCx - fromCx;
    const dy = toCy - fromCy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    
    // 计算源矩形边缘交点
    let t1 = Infinity;
    const hw1 = fromNode.width / 2, hh1 = fromNode.height / 2;
    if (ux > 0) t1 = Math.min(t1, hw1 / ux);
    if (ux < 0) t1 = Math.min(t1, -hw1 / ux);
    if (uy > 0) t1 = Math.min(t1, hh1 / uy);
    if (uy < 0) t1 = Math.min(t1, -hh1 / uy);
    const fromEdgeX = fromCx + ux * t1;
    const fromEdgeY = fromCy + uy * t1;
    
    // 计算目标矩形边缘交点
    let t2 = Infinity;
    const hw2 = toNode.width / 2, hh2 = toNode.height / 2;
    if (-ux > 0) t2 = Math.min(t2, hw2 / -ux);
    if (-ux < 0) t2 = Math.min(t2, -hw2 / -ux);
    if (-uy > 0) t2 = Math.min(t2, hh2 / -uy);
    if (-uy < 0) t2 = Math.min(t2, -hh2 / -uy);
    const toEdgeX = toCx - ux * (t2 + 8);  // 留出箭头空间
    const toEdgeY = toCy - uy * (t2 + 8);
    
    return { path: `M ${fromEdgeX} ${fromEdgeY} L ${toEdgeX} ${toEdgeY}` };
  };

  const isEdgeHighlighted = (edge: ViewEdge) => 
    hoveredNode && (edge.from === hoveredNode || edge.to === hoveredNode);

  return (
    <div className="vrm-overlay" onClick={onClose}>
      <div className="vrm-dialog" onClick={e => e.stopPropagation()}>
        <div className="vrm-header">
          <div className="vrm-title">
            <span className="vrm-icon">🔗</span>
            {t('View Navigation Relations')}
          </div>
          <div className="vrm-toolbar">
            <button onClick={() => setZoom(z => Math.min(MAX_ZOOM, z * 1.2))} title={t('Zoom In')}><ZoomIn size={16} /></button>
            <span className="vrm-zoom">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.max(MIN_ZOOM, z / 1.2))} title={t('Zoom Out')}><ZoomOut size={16} /></button>
            <button onClick={handleReset} title={t('Fit to window')}><Maximize2 size={16} /></button>
            <div className="vrm-divider" />
            <button className="vrm-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        
        <div 
          ref={containerRef}
          className="vrm-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
        >
          {views.length === 0 ? (
            <div className="vrm-empty">
              <div className="vrm-empty-icon">📭</div>
              <div>{t('No views')}</div>
            </div>
          ) : (
            <svg width="100%" height="100%">
              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                <defs>
                  <marker id="vrm-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#4CAF50" />
                  </marker>
                  <marker id="vrm-arrow-hl" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#2196F3" />
                  </marker>
                  <marker id="vrm-arrow-err" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#f44336" />
                  </marker>
                  <filter id="vrm-shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15"/>
                  </filter>
                </defs>
                
                {/* 边 */}
                {edges.map(edge => {
                  const fromNode = nodes.find(n => n.id === edge.from);
                  const toNode = nodes.find(n => n.id === edge.to);
                  if (!fromNode || !toNode) return null;
                  
                  const { path } = getEdgePath(fromNode, toNode);
                  const highlighted = isEdgeHighlighted(edge);
                  const color = !edge.isValid ? '#f44336' : highlighted ? '#2196F3' : '#4CAF50';
                  const marker = !edge.isValid ? 'url(#vrm-arrow-err)' : highlighted ? 'url(#vrm-arrow-hl)' : 'url(#vrm-arrow)';
                  
                  return (
                    <g key={edge.id} opacity={hoveredNode && !highlighted ? 0.3 : 1}>
                      <path d={path} fill="none" stroke={color} strokeWidth={highlighted ? 2.5 : 2} markerEnd={marker} />
                    </g>
                  );
                })}
                
                {/* 节点 */}
                {nodes.map(node => {
                  const isHovered = hoveredNode === node.id;
                  const dimmed = hoveredNode && !isHovered && !edges.some(e => 
                    (e.from === hoveredNode && e.to === node.id) || (e.to === hoveredNode && e.from === node.id)
                  );
                  
                  return (
                    <g 
                      key={node.id} 
                      opacity={dimmed ? 0.3 : 1}
                      onMouseEnter={() => setHoveredNode(node.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect
                        x={node.x}
                        y={node.y}
                        width={node.width}
                        height={node.height}
                        fill={node.isCurrentFile ? '#1a1a2e' : '#2d2d44'}
                        stroke={isHovered ? '#2196F3' : node.isCurrentFile ? '#4CAF50' : '#555'}
                        strokeWidth={isHovered ? 3 : node.isCurrentFile ? 2 : 1}
                        strokeDasharray={node.isCurrentFile ? '' : '4,2'}
                        rx={8}
                        filter="url(#vrm-shadow)"
                      />
                      {node.isCurrentFile && (
                        <text x={node.x + 10} y={node.y + 16} fill="#4CAF50" fontSize={11}>★</text>
                      )}
                      <text
                        x={node.x + node.width / 2}
                        y={node.y + node.height / 2 - 4}
                        fill="#fff"
                        fontSize={13}
                        fontWeight="600"
                        textAnchor="middle"
                      >
                        {node.name.length > 12 ? node.name.slice(0, 12) + '...' : node.name}
                      </text>
                      <text
                        x={node.x + node.width / 2}
                        y={node.y + node.height / 2 + 14}
                        fill="#888"
                        fontSize={10}
                        textAnchor="middle"
                      >
                        {node.file}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>
        
        <div className="vrm-footer">
          <div className="vrm-legend">
            <span className="vrm-legend-item"><span className="vrm-dot vrm-dot-current" />{t('Current file')}</span>
            <span className="vrm-legend-item"><span className="vrm-dot vrm-dot-other" />{t('Other files')}</span>
            <span className="vrm-legend-item"><span className="vrm-line vrm-line-valid" />{t('Valid connection')}</span>
            <span className="vrm-legend-item"><span className="vrm-line vrm-line-invalid" />{t('Invalid connection')}</span>
          </div>
          <div className="vrm-stats">
            {t('Views')} {views.length} · {t('Connections')} {edges.length}
          </div>
        </div>
      </div>
    </div>
  );
};
