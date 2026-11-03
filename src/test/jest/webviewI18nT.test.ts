/**
 * t() 参数替换的回归测试。
 *
 * t() 直接把用户可控文本（文件名、控件 id 等）填进消息。若用
 * String.replace 的字符串 replacement，参数里的 $&、$'、$`、$$ 会被当成
 * 替换模式，导致通知文本损坏或被吞掉。
 */
import { t, setLocale } from '../../webview/i18n';

describe('t() placeholder substitution', () => {
  beforeEach(() => setLocale('en'));

  const KEY = 'Missing dependency files for {0}: {1}. Select them together when dragging.';

  it('keeps dollar signs in arguments literal', () => {
    const cases = ['model$$v2.obj', 'a$&b.obj', "a$'b.obj", 'a$`b.obj', '$1', '$<name>'];
    for (const name of cases) {
      expect(t(KEY, name, 'tex.mtl'))
        .toBe(`Missing dependency files for ${name}: tex.mtl. Select them together when dragging.`);
    }
  });

  it('substitutes every placeholder', () => {
    // 占位符之外不得残留未替换的 {0}
    const out = t(KEY, 'm.obj', 'a.mtl, b.mtl');
    expect(out).not.toContain('{0}');
    expect(out).not.toContain('{1}');
  });

  it('renders numeric arguments', () => {
    expect(t('and {0} more', 7)).toBe(' and 7 more');
  });

  it('falls back to the key when it is missing from the bundle', () => {
    const unknown = 'definitely-not-a-key' as never;
    expect(t(unknown)).toBe('definitely-not-a-key');
  });
});
