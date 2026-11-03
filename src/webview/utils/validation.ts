/**
 * ID/变量名校验工具
 *
 * 同时被 webview 与扩展宿主（HmlValidationService）使用。宿主的验证结果只经
 * 本地 HTTP API 返回、不进 VS Code UI，因此这里固定输出英文，不依赖 webview i18n。
 */

const C_KEYWORDS = new Set([
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
  'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if',
  'int', 'long', 'register', 'return', 'short', 'signed', 'sizeof', 'static',
  'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while'
]);

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * 校验 C 语言变量名合法性
 * @internal 内部使用，不对外导出
 */
function isValidCIdentifier(id: string): ValidationResult {
  if (!id || !id.trim()) {
    return { valid: false, error: 'Name cannot be empty' };
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    return { valid: false, error: 'Use letters, numbers and underscores; start with a letter or underscore.' };
  }
  if (C_KEYWORDS.has(id)) {
    return { valid: false, error: `"${id}" is a C keyword` };
  }
  return { valid: true };
}

/**
 * 校验 ID 唯一性
 * @internal 内部使用，不对外导出
 */
function isUniqueId(id: string, existingIds: string[], currentId?: string): ValidationResult {
  const othersIds = currentId ? existingIds.filter(i => i !== currentId) : existingIds;
  if (othersIds.includes(id)) {
    return { valid: false, error: `"${id}" is already used by another component` };
  }
  return { valid: true };
}

/**
 * 完整校验：合法性 + 唯一性
 */
export function validateComponentId(id: string, existingIds: string[], currentId?: string): ValidationResult {
  const validResult = isValidCIdentifier(id);
  if (!validResult.valid) return validResult;

  return isUniqueId(id, existingIds, currentId);
}
