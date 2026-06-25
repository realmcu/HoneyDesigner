import React from 'react';

interface HelpIconProps {
  title: string;
}

export const HelpIcon: React.FC<HelpIconProps> = ({ title }) => (
  <span
    title={title}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '14px',
      height: '14px',
      borderRadius: '50%',
      backgroundColor: 'var(--vscode-badge-background)',
      color: 'var(--vscode-badge-foreground)',
      fontSize: '10px',
      fontWeight: 'bold',
      cursor: 'help',
      userSelect: 'none',
      flexShrink: 0,
    }}
  >
    ?
  </span>
);
