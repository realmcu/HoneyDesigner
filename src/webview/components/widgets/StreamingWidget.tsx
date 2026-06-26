import React from 'react';
import { WidgetProps } from './types';

export const StreamingWidget: React.FC<WidgetProps> = ({ component, style, handlers }) => {
  const codec = (component.data?.codec as string) || 'jpeg';
  const transporter = (component.data?.transporter as string) || '';
  const updateInterval = (component.data?.updateInterval as number) ?? 40;

  return (
    <div key={component.id} style={style} {...handlers}>
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0d1117',
        border: '1px solid rgba(99, 179, 237, 0.3)',
        color: '#63b3ed',
        fontSize: '11px',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}>
        <div style={{ fontSize: '36px', marginBottom: '6px', lineHeight: 1 }}>📡</div>
        <div style={{ fontWeight: 600, marginBottom: '4px' }}>Streaming</div>
        <div style={{
          display: 'flex',
          gap: '4px',
          alignItems: 'center',
          background: 'rgba(99, 179, 237, 0.15)',
          padding: '2px 6px',
          borderRadius: '10px',
          fontSize: '10px',
          marginBottom: '2px',
        }}>
          <span style={{ color: '#f6ad55' }}>{codec.toUpperCase()}</span>
          <span style={{ color: '#718096' }}>·</span>
          <span>{updateInterval}ms</span>
        </div>
        {transporter && (
          <div style={{
            fontSize: '10px',
            color: '#a0aec0',
            maxWidth: '90%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {transporter}
          </div>
        )}
        {!transporter && (
          <div style={{ fontSize: '10px', color: '#4a5568' }}>设置 transporter 变量</div>
        )}
      </div>
    </div>
  );
};
