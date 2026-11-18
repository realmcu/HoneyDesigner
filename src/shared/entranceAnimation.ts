/**
 * 页面入场动画（hg_view 的 entranceAnim）
 *
 * 进入页面时，页面上的卡片从屏幕一侧依次「甩」进来，带着一点倾斜和缩放，落位时回弹。
 * 每张卡片的 x / y / 旋转 / 缩放各是一根阻尼弹簧，生成代码时就把弹簧积分成 60 fps 的表，
 * 运行时只查表插值。这样 HoneyGUI、LVGL 与设计器预览用的是同一份曲线。
 *
 * 几点取舍：
 * - 抛出点放在所选方向那一侧的屏幕外，主轴、副轴随方向互换。
 * - 「卡片」由组件自动分组：完全落在另一个兄弟组件范围内的组件（卡片上的文字、图标）
 *   跟随那个组件一起运动，不会各飞各的。列表的每一项各算一张卡片。
 * - 回弹强度同时控制倾斜角度：0 时只平移、不倾斜。
 *
 * 纯函数、无 vscode 依赖，插件代码生成与 webview 预览共用。
 */

/**
 * 入场风格。前五个带方向（从某一侧甩进来 / 从中心散开），
 * 后四个是方向无关的风格：淡入上浮、原地弹入、旋转滑入、逐行落下。
 */
export type EntranceDirection =
  | 'fromBottom' | 'fromTop' | 'fromLeft' | 'fromRight' | 'fromCenter'
  | 'rise' | 'pop' | 'spin' | 'cascade';

export const ENTRANCE_DIRECTIONS: readonly EntranceDirection[] = [
  'fromBottom', 'fromTop', 'fromLeft', 'fromRight', 'fromCenter',
  'rise', 'pop', 'spin', 'cascade',
];

/** 采样帧率：查表按 60 fps 排布 */
export const ENTRANCE_FPS = 60;
/** 位移表的定点精度：表里存 1/8 像素 */
export const ENTRANCE_FIXED_SHIFT = 3;
/** 旋转表的单位：0.1 度（与 LVGL transform_rotation 相同） */
export const ENTRANCE_ROT_UNIT = 10;
/** 缩放表存 (scale - 1) × 4096 */
export const ENTRANCE_SCALE_UNIT = 4096;
/** 淡入占用的帧数（前 5 帧从 0 到 1） */
export const ENTRANCE_FADE_FRAMES = 5;

export interface EntranceOptions {
  direction: EntranceDirection;
  /** 单张卡片大致的落位时间（毫秒），默认 800 */
  duration: number;
  /** 相邻卡片的启动间隔（毫秒），默认 52 */
  stagger: number;
  /** 回弹强度 0~100，0 为不回弹，默认 60 */
  bounce: number;
  /** 是否在开始的几帧淡入，默认 true */
  fade: boolean;
}

export const ENTRANCE_DEFAULTS: Omit<EntranceOptions, 'direction'> = {
  duration: 800,
  stagger: 52,
  bounce: 60,
  fade: true,
};

/** 参与分组的子组件（相对 view 的坐标） */
export interface EntrancePiece {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一组一起运动的组件（一张卡片） */
export interface EntranceGroup {
  /** 组内组件 id，第一个是最大的那个（卡片底板） */
  ids: string[];
  /** 启动延时（毫秒） */
  delay: number;
  /** 每帧相对落位点的偏移（像素，浮点），最后一帧恒为 0 */
  dx: number[];
  dy: number[];
  /** 卡片中心（相对页面），旋转、缩放绕这个点 */
  cx: number;
  cy: number;
  /** 每帧绕卡片中心的旋转（度），最后一帧恒为 0 */
  rot: number[];
  /** 每帧绕卡片中心的缩放（1 为原大），最后一帧恒为 1 */
  scale: number[];
}

export interface EntrancePlan {
  groups: EntranceGroup[];
  /** 整个入场持续时间（毫秒，含最后一组的延时） */
  totalMs: number;
  /** 淡入占用的帧数，随风格变化 */
  fadeFrames: number;
}

const BASE_DURATION = 800;
const BASE_K = 210;
const STEPS = 8;
/** 抛出点在屏幕外的距离（屏幕尺寸的比例） */
const ORIGIN_OUTSIDE = 0.3;
/** 卡片起点 = 落位点 + (抛出点 - 落位点) × PULL */
const PULL = 0.62;
/** 起始速度，让卡片一出手就有速度，不是从静止起步 */
const LEAD = 0.45;
/** 出手时的倾斜角范围（度），按卡片抖动取值 */
const TILT_MIN = 3;
const TILT_MAX = 6;
/** 旋转弹簧刚度 */
const ROT_K = 170;
/** 出手时的缩放 */
const SCALE_FROM = 0.9;
/** 默认回弹强度对应的倾斜幅度 */
const TILT_REFERENCE_BOUNCE = 60;

/*
 * fromCenter：卡片从页面正中一小堆里散开，离中心越近越早出手（应用宫格那种）。
 * 起点不是正中心，而是落在中心与自身之间 PULL 的位置，压成一小堆叠在一起，再向四周弹出去。
 */
const BURST_PULL = 0.82;
const BURST_SCALE_FROM = 0.42;
const BURST_TILT_MIN = 5;
const BURST_TILT_MAX = 10;
const BURST_K = 230;
const BURST_Z = 0.64;
const BURST_LEAD = 0.5;
const BURST_ROT_K = 190;
/** 出手延时 = 离中心的距离（像素）× 这个系数 */
const BURST_DELAY_PER_PX = 0.75;

/*
 * rise / pop / spin / cascade：方向无关的四种风格，复用同一套位移、旋转、缩放通道。
 * rise 从下往上淡入上浮（不旋转、不回弹），pop 在原位放大，
 * spin 从最近的一侧拧进来，cascade 从页面上方按行落下。
 */
const RISE_OFFSET = 18;
const RISE_LEAD = 0.2;
const RISE_K = 180;
const POP_SCALE_FROM = 0.36;
const POP_TILT = 2.5;
const POP_K = 240;
const SPIN_ANGLE = 25;
const SPIN_SCALE_FROM = 0.94;
const SPIN_PULL = 0.55;
const SPIN_OUTSIDE = 0.15;
const SPIN_K = 190;
/** 落下的起点：卡片底边停在页面上方这么远 */
const CASCADE_LIFT = 8;
const CASCADE_LEAD = 0.35;
const CASCADE_K = 205;
/** cascade 行判定容差（页面高度的比例） */
const CASCADE_ROW_TOL = 0.045;

/** 每种风格的淡入帧数：位移越大，淡入占的时间越长 */
const FADE_FRAMES_BY_DIRECTION: Partial<Record<EntranceDirection, number>> = {
  rise: 12,
  pop: 8,
  spin: 6,
};

interface Channel {
  from: number;
  v: number;
  k: number;
  z: number;
  eps: number;
}

/**
 * 半隐式欧拉，480 Hz 积分、60 Hz 采样；所有通道都停稳后结束，最后一帧强制归零。
 * 逐帧积分弹簧，最大帧数由调用方给（时长可调）。
 */
export function simulateSprings(channels: Channel[], maxFrames: number): number[][] {
  const live = channels.map(c => {
    const w = Math.sqrt(c.k);
    return { ...c, x: c.from, vel: -c.from * w * c.v, damp: 2 * c.z * w, out: [c.from] };
  });
  const h = 1 / (ENTRANCE_FPS * STEPS);
  for (let frame = 0; frame < maxFrames; frame++) {
    let moving = false;
    for (const s of live) {
      for (let i = 0; i < STEPS; i++) {
        s.vel += (-s.k * s.x - s.damp * s.vel) * h;
        s.x += s.vel * h;
      }
      s.out.push(s.x);
      if (Math.abs(s.x) > s.eps || Math.abs(s.vel) > s.eps * 10) {
        moving = true;
      }
    }
    if (!moving) {
      break;
    }
  }
  return live.map(s => {
    s.out[s.out.length - 1] = 0;
    return s.out;
  });
}

/** 每张卡片稳定的小抖动，避免几张卡完全同步，但每次进入效果相同 */
function jitter(i: number, salt: number): number {
  const t = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return t - Math.floor(t);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

export function isEntranceDirection(value: unknown): value is EntranceDirection {
  return typeof value === 'string' && (ENTRANCE_DIRECTIONS as readonly string[]).includes(value);
}

/**
 * 从 hg_view 的 data 读出入场配置；未开启（entranceAnim 缺省 / none / 非法值）返回 null。
 */
export function readEntranceOptions(data: Record<string, any> | undefined): EntranceOptions | null {
  const direction = data?.entranceAnim;
  if (!isEntranceDirection(direction)) {
    return null;
  }
  const fade = data?.entranceFade;
  return {
    direction,
    duration: clampNumber(data?.entranceDuration, 200, 3000, ENTRANCE_DEFAULTS.duration),
    stagger: clampNumber(data?.entranceStagger, 0, 500, ENTRANCE_DEFAULTS.stagger),
    bounce: clampNumber(data?.entranceBounce, 0, 100, ENTRANCE_DEFAULTS.bounce),
    fade: fade === undefined || fade === '' ? ENTRANCE_DEFAULTS.fade : !(fade === false || fade === 'false'),
  };
}

/** 设计器与代码生成两侧组件类型的公共部分 */
export interface EntranceSource {
  id: string;
  type: string;
  visible?: boolean;
  children?: string[];
  position: { x: number; y: number; width: number; height: number };
  data?: Record<string, any>;
  style?: Record<string, any>;
}

export interface EntranceMemberPiece<T extends EntranceSource> {
  piece: EntrancePiece;
  component: T;
  /** 列表项所在的列表；页面直接子组件为 undefined */
  list?: T;
}

export interface EntranceCollectRules<T extends EntranceSource> {
  /** 引擎无法单独移动的子组件 */
  skip?: (child: T) => boolean;
  /** 是否把列表拆成一项一项单独弹入；不拆时整个列表作为一张卡片 */
  expandList?: (list: T) => boolean;
}

/** 铺满页面的底图、底色块：不参与入场，也不把整页内容并成一组 */
const BACKGROUND_TYPES = ['hg_image', 'hg_rect', 'hg_gif', 'hg_svg'];
const BACKGROUND_COVERAGE = 0.9;

const num = (v: unknown) => Number(v) || 0;

/** 按 data.index 排好序的列表项（与 HoneyGUI note 的 index 一一对应） */
export function sortedListItems<T extends EntranceSource>(list: T, lookup: (id: string) => T | undefined): T[] {
  return (list.children ?? [])
    .map(lookup)
    .filter((c): c is T => c !== undefined && c.type === 'hg_list_item')
    .sort((a, b) => num(a.data?.index) - num(b.data?.index));
}

/**
 * 找出页面里参与入场的组件（相对页面坐标）。
 * 列表按 rules.expandList 拆成列表项，只保留落在列表可视区内的项（看不见的项不动画）；
 * LIST_CARD 样式例外，超出的项会叠在底部显示，全部参与。
 */
export function collectEntrancePieces<T extends EntranceSource>(
  view: T,
  lookup: (id: string) => T | undefined,
  rules: EntranceCollectRules<T> = {},
): Array<EntranceMemberPiece<T>> {
  const viewW = num(view.position.width);
  const viewH = num(view.position.height);
  const result: Array<EntranceMemberPiece<T>> = [];

  for (const id of view.children ?? []) {
    const child = lookup(id);
    if (!child || child.visible === false || rules.skip?.(child)) {
      continue;
    }
    const x = num(child.position.x);
    const y = num(child.position.y);
    const width = num(child.position.width);
    const height = num(child.position.height);

    if (BACKGROUND_TYPES.includes(child.type) && !(child.children?.length) &&
        width >= viewW * BACKGROUND_COVERAGE && height >= viewH * BACKGROUND_COVERAGE) {
      continue;
    }

    if (child.type === 'hg_list' && rules.expandList?.(child)) {
      const items = sortedListItems(child, lookup);
      if (items.length > 0) {
        const left = Math.max(0, x);
        const top = Math.max(0, y);
        const right = Math.min(viewW, x + width);
        const bottom = Math.min(viewH, y + height);
        // 卡片堆叠样式会把超出列表的项叠在底部显示，这些项也要一起弹入，不能先露出来
        const stacked = (child.style?.style ?? child.data?.style) === 'LIST_CARD';
        for (const item of items) {
          if (item.visible === false) {
            continue;
          }
          const piece = {
            id: item.id,
            x: x + num(item.position.x),
            y: y + num(item.position.y),
            width: num(item.position.width),
            height: num(item.position.height),
          };
          if (stacked || (piece.x < right && piece.x + piece.width > left && piece.y < bottom && piece.y + piece.height > top)) {
            result.push({ piece, component: item, list: child });
          }
        }
        continue;
      }
    }

    result.push({ piece: { id: child.id, x, y, width, height }, component: child });
  }
  return result;
}

function contains(outer: EntrancePiece, inner: EntrancePiece): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

/**
 * 把兄弟组件分成「卡片」：组件完全落在某个更大的兄弟组件内时，并入包含它的最小那个组件的组。
 * 返回的组按阅读顺序（先上后下、先左后右）排列，fromTop 时反过来——总是离抛出点最远的先出手。
 */
export function groupEntrancePieces(pieces: EntrancePiece[], direction: EntranceDirection): EntrancePiece[][] {
  const area = (p: EntrancePiece) => p.width * p.height;
  const ownerOf = new Map<string, string>();

  for (const piece of pieces) {
    let owner: EntrancePiece | undefined;
    for (const other of pieces) {
      if (other === piece || area(other) <= area(piece) || !contains(other, piece)) {
        continue;
      }
      if (!owner || area(other) < area(owner)) {
        owner = other;
      }
    }
    if (owner) {
      ownerOf.set(piece.id, owner.id);
    }
  }

  // 顺着包含链找到最外层的组件作为组长
  const rootOf = (id: string): string => {
    let current = id;
    const seen = new Set<string>();
    while (ownerOf.has(current) && !seen.has(current)) {
      seen.add(current);
      current = ownerOf.get(current)!;
    }
    return current;
  };

  const groups = new Map<string, EntrancePiece[]>();
  for (const piece of pieces) {
    const root = rootOf(piece.id);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(piece);
  }

  const byId = new Map(pieces.map(p => [p.id, p]));
  const result = [...groups.entries()].map(([rootId, members]) => {
    const root = byId.get(rootId)!;
    return [root, ...members.filter(m => m.id !== rootId)];
  });

  result.sort((a, b) => (a[0].y - b[0].y) || (a[0].x - b[0].x));
  if (direction === 'fromTop') {
    result.reverse();
  }
  return result;
}

/**
 * 计算整页的入场方案。
 * @param viewWidth / viewHeight 页面尺寸
 * @param pieces 页面的直接子组件（相对页面坐标）
 */
export function planEntrance(
  viewWidth: number,
  viewHeight: number,
  pieces: EntrancePiece[],
  options: EntranceOptions,
): EntrancePlan {
  const { direction } = options;
  const burst = direction === 'fromCenter';
  const vertical = direction === 'fromBottom' || direction === 'fromTop' ||
    direction === 'rise' || direction === 'cascade';
  const groups = groupEntrancePieces(pieces, direction);

  const origin: [number, number] = (() => {
    switch (direction) {
      case 'fromTop': return [viewWidth / 2, -viewHeight * ORIGIN_OUTSIDE];
      case 'fromLeft': return [-viewWidth * ORIGIN_OUTSIDE, viewHeight / 2];
      case 'fromRight': return [viewWidth * (1 + ORIGIN_OUTSIDE), viewHeight / 2];
      default: return [viewWidth / 2, viewHeight * (1 + ORIGIN_OUTSIDE)];
    }
  })();

  // 时长 → 刚度：弹簧周期与 1/sqrt(k) 成正比
  const speed = BASE_DURATION / options.duration;
  const maxFrames = Math.min(360, Math.ceil(options.duration * 2.5 * ENTRANCE_FPS / 1000));
  // 回弹强度 → 阻尼比：0 为临界阻尼（不过冲），100 为 0.45
  const bounceZ = 1 - (options.bounce / 100) * 0.55;
  // 倾斜：3~6 度、阻尼 0.45；回弹越强倾斜越大、晃得越久
  const tiltGain = Math.min(1.5, options.bounce / TILT_REFERENCE_BOUNCE);

  // cascade 先分好行：同一行的卡片同时落下
  const rows = direction === 'cascade'
    ? cascadeRows(groups, Math.max(16, viewHeight * CASCADE_ROW_TOL))
    : [];

  let totalMs = 0;
  const planned = groups.map((members, i) => {
    const card = members[0];
    const cx = card.x + card.width / 2;
    const cy = card.y + card.height / 2;

    // 每种风格只决定起点：位移、倾斜、缩放、弹簧参数、启动延时
    let offX = 0;
    let offY = 0;
    let tilt = 0;
    let scaleFrom = 1;
    let k = BASE_K * speed * speed;
    const z = bounceZ;
    let lead = LEAD;
    let rotK = ROT_K * speed * speed;
    let delay = Math.round(i * options.stagger);
    let damping = z;

    switch (direction) {
      case 'fromCenter':
        offX = (viewWidth / 2 - cx) * BURST_PULL;
        offY = (viewHeight / 2 - cy) * BURST_PULL;
        k = BURST_K * speed * speed;
        rotK = BURST_ROT_K * speed * speed;
        damping = Math.max(0.28, Math.min(1, BURST_Z + (TILT_REFERENCE_BOUNCE - options.bounce) / 100 * 0.6));
        lead = BURST_LEAD;
        scaleFrom = BURST_SCALE_FROM;
        tilt = tiltFor(Math.abs(offX) > 4 ? Math.sign(offX) : (i % 2 ? 1 : -1), BURST_TILT_MIN, BURST_TILT_MAX, i, tiltGain);
        // 散开时离中心近的先出手，形成一圈向外扩散的涟漪
        delay = Math.round(Math.hypot(offX, offY) * BURST_DELAY_PER_PX * (options.stagger / ENTRANCE_DEFAULTS.stagger));
        break;

      case 'rise':
        // 从下方十几像素轻轻推上来：不旋转、不回弹
        offY = Math.round(RISE_OFFSET * viewHeight / 502);
        k = RISE_K * speed * speed;
        lead = RISE_LEAD;
        damping = 1;
        delay = Math.round(i * options.stagger * 0.6);
        break;

      case 'pop':
        // 原地放大：没有方向位移，只过冲一点，中心附近轻晃一下
        scaleFrom = POP_SCALE_FROM;
        k = POP_K * speed * speed;
        lead = 0;
        damping = Math.max(0.35, z - 0.02);
        tilt = (i % 2 ? 1 : -1) * POP_TILT * (0.4 + jitter(i, 1)) * tiltGain;
        delay = Math.round(i * options.stagger * 0.6);
        break;

      case 'spin':
        // 从离自己最近的一侧滑入，同时从 ±25° 拧正
        {
          const fromLeft = cx < viewWidth / 2;
          const edge = fromLeft ? -viewWidth * SPIN_OUTSIDE : viewWidth * (1 + SPIN_OUTSIDE);
          offX = (edge - cx) * SPIN_PULL;
          scaleFrom = SPIN_SCALE_FROM;
          k = SPIN_K * speed * speed;
          lead = LEAD * 1.1;
          damping = Math.max(0.5, z - 0.08);
          tilt = (fromLeft ? -1 : 1) * SPIN_ANGLE * (0.75 + jitter(i, 1) * 0.5);
        }
        break;

      case 'cascade':
        // 一开始整张卡片在页面上方之外，按行错峰落下
        offY = -(cy + card.height / 2 + CASCADE_LIFT);
        k = CASCADE_K * speed * speed;
        lead = CASCADE_LEAD;
        delay = Math.round(rows[i] * options.stagger);
        break;

      case 'fromBottom':
      case 'fromTop':
      case 'fromLeft':
      case 'fromRight':
      default: {
        offX = (origin[0] - cx) * PULL;
        offY = (origin[1] - cy) * PULL;
        scaleFrom = SCALE_FROM;
        // 倾斜方向跟着横向偏移走；正对抛出点的卡片左右交替，看起来像一张张发出来的牌
        const lateral = vertical ? offX : offY;
        tilt = tiltFor(Math.abs(lateral) > 4 ? Math.sign(lateral) : (i % 2 ? 1 : -1), TILT_MIN, TILT_MAX, i, tiltGain);
        break;
      }
    }

    const softness = 0.92 + jitter(i, 2) * 0.16;
    // 主轴软、副轴更硬且阻尼更大，所以卡片走一条微弯的弧线
    const main = { v: lead, k: k * softness, z: damping, eps: 0.15 };
    const cross = { v: lead, k: k * 1.45 * softness, z: Math.min(1, damping + 0.08), eps: 0.15 };
    const rotZ = Math.max(0.3, Math.min(1, damping - 0.23));
    const scaleZ = Math.max(0.4, Math.min(1, damping - 0.06));
    const [dx, dy, rot, scaleOffset] = simulateSprings([
      { from: offX, ...(burst || !vertical ? cross : main) },
      { from: offY, ...(burst || vertical ? main : cross) },
      { from: tilt, v: 0, k: rotK, z: rotZ, eps: 0.03 },
      { from: scaleFrom - 1, v: 0.3, k: k * 1.2, z: scaleZ, eps: 0.0008 },
    ], maxFrames);
    totalMs = Math.max(totalMs, delay + Math.round((dx.length - 1) * 1000 / ENTRANCE_FPS));
    return { ids: members.map(m => m.id), delay, cx, cy, dx, dy, rot, scale: scaleOffset.map(s => 1 + s) };
  });

  return { groups: planned, totalMs, fadeFrames: fadeFramesFor(direction) };
}

/** 出手时的倾斜角：方向由 side 决定，幅度在 min~max 之间按卡片抖动 */
function tiltFor(side: number, min: number, max: number, index: number, gain: number): number {
  return side * (min + (max - min) * jitter(index, 1)) * gain;
}

/** cascade 的行号：按顶边排序，相差超过 tolerance 的算下一行 */
function cascadeRows(groups: EntrancePiece[][], tolerance: number): number[] {
  const rows = new Array<number>(groups.length).fill(0);
  let row = -1;
  let lastTop = Number.NEGATIVE_INFINITY;
  const order = groups.map((_, i) => i).sort((a, b) => groups[a][0].y - groups[b][0].y);
  for (const i of order) {
    const top = groups[i][0].y;
    if (top - lastTop > tolerance) {
      row++;
      lastTop = top;
    }
    rows[i] = Math.max(0, row);
  }
  return rows;
}

/** 某种风格的淡入帧数 */
export function fadeFramesFor(direction: EntranceDirection): number {
  return FADE_FRAMES_BY_DIRECTION[direction] ?? ENTRANCE_FADE_FRAMES;
}

/** 位移转成表里的定点数（1/8 像素） */
export function toFixedOffset(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value * (1 << ENTRANCE_FIXED_SHIFT))));
}

/** 旋转转成表里的定点数（0.1 度） */
export function toFixedRotation(degrees: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(degrees * ENTRANCE_ROT_UNIT)));
}

/** 缩放转成表里的定点数（(scale - 1) × 4096） */
export function toFixedScale(scale: number): number {
  return Math.max(-32768, Math.min(32767, Math.round((scale - 1) * ENTRANCE_SCALE_UNIT)));
}

/** 淡入：第 frame 帧（可为小数）的不透明度 0~1，frames 为淡入占用的总帧数 */
export function entranceFadeAt(frame: number, frames = ENTRANCE_FADE_FRAMES): number {
  return Math.max(0, Math.min(1, frame / Math.max(1, frames)));
}
