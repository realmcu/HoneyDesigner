import React from 'react';
import {
  AppWindow as AppWindowIcon,
  Blend as BlendIcon,
  Box as BoxIcon,
  Circle as CircleIcon,
  CircleDot as CircleDotIcon,
  Clock as ClockIcon,
  Image as ImageIcon,
  ImagePlay as ImagePlayIcon,
  QrCode as QrCodeIcon,
  Radio as RadioIcon,
  RectangleHorizontal as RectangleHorizontalIcon,
  Rows3 as Rows3Icon,
  Smartphone as SmartphoneIcon,
  Spline as SplineIcon,
  SquareCheck as SquareCheckIcon,
  SquareDashed as SquareDashedIcon,
  SquarePen as SquarePenIcon,
  SquarePlay as SquarePlayIcon,
  TextCursorInput as TextCursorInputIcon,
  Timer as TimerIcon,
  ToggleLeft as ToggleLeftIcon,
  Type as TypeIcon,
} from 'lucide-react';

/**
 * 组件图标名。
 * 每个名字对应一个 lucide 图标，或本文件内的手绘图标（lucide 没有合适形状时）。
 */
export type ComponentIconName =
  | 'button'
  | 'label'
  | 'time-label'
  | 'timer-label'
  | 'input'
  | 'image'
  | 'checkbox'
  | 'radio'
  | 'switch'
  | 'progressbar'
  | 'slider'
  | 'view'
  | 'window'
  | 'canvas'
  | 'list'
  | 'list-item'
  | 'video'
  | 'streaming'
  | 'gif'
  | 'model-3d'
  | 'arc'
  | 'circle'
  | 'rect'
  | 'svg'
  | 'lottie'
  | 'glass'
  | 'particle'
  | 'menu-cellular'
  | 'qrcode'
  | 'dual-state'
  | 'opacity'
  | 'unknown';

interface IconProps {
  size?: number;
  className?: string;
}

type IconComponent = React.ComponentType<IconProps>;

/**
 * 手绘图标的公共 svg 属性。
 * 描边规范与 lucide 对齐（24 viewBox / stroke-width 2 / 圆头圆角连接），
 * 保证手绘图标与界面其余部分的 lucide 图标视觉重量一致。
 */
const svgProps = ({ size = 24, className }: IconProps) => ({
  xmlns: 'http://www.w3.org/2000/svg',
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
});

/** 按钮：圆角矩形 + 居中文本线。与 Rectangle 的空框靠「内部有内容」区分 */
const ButtonIcon: IconComponent = (props) => (
  <svg {...svgProps(props)}>
    <rect x="2" y="6" width="20" height="12" rx="4" />
    <path d="M8 12h8" />
  </svg>
);

/** 进度条：胶囊轨道 + 粗线表示已填充段 */
const ProgressBarIcon: IconComponent = (props) => (
  <svg {...svgProps(props)}>
    <rect x="2" y="8" width="20" height="8" rx="4" />
    <path d="M6 12h6" strokeWidth={4} />
  </svg>
);

/** 列表项：单个条目，与 List 的三条条目区分 */
const ListItemIcon: IconComponent = (props) => (
  <svg {...svgProps(props)}>
    <rect x="2" y="9" width="20" height="6" rx="2" />
  </svg>
);

/** 滑块：轨道 + 可拖动的圆形手柄（单个手柄，不是设置面板那种多条滑竿） */
const SliderIcon: IconComponent = (props) => (
  <svg {...svgProps(props)}>
    <path d="M3 12h5.5" />
    <path d="M15.5 12h5.5" />
    <circle cx="12" cy="12" r="3.5" />
  </svg>
);

/**
 * 粒子效果：左下角的发射器喷出圆形粒子，沿发射方向逐渐变小并扩散。
 * 对应组件本体是带发射器与物理运动的粒子管理器，默认绘制圆形粒子。
 */
const ParticleIcon: IconComponent = (props) => (
  <svg {...svgProps(props)} stroke="none" fill="currentColor">
    <circle cx="4.5" cy="19.5" r="2.5" />
    <circle cx="10" cy="14.5" r="1.8" />
    <circle cx="15.5" cy="9.5" r="1.4" />
    <circle cx="20" cy="5" r="1" />
    <circle cx="16" cy="16" r="1.2" />
    <circle cx="8.5" cy="7" r="1.1" />
  </svg>
);

/** 弧形：270° 弧带（组件 endAngle 默认值），弧带厚度即 strokeWidth 属性 */
const ArcIcon: IconComponent = (props) => (
  <svg {...svgProps(props)}>
    <path d="M12 4A8 8 0 1 1 4 12" strokeWidth={3} />
  </svg>
);

/**
 * 玻璃效果：玻璃面板 + 透过它看到的模糊内容（虚线圆）+ 一道边缘反光。
 * 虚线是单色描边里表达「背后内容被模糊」最直接的手法，对应 iOS 那种毛玻璃观感。
 */
const GlassIcon: IconComponent = (props) => (
  <svg {...svgProps(props)}>
    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
    <circle cx="12" cy="13.5" r="4" strokeDasharray="1.8 2.2" />
    <path d="M6.5 9.5 10 6" />
  </svg>
);

/**
 * 蜂窝菜单：圆形应用图标按蜂巢网格排布，中心大、外圈小，
 * 对应 Apple Watch 那种蜂窝应用列表，而不是单纯的六边形图形。
 */
const MenuCellularIcon: IconComponent = (props) => (
  <svg {...svgProps(props)} stroke="none" fill="currentColor">
    <circle cx="12" cy="12" r="3" />
    <circle cx="19" cy="12" r="2" />
    <circle cx="15.5" cy="5.94" r="2" />
    <circle cx="8.5" cy="5.94" r="2" />
    <circle cx="5" cy="12" r="2" />
    <circle cx="8.5" cy="18.06" r="2" />
    <circle cx="15.5" cy="18.06" r="2" />
  </svg>
);

/**
 * Lottie 动画：播放键 + 右侧动感弧，表达「矢量动画在播放」。
 * 与 Video 的方框播放键、GIF 的图片播放键靠圆形轮廓和动感弧区分。
 */
const LottieIcon: IconComponent = (props) => (
  <svg {...svgProps(props)}>
    <circle cx="11" cy="12" r="7.5" />
    <path d="M9.3 8.9 14.8 12 9.3 15.1Z" fill="currentColor" stroke="none" />
    <path d="M20.5 6.8a11 11 0 0 1 0 10.4" />
  </svg>
);

/** 双态按钮变体：圆角矩形右半填充，表达 on / off 两态 */
const DualStateIcon: IconComponent = (props) => (
  <svg {...svgProps(props)}>
    <rect x="2" y="6" width="20" height="12" rx="4" />
    <path d="M12 6h6a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-6Z" fill="currentColor" stroke="none" />
  </svg>
);

const ICONS: Record<ComponentIconName, IconComponent> = {
  'button': ButtonIcon,
  'label': TypeIcon,
  'time-label': ClockIcon,
  'timer-label': TimerIcon,
  'input': TextCursorInputIcon,
  'image': ImageIcon,
  'checkbox': SquareCheckIcon,
  'radio': CircleDotIcon,
  'switch': ToggleLeftIcon,
  'progressbar': ProgressBarIcon,
  'slider': SliderIcon,
  'view': SmartphoneIcon,
  'window': AppWindowIcon,
  'canvas': SquarePenIcon,
  'list': Rows3Icon,
  'list-item': ListItemIcon,
  'video': SquarePlayIcon,
  'streaming': RadioIcon,
  'gif': ImagePlayIcon,
  'model-3d': BoxIcon,
  'arc': ArcIcon,
  'circle': CircleIcon,
  'rect': RectangleHorizontalIcon,
  'svg': SplineIcon,
  'lottie': LottieIcon,
  'glass': GlassIcon,
  'particle': ParticleIcon,
  'menu-cellular': MenuCellularIcon,
  'qrcode': QrCodeIcon,
  'dual-state': DualStateIcon,
  'opacity': BlendIcon,
  'unknown': SquareDashedIcon,
};

interface ComponentIconProps {
  /** 图标名；未知或缺失时回落到虚线框占位图标 */
  name: ComponentIconName | undefined;
  size?: number;
  className?: string;
}

/**
 * 组件图标。单色描边、继承 currentColor，
 * 因此能跟随 VS Code 主题以及 hover / 选中 / 置灰等状态。
 */
const ComponentIcon: React.FC<ComponentIconProps> = ({ name, size = 24, className }) => {
  const Icon = (name && ICONS[name]) || ICONS.unknown;
  return <Icon size={size} className={className} />;
};

export default ComponentIcon;
