/**
 * 浏览器快速预览的 HML 预处理：
 * - localizeHml 与代码生成取同一份文本（activeLocale → defaultLocale → text）；
 * - PreviewGapCollector 只报告 HML 运行时缺失、生成代码会表现出来的内容；
 * - fontRequirementsCovered 判断已转换字体能否显示保存后的文本。
 */
import { PreviewGapCollector, fontRequirementsCovered, fontRequirementsOf, localizeHml } from '../../simulation/HmlPreviewPrep';
import { parseTagAttributes, decodeXmlEntities } from '../../hml/tagScan';
import type { I18nCatalog } from '../../project-i18n/types';

const catalog: I18nCatalog = {
  version: 1,
  defaultLocale: 'en-US',
  locales: ['en-US', 'zh-CN'],
  activeLocale: 'zh-CN',
  strings: {
    'home.title': { 'en-US': 'Home', 'zh-CN': '首页 & "主"' },
    'only.en': { 'en-US': 'English only' },
  },
};

describe('parseTagAttributes', () => {
  it('reads double and single quoted values and decodes entities', () => {
    const attrs = parseTagAttributes(` id="a" text='x &gt; y' title="&#39;q&#x27;"`);
    expect(attrs.get('id')).toBe('a');
    expect(attrs.get('text')).toBe('x > y');
    expect(attrs.get('title')).toBe("'q'");
  });

  it('keeps the first of duplicated attributes', () => {
    expect(parseTagAttributes(' a="1" a="2"').get('a')).toBe('1');
  });

  it('leaves unknown entities untouched', () => {
    expect(decodeXmlEntities('&nbsp;&amp;')).toBe('&nbsp;&');
  });
});

describe('localizeHml', () => {
  it('replaces label text with the active locale and escapes it', () => {
    const out = localizeHml('<hg_label id="l" text="Home" i18nKey="home.title" x="1"/>', catalog);
    expect(out).toBe('<hg_label id="l" text="首页 &amp; &quot;主&quot;" i18nKey="home.title" x="1"/>');
  });

  it('falls back to the default locale and adds text when it is missing', () => {
    const out = localizeHml("<hg_label i18nKey='only.en' id='l'/>", catalog);
    expect(out).toBe(`<hg_label text="English only" i18nKey='only.en' id='l'/>`);
  });

  it('keeps text for unknown keys, other tags and commented-out labels', () => {
    const src = '<!-- <hg_label i18nKey="home.title" text="c"/> -->'
      + '<hg_label text="keep" i18nKey="missing"/><hg_time_label i18nKey="home.title" text="T"/>';
    expect(localizeHml(src, catalog)).toBe(src);
  });

  it('does not touch an attribute that only ends with "text"', () => {
    const out = localizeHml('<hg_label alttext="a" i18nKey="home.title"/>', catalog);
    expect(out).toBe('<hg_label text="首页 &amp; &quot;主&quot;" alttext="a" i18nKey="home.title"/>');
  });
});

describe('PreviewGapCollector', () => {
  const gapsOf = (hml: string) => {
    const collector = new PreviewGapCollector();
    collector.scan(hml);
    return collector.list().map(g => `${g.kind}:${g.name}:${g.count}`);
  };

  it('reports components the runtime cannot create', () => {
    expect(gapsOf('<hg_view id="v"><hg_svg id="s"/><hg_svg id="t"/><hg_label id="l"/></hg_view>'))
      .toEqual(['component:hg_svg:2']);
  });

  it('reports C functions referenced by actions, handlers, timers and attributes', () => {
    const timers = JSON.stringify([
      { id: 't0', mode: 'custom', callback: 'tick_cb', enabled: true },
      { id: 't1', mode: 'preset', segments: [] },
    ]).replace(/"/g, '&quot;');
    const hml = `<hg_view id="v" switchInFunctionName="on_in">
      <events><event type="onMessage" message="m" handler="msg_cb"><action type="callFunction" functionName="do_it"/></event></events>
      <hg_button id="b" clickCallback="btn_cb" imageOn="a.png" imageOff="b.png"/>
      <hg_rect id="r" timers="${timers}"/>
      <hg_streaming id="s" transporter="gui_stream_transport_get()"/>
      <hg_list id="l" useUserNoteDesign="false" userNoteDesignFunc="ignored"/>
    </hg_view>`;
    expect(gapsOf(hml)).toEqual([
      'function:btn_cb:1', 'function:do_it:1', 'function:gui_stream_transport_get:1',
      'function:msg_cb:1', 'function:on_in:1', 'function:tick_cb:1',
    ]);
  });

  it('reports attributes only when they take effect', () => {
    const hml = '<hg_label id="a" opacity="255" vAlign="TOP"/><hg_label id="b" opacity="128" vAlign="BOTTOM"/>'
      + '<hg_rect id="r" strokeWidth="0"/><hg_circle id="c" strokeWidth="2"/>'
      + '<hg_time_label id="t" timeFormat="HH:mm-split"/>';
    expect(gapsOf(hml)).toEqual([
      'attribute:hg_circle.strokeWidth:1', 'attribute:hg_label.opacity:1',
      'attribute:hg_label.vAlign=BOTTOM:1', 'attribute:hg_time_label.timeFormat=HH:mm-split:1',
    ]);
  });

  it('treats a legacy timer label as a missing component', () => {
    expect(gapsOf('<hg_label id="a" isTimerLabel="true"/>')).toEqual(['component:hg_timer_label:1']);
  });
});

describe('fontRequirementsCovered', () => {
  const label = (text: string, extra = '') => `<hg_label fontFile="/f.ttf" fontSize="20" text="${text}"${extra}/>`;

  it('accepts text made of already converted characters', () => {
    const converted = fontRequirementsOf([label('Normal')]);
    expect(fontRequirementsCovered(converted, fontRequirementsOf([label('moral')]))).toBe(true);
  });

  it('rejects new characters, sizes, i18n keys and character sets', () => {
    const converted = fontRequirementsOf([label('Normal')]);
    expect(fontRequirementsCovered(converted, fontRequirementsOf([label('Zebra')]))).toBe(false);
    expect(fontRequirementsCovered(converted, fontRequirementsOf([label('Normal').replace('20', '22')]))).toBe(false);
    expect(fontRequirementsCovered(converted, fontRequirementsOf([label('Normal', ' i18nKey="k"')]))).toBe(false);
    expect(fontRequirementsCovered(converted, fontRequirementsOf([label('Normal', ` characterSets='[]'`)]))).toBe(false);
  });

  it('groups vector fonts regardless of size', () => {
    const converted = fontRequirementsOf([label('ab', ' fontType="vector"')]);
    const bigger = label('ba', ' fontType="vector"').replace('20', '48');
    expect(fontRequirementsCovered(converted, fontRequirementsOf([bigger]))).toBe(true);
  });
});
