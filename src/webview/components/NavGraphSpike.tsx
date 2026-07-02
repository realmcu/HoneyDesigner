import React from 'react';
import { ReactFlow, MiniMap, Controls, Background, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// T1 spike: 验证 @xyflow/react 能进现有 webview 构建链
// （React 19 兼容 / CSS 经 css-loader+MiniCssExtractPlugin 正常注入 / CSP 不拦 / webpack 单包构建通过）
// T3 用真实节点图重写 ViewRelationModal 时移除此文件及其挂载点。

const spikeNodes: Node[] = [
  { id: '1', position: { x: 0, y: 0 }, data: { label: 'View A' } },
  { id: '2', position: { x: 200, y: 100 }, data: { label: 'View B' } },
  { id: '3', position: { x: 0, y: 200 }, data: { label: 'View C' } },
];

const spikeEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2' },
  { id: 'e2-3', source: '2', target: '3' },
];

export const NavGraphSpike: React.FC = () => {
  return (
    <div style={{ width: '100%', height: 300, border: '1px solid var(--vscode-panel-border, #444)' }}>
      <ReactFlow nodes={spikeNodes} edges={spikeEdges} fitView>
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
};
