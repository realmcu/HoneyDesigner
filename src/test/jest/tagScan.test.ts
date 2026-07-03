import { scanOpenTags } from '../../hml/tagScan';

/**
 * scanOpenTags 单元测试——validateViewIds（R6）与 NavEditService round-trip
 * 预检（H2）共用的"尊重引号的轻量开标签扫描"。核心回归点：属性值里的 '>'
 * 不得截断标签（截断会导致其后的 id / name 属性漏检）。
 */
describe('scanOpenTags', () => {
  it('extracts tag name and attrsText for a simple open tag', () => {
    const tags = scanOpenTags('<hg_button id="btn_a" x="1">');
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('hg_button');
    expect(tags[0].attrsText).toBe(' id="btn_a" x="1"');
    expect(tags[0].raw).toBe('<hg_button id="btn_a" x="1">');
  });

  it("does not end the tag at a '>' inside a double-quoted attribute value", () => {
    const tags = scanOpenTags('<hg_button text="a > b" name="target_ref">');
    expect(tags).toHaveLength(1);
    // 截断 bug 下 attrsText 会停在 text="a 处，丢掉后面的 name 属性
    expect(tags[0].attrsText).toContain('name="target_ref"');
  });

  it("does not end the tag at a '>' inside a single-quoted attribute value", () => {
    const tags = scanOpenTags("<hg_label text='x > y' id='lbl'>");
    expect(tags).toHaveLength(1);
    expect(tags[0].attrsText).toContain("id='lbl'");
  });

  it("does not treat a '<' or the other quote kind inside quotes as boundaries", () => {
    const tags = scanOpenTags(`<hg_label text="it's <b>bold</b>" id="lbl"><hg_button id="btn">`);
    expect(tags).toHaveLength(2);
    expect(tags[0].name).toBe('hg_label');
    expect(tags[0].attrsText).toContain('id="lbl"');
    expect(tags[1].name).toBe('hg_button');
  });

  it('skips closing tags, XML declarations and comments-like starts', () => {
    const tags = scanOpenTags('<?xml version="1.0"?><view><hg_view id="v"/></view>');
    expect(tags.map(t => t.name)).toEqual(['view', 'hg_view']);
    // 自闭合：attrsText 含结尾 '/'
    expect(tags[1].attrsText).toBe(' id="v"/');
  });

  it('filters by exact tagName when provided (no prefix matches)', () => {
    const content = '<hg_view id="a"><hg_view_ex id="b"><hg_view id="c">';
    const tags = scanOpenTags(content, 'hg_view');
    expect(tags.map(t => t.raw)).toEqual(['<hg_view id="a">', '<hg_view id="c">']);
  });

  it('treats an unclosed tag as running to the end of content', () => {
    const tags = scanOpenTags('<hg_view id="a" w="240');
    expect(tags).toHaveLength(1);
    expect(tags[0].attrsText).toBe(' id="a" w="240');
  });
});
