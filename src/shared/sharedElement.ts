/**
 * 共享元素（shared element）：两个页面里同名标记的控件，切换页面时被视为同一个元素飞过去
 *
 * 用法：在旧页（比如卡片）和新页（比如详情页头部）各放一个控件，把「共享元素」填成同一个名字。
 * 切换时旧页那个先藏起来，新页那个从旧页控件的位置、大小飞到自己该在的位置。
 * 纯函数、无 vscode 依赖，插件代码生成与 webview 预览共用。
 */

/** 组件 data 里存标记的字段 */
export const SHARED_TAG_KEY = 'sharedTag';

/** 只用到组件里和共享元素相关的那几个字段，两侧的 Component 类型各自兼容 */
export interface SharedElementCandidate {
  id: string;
  name: string;
  type: string;
  parent?: string | null;
  data?: Record<string, unknown>;
}

export interface SharedElementNode<T extends SharedElementCandidate = SharedElementCandidate> {
  /** 所在页面（hg_view） */
  view: T;
  component: T;
}

export interface SharedElementPair<T extends SharedElementCandidate = SharedElementCandidate> {
  tag: string;
  a: SharedElementNode<T>;
  b: SharedElementNode<T>;
}

export function sharedTagOf(component: SharedElementCandidate): string {
  const tag = component.data?.[SHARED_TAG_KEY];
  return typeof tag === 'string' ? tag.trim() : '';
}

function ownerViewOf<T extends SharedElementCandidate>(component: T, byId: Map<string, T>): T | null {
  let current: T | undefined = component;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.type === 'hg_view') {
      return current;
    }
    seen.add(current.id);
    current = current.parent ? byId.get(current.parent) : undefined;
  }
  return null;
}

/**
 * 找出所有跨页面配对的共享元素；同一个页面内的标记不算，落单的标记忽略
 */
export function collectSharedElementPairs<T extends SharedElementCandidate>(
  components: readonly T[],
): SharedElementPair<T>[] {
  const byId = new Map(components.map(c => [c.id, c]));
  const byTag = new Map<string, SharedElementNode<T>[]>();
  for (const component of components) {
    const tag = sharedTagOf(component);
    if (!tag) {
      continue;
    }
    const view = ownerViewOf(component, byId);
    if (!view) {
      continue;
    }
    const nodes = byTag.get(tag) ?? [];
    nodes.push({ view, component });
    byTag.set(tag, nodes);
  }

  const pairs: SharedElementPair<T>[] = [];
  const seen = new Set<string>();
  for (const [tag, nodes] of byTag) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const [a, b] = [nodes[i], nodes[j]];
        const key = a.view.id < b.view.id
          ? `${tag}|${a.component.id}|${b.component.id}`
          : `${tag}|${b.component.id}|${a.component.id}`;
        if (a.view.id === b.view.id || seen.has(key)) {
          continue;
        }
        seen.add(key);
        pairs.push({ tag, a, b });
      }
    }
  }
  return pairs;
}

/** 一对共享元素按方向挑出旧页、新页的那两个控件 */
export function orientPair<T extends SharedElementCandidate>(
  pair: SharedElementPair<T>,
  fromViewId: string,
): { from: SharedElementNode<T>; to: SharedElementNode<T> } | null {
  if (pair.a.view.id === fromViewId) {
    return { from: pair.a, to: pair.b };
  }
  if (pair.b.view.id === fromViewId) {
    return { from: pair.b, to: pair.a };
  }
  return null;
}
