/**
 * Shared C string literal helpers for all code generators
 */

const NAMED_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

/**
 * Escape a value for use inside a C string literal ("...").
 * Other control characters use fixed 3-digit octal escapes: unlike `\x`,
 * octal escapes stop after 3 digits, so following text cannot be swallowed.
 */
export function escapeCString(value: string): string {
  return value.replace(/[\\"\x00-\x1f\x7f]/g, ch =>
    NAMED_ESCAPES[ch] ?? '\\' + ch.charCodeAt(0).toString(8).padStart(3, '0')
  );
}
