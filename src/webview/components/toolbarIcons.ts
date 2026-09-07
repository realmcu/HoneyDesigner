/**
 * 工具栏图标规格。
 *
 * 收敛到少量档位，避免同一排图标出现不同的视觉重量。新增图标时从下列档位中挑选，
 * 不要就地写 size / strokeWidth。
 *
 * 放在独立文件而不是从 Toolbar.tsx 导出：Toolbar 已经引入 ProjectConfigSelect 和
 * ProjectI18nLocaleSelect，反向引用会形成循环依赖。
 */

/** 工具栏行内主图标 */
export const ICON = { size: 16, strokeWidth: 1.5 } as const;

/** 下拉菜单项图标 */
export const ICON_MENU = { size: 15, strokeWidth: 1.5 } as const;

/** 徽标与控件内嵌的小图标 */
export const ICON_META = { size: 13, strokeWidth: 1.5 } as const;

/** 展开、折叠箭头 */
export const ICON_CARET = { size: 12, strokeWidth: 1.75 } as const;

/** 勾选标记 */
export const ICON_CHECK = { size: 12, strokeWidth: 2.5 } as const;
