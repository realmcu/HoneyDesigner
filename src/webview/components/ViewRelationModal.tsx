import React, { useMemo, useRef, useState, useEffect } from 'react';
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

// 基于方向的智能布局
const layoutNodes = (views: ViewInfo[], edges: ViewEdge[], currentFile: string): ViewNode[] => {
  const nodeWidth = 140;
  const nodeHeight = 56;
  const spacingX = 200;
  const spacingY = 120;
  
  if (views.length === 0) return [];

  // 按文件分组
  const fileGroups = new Map<string, ViewInfo[]>();
  views.forEach(v => {
    const list = fileGroups.get(v.file) || [];
    list.push(v);
    fileGroups.set(v.file, list);
  });

  const nodes: ViewNode[] = [];
  let groupX = 80;

  // 当前文件优先显示在左侧
  const sortedFiles = Array.from(fileGroups.keys()).sort((a, b) => {
    if (a === currentFile) return -1;
    if (b === currentFile) return 1;
    return a.localeCompare(b);
  });

  sortedFiles.forEach(file => {
    const groupViews = fileGroups.get(file) || [];
    groupViews.forEach((v, i) => {
      nodes.push({
        id: v.id,
        name: v.name,
        file: v.file,
        x: groupX,
        y: 80 + i * spacingY,
        width: nodeWidth,
        height: nodeHeight,
        isCurrentFile: v.file === currentFile,
      });
    });
    groupX += spacingX;
  });

  // 力导向微调
  const iterations = 30;
  for (let iter = 0; iter < iterations; iter++) {
    const forces: Record<string, { fx: number; fy: number }> = {};
    nodes.forEach(n => forces[n.id] = { fx: 0, fy: 0 });

    // 节点间斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 50);
        if (dist < 180) {
          const force = 2000 / (dist * dist);
          forces[nodes[i].id].fx -= (dx / dist) * force;
          forces[nodes[i].id].fy -= (dy / dist) * force;
          forces[nodes[j].id].fx += (dx / dist) * force;
          forces[nodes[j].id].fy += (dy / dist) * force;
        }
      }
    }

    // 边的引力
    edges.forEach(edge => {
      const from = nodes.find(n => n.id === edge.from);
      const to = nodes.find(n => n.id === edge.to);
      if (from && to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        forces[from.id].fx += dx * 0.02;
        forces[from.id].fy += dy * 0.02;
        forces[to.id].fx -= dx * 0.02;
        forces[to.id].fy -= dy * 0.02;
      }
    });

    nodes.forEach(n => {
      n.x += forces[n.id].fx * 0.1;
      n.y += forces[n.id].fy * 0.1;
      n.x = Math.max(40, n.x);
      n.y = Math.max(40, n.y);
    });
  }

  return nodes;
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

  const nodes = useMemo(() => layoutNodes(views, edges, currentFile), [views, edges, currentFile]);

  // 自动适应视图
  useEffect(() => {
    if (visible && nodes.length > 0 && containerRef.current) {
      const container = containerRef.current;
      const maxX = Math.max(...nodes.map(n => n.x + n.width)) + 80;
      const maxY = Math.max(...nodes.map(n => n.y + n.height)) + 80;
      const scaleX = container.clientWidth / maxX;
      const scaleY = container.clientHeight / maxY;
      const newZoom = Math.min(scaleX, scaleY, 1) * 0.9;
      setZoom(newZoom);
      setPan({ x: 20, y: 20 });
    }
  }, [visible, nodes]);

  const handleReset = () => {
    setZoom(1);
    setPan({ x: 20, y: 20 });
  };

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
    setZoom(z => Math.max(0.3, Math.min(2, z * (e.deltaY > 0 ? 0.9 : 1.1))));
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
            <button onClick={() => setZoom(z => Math.min(2, z * 1.2))} title={t('Zoom In')}><ZoomIn size={16} /></button>
            <span className="vrm-zoom">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.max(0.3, z / 1.2))} title={t('Zoom Out')}><ZoomOut size={16} /></button>
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
