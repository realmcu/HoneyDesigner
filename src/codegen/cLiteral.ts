/**
 * 生成 C 字符串字面量的小工具。
 *
 * 代码生成器里有大量 `"${value}"` 形式的插值，value 往往来自 HML 的用户输入
 * （组件名、消息名、按键名、资源路径）。含 `"` 或换行时直接拼进源码会编译失败，
 * 含 `\` 时可能被当成转义序列。统一用 `cLiteral` 生成带引号的字面量。
 */
import { escapeCString } from './cString';

/** 把任意文本转成合法、带引号的 C 字符串字面量（含两侧引号） */
export function cLiteral(value: string | number | undefined | null): string {
  return `"${escapeCString(value === undefined || value === null ? '' : String(value))}"`;
}
