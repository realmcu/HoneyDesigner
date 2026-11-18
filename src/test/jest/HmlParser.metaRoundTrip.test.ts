import { HmlParser } from '../../hml/HmlParser';
import { HmlSerializer } from '../../hml/HmlSerializer';

/**
 * <meta> 的往返（parse → serialize）保真。
 *
 * 回归点：`<project>` / `<author>` 用**子元素**写法时，子元素前必然有缩进文本节点；
 * 早期实现的 `_orderedElementToObject` 遇到第一个文本节点就 return，导致整块内容
 * 在保存后消失（`meta.project` 退化成缩进串）。这里同时钉住属性写法与纯文本元素，
 * 避免修复把另外两条路径改坏。
 */

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <title>meta fixture</title>
`;

const TAIL = `  </meta>
  <view>
    <hg_view id="view_a" x="0" y="0" w="240" h="240" entry="true" />
  </view>
</hml>
`;

function docWith(metaBody: string): string {
  return HEAD + metaBody + TAIL;
}

function roundTrip(content: string): string {
  const doc = new HmlParser().parse(content, 'home.hml');
  return new HmlSerializer().serialize(doc);
}

describe('HmlParser meta round-trip', () => {
  it('keeps child-element <project> fields (regression: content used to be dropped)', () => {
    const content = docWith(`    <project>
      <name>MyApp</name>
      <resolution>240X240</resolution>
      <pixelMode>RGB565</pixelMode>
    </project>
`);

    const doc = new HmlParser().parse(content, 'home.hml');
    expect(doc.meta.project).toEqual({
      name: 'MyApp',
      resolution: '240X240',
      pixelMode: 'RGB565',
    });

    const written = roundTrip(content);
    expect(written).toContain('name="MyApp"');
    expect(written).toContain('resolution="240X240"');
    expect(written).toContain('pixelMode="RGB565"');
    expect(written).not.toContain('<project></project>');
    expect(written).not.toContain('_text=');
  });

  it('keeps child-element <author> fields too', () => {
    const content = docWith(`    <author>
      <name>Ada</name>
      <email>ada@example.com</email>
    </author>
`);

    const doc = new HmlParser().parse(content, 'home.hml');
    expect(doc.meta.author).toEqual({ name: 'Ada', email: 'ada@example.com' });
    expect(roundTrip(content)).toContain('name="Ada"');
  });

  it('keeps the attribute form unchanged (spec form)', () => {
    const content = docWith(
      `    <project name="MyApp" appId="com.example.app" resolution="240X240" pixelMode="RGB565" />\n`
    );

    const written = roundTrip(content);
    expect(written).toContain(
      '<project name="MyApp" appId="com.example.app" resolution="240X240" pixelMode="RGB565" />'
    );
    expect(written).not.toContain('_text=');
  });

  it('still returns plain text for text-only elements such as <title>', () => {
    const content = docWith('');
    const doc = new HmlParser().parse(content, 'home.hml');
    expect(doc.meta.title).toBe('meta fixture');
    expect(roundTrip(content)).toContain('<title>meta fixture</title>');
  });

  it('does not turn an element\'s indentation into a _text attribute', () => {
    // <author> 只有属性、内部仅剩换行：修复前会写出 _text="\n  " 这种假属性
    const content = docWith(`    <author name="Ada">
    </author>
`);
    const written = roundTrip(content);
    expect(written).toContain('<author name="Ada" />');
    expect(written).not.toContain('_text=');
  });

  it('is idempotent across a second round-trip', () => {
    const content = docWith(`    <project>
      <name>MyApp</name>
      <resolution>240X240</resolution>
    </project>
`);
    const once = roundTrip(content);
    expect(roundTrip(once)).toBe(once);
  });
});
