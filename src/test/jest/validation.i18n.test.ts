/**
 * validateComponentId 同时服务 webview 与扩展宿主。宿主侧只经本地 HTTP API
 * 返回、不进 VS Code UI，因此这里固定输出英文，不依赖 webview 的 locale 状态。
 */
import { validateComponentId } from '../../webview/utils/validation';
import { setLocale } from '../../webview/i18n';

describe('validateComponentId', () => {
  it('rejects empty names', () => {
    expect(validateComponentId('', [])).toEqual({ valid: false, error: 'Name cannot be empty' });
    expect(validateComponentId('   ', [])).toEqual({ valid: false, error: 'Name cannot be empty' });
  });

  it('rejects C keywords and names the offending id', () => {
    expect(validateComponentId('int', [])).toEqual({
      valid: false,
      error: '"int" is a C keyword'
    });
  });

  it('rejects malformed identifiers', () => {
    const result = validateComponentId('1abc', []);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('letters, numbers and underscores');
  });

  it('reports duplicates and names the offending id', () => {
    expect(validateComponentId('view1', ['view1', 'view2'])).toEqual({
      valid: false,
      error: '"view1" is already used by another component'
    });
  });

  it('allows renaming a component to its own id', () => {
    expect(validateComponentId('view1', ['view1', 'view2'], 'view1').valid).toBe(true);
  });

  it('stays English regardless of the webview locale', () => {
    setLocale('zh-cn');
    expect(validateComponentId('', []).error).toBe('Name cannot be empty');
    expect(validateComponentId('int', []).error).toBe('"int" is a C keyword');
    setLocale('en');
  });
});
