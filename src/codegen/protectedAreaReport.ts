/**
 * 保护区代码合并时丢失内容的收集点。
 *
 * `ProtectedAreaMerger` 是纯字符串工具，被 HoneyGUI 与 LVGL 两套生成器共用，
 * 不适合直接依赖 vscode。它在发现用户手写代码因为对应的组件/事件消失而无法
 * 写回时，把事件记到这里；由生成入口收集后统一写输出通道并提示用户。
 *
 * 之前这类丢失只打一条 logger.warn，用户在界面上看不到——组件改名或删掉一个
 * 按钮后，callback 文件里的手写代码就静默消失了。
 */

export interface DroppedProtectedArea {
  /** 保护区名（通常是组件 id 或回调名） */
  id: string;
  /** 被合并的文件路径 */
  file?: string;
}

let sink: ((entry: DroppedProtectedArea) => void) | undefined;
let pending: DroppedProtectedArea[] = [];

/**
 * 设置收集器（生成期间由调用方安装，结束后传 undefined 解除）。
 * 没有安装收集器时条目留在缓冲区，调用 takeDropped() 可取走。
 */
export function setProtectedAreaSink(next: ((entry: DroppedProtectedArea) => void) | undefined): void {
  sink = next;
}

/** 记录一条丢失。file 由合并器在调用前用 withProtectedAreaFile 标注 */
export function reportDroppedProtectedArea(id: string, file?: string): void {
  const entry: DroppedProtectedArea = { id, file: file ?? currentFile };
  if (sink) {
    sink(entry);
  } else {
    pending.push(entry);
  }
}

/** 取走并清空缓冲的丢失记录 */
export function takeDroppedProtectedAreas(): DroppedProtectedArea[] {
  const taken = pending;
  pending = [];
  return taken;
}

let currentFile: string | undefined;

/** 合并某个文件期间调用，给丢失记录补上文件路径 */
export function withProtectedAreaFile<T>(file: string, fn: () => T): T {
  const previous = currentFile;
  currentFile = file;
  try {
    return fn();
  } finally {
    currentFile = previous;
  }
}
