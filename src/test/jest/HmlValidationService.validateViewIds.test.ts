import { HmlValidationService } from '../../services/HmlValidationService';

/**
 * 规则 9：hg_view 的 id 必填警告。
 *
 * 一律经 validateHml 集成入口触发（评审 advisory）：规则本身读的是原始 XML 而非
 * 解析后的组件树（HmlParser 会回填 fallback id，基于组件树判定是死代码），但对调
 * 用方承诺的是「调 validateHml 就会报」，用 bracket 直调私有方法会把这条链路排除
 * 在测试之外。
 */

const DOC_HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <title>validateViewIds fixture</title>
    <project><name>p</name><resolution>240X240</resolution><pixelMode>RGB565</pixelMode></project>
  </meta>
  <view>
`;

const DOC_TAIL = `  </view>
</hml>
`;

/** 把若干 <hg_view> 片段塞进一个结构完整的 HML 文档 */
function docWith(viewsXml: string): string {
  return DOC_HEAD + viewsXml + DOC_TAIL;
}

const VIEW_NO_ID = `<hg_view x="0" y="0" w="240" h="240" entry="true"></hg_view>`;
const VIEW_WITH_ID = `<hg_view id="view_main" x="0" y="0" w="240" h="240" entry="true"></hg_view>`;

describe('HmlValidationService.validateViewIds (rule 9, via validateHml)', () => {
  function missingIdWarnings(hmlContent: string) {
    const result = new HmlValidationService().validateHml(hmlContent, {});
    return result.warnings.filter(
      w => w.type === 'best-practice' && w.message.includes('hg_view is missing an id')
    );
  }

  it('warns when hg_view has no id', () => {
    expect(missingIdWarnings(docWith(VIEW_NO_ID))).toHaveLength(1);
  });

  it('does not warn when hg_view has an id', () => {
    expect(missingIdWarnings(docWith(VIEW_WITH_ID))).toHaveLength(0);
  });

  it('does not warn about an id-less hg_view inside an XML comment', () => {
    const content = docWith(`
      <!-- disabled screen, intentionally left without an id:
        <hg_view x="0" y="0" w="240" h="240"></hg_view>
      -->
      ${VIEW_WITH_ID}
    `);
    expect(missingIdWarnings(content)).toHaveLength(0);
  });

  it('flags a genuinely id-less hg_view even when a commented-out one precedes it', () => {
    // 同时守住「剔除注释」这条正则：未闭合的尾部注释不能把其后的真实标签一起吞掉
    const content = docWith(`
      <!-- <hg_view x="0" y="0" w="240" h="240"></hg_view> -->
      ${VIEW_NO_ID}
    `);
    expect(missingIdWarnings(content)).toHaveLength(1);
  });

  it('does not false-positive on an attribute value containing ">" (quoted content ends the tag correctly)', () => {
    const content = docWith(
      `<hg_view id="view_main" name="a > b" x="0" y="0" w="240" h="240" entry="true"></hg_view>`
    );
    expect(missingIdWarnings(content)).toHaveLength(0);
  });

  it('still detects a missing id even when a sibling attribute value contains ">"', () => {
    const content = docWith(
      `<hg_view name="a > b" x="0" y="0" w="240" h="240" entry="true"></hg_view>`
    );
    expect(missingIdWarnings(content)).toHaveLength(1);
  });

  it('handles multiple hg_view tags independently', () => {
    const content = docWith(`
      <hg_view id="view_a" x="0" y="0" w="1" h="1"></hg_view>
      <hg_view x="0" y="0" w="1" h="1"></hg_view>
      <hg_view id="view_c" x="0" y="0" w="1" h="1"></hg_view>
    `);
    expect(missingIdWarnings(content)).toHaveLength(1);
  });

  it('treats a self-closing hg_view like any other open tag', () => {
    expect(missingIdWarnings(docWith(`<hg_view x="0" y="0" w="1" h="1" entry="true" />`))).toHaveLength(1);
    expect(missingIdWarnings(docWith(`<hg_view id="view_main" x="0" y="0" w="1" h="1" entry="true" />`))).toHaveLength(0);
  });

  it('does not mistake another attribute ending in "id"/"grid" for the id attribute', () => {
    // \s 前缀守卫：grid= / uid= 不能被当成 id=
    const idless = docWith(`<hg_view uid="main" grid="8" x="0" y="0" w="1" h="1" entry="true"></hg_view>`);
    expect(missingIdWarnings(idless)).toHaveLength(1);
    const withId = docWith(
      `<hg_view uid="main" id="view_main" grid="8" x="0" y="0" w="1" h="1" entry="true"></hg_view>`
    );
    expect(missingIdWarnings(withId)).toHaveLength(0);
  });

  it('detects a missing id in a CRLF file and still accepts an explicit id there', () => {
    const crlf = docWith(`
      ${VIEW_NO_ID}
      ${VIEW_WITH_ID}
    `).replace(/\n/g, '\r\n');
    // 只有缺 id 的那个报，带 id 的不报——CRLF 不会让属性匹配失效
    expect(missingIdWarnings(crlf)).toHaveLength(1);
  });

  it('handles Chinese text and Chinese comment content without losing detection', () => {
    const content = docWith(`
      <!-- 首页：返回按钮跳到上一屏 -->
      <hg_view x="0" y="0" w="240" h="240" entry="true">
        <hg_label id="lbl_title" x="10" y="10" w="100" h="20" text="返回" />
      </hg_view>
      <hg_view id="view_main" x="0" y="0" w="240" h="240">
        <hg_label id="lbl_hint" x="10" y="10" w="100" h="20" text="中文 > 英文" />
      </hg_view>
    `);
    expect(missingIdWarnings(content)).toHaveLength(1);
  });

  it('reports a syntax error instead of throwing on malformed HML', () => {
    const content = docWith(`<hg_view id="view_main" x="0" y="0">`); // 未闭合
    const result = new HmlValidationService().validateHml(content, {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(missingIdWarnings(content)).toHaveLength(0);
  });

  it('reports a syntax error instead of throwing on an empty file', () => {
    const result = new HmlValidationService().validateHml('', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([{ type: 'syntax', message: 'HML content is empty' }]);
    expect(result.warnings).toHaveLength(0);
  });

  it('reports a syntax error instead of throwing on a whitespace-only file', () => {
    const result = new HmlValidationService().validateHml('  \r\n\t\r\n', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([{ type: 'syntax', message: 'HML content is empty' }]);
    expect(result.warnings).toHaveLength(0);
  });
});
