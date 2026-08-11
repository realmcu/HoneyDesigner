import React from 'react';

interface DeferredMountProps {
  /** 是否已经可以加载（通常是"用户第一次访问该区域"） */
  activate: boolean;
  /** 加载期间显示的占位内容 */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * 延迟挂载重型子树，并在挂载后保持常驻。
 *
 * 用途：面板通过 `display:none` 隐藏而非卸载，以保留内部状态（滚动位置、
 * 展开状态等）。但把重型依赖（three.js、fabric 等）静态打进主 bundle 会拖慢
 * webview 启动。本组件让这类子树在首次被访问时才加载对应 chunk，
 * 之后不再卸载 —— 与原先"始终挂载"的行为保持一致。
 */
export const DeferredMount: React.FC<DeferredMountProps> = ({ activate, fallback = null, children }) => {
  // 一旦激活过就保持为 true，避免切走 Tab 时卸载子树丢失状态
  const [hasActivated, setHasActivated] = React.useState(activate);

  React.useEffect(() => {
    if (activate) {
      setHasActivated(true);
    }
  }, [activate]);

  if (!hasActivated) {
    return null;
  }

  return <React.Suspense fallback={fallback}>{children}</React.Suspense>;
};

export default DeferredMount;
