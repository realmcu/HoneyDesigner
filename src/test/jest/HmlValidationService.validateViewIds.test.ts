import { HmlValidationService, ValidationWarning } from '../../services/HmlValidationService';

/**
 * HmlValidationService.validateViewIds 回归测试。
 *
 * validateViewIds 是私有方法，但必须对**原始 XML**做检测（HmlParser 解析后
 * 组件树上 id 恒为非空——基于组件树检测是死代码，见方法注释）。通过 bracket
 * 访问直接单测该私有方法，覆盖设计任务点名的四种场景：
 *   1. 缺 id 的 hg_view → 报 warning。
 *   2. 有 id 的 hg_view → 不报。
 *   3. 注释掉的 <hg_view>（含缺 id）→ 不误报。
 *   4. 属性值内含 '>'（如 name="a > b"）的合法 XML → 不因正则在首个 '>' 截断
 *      标签而误判缺 id（HmlValidationService.ts:435-441 的已知坑）。
 */
describe('HmlValidationService.validateViewIds', () => {
  function warningsFor(hmlContent: string): ValidationWarning[] {
    const service = new HmlValidationService();
    const warnings: ValidationWarning[] = [];
    // 私有方法，测试内直接调用（比通过 validateHml 间接触发更聚焦、噪音更少）
    (service as any).validateViewIds(hmlContent, warnings);
    return warnings;
  }

  function bestPracticeCount(warnings: ValidationWarning[]): number {
    return warnings.filter(w => w.type === 'best-practice').length;
  }

  it('warns when hg_view has no id', () => {
    const content = `<hg_view x="0" y="0" w="240" h="240" entry="true"></hg_view>`;
    const warnings = warningsFor(content);
    expect(bestPracticeCount(warnings)).toBe(1);
  });

  it('does not warn when hg_view has an id', () => {
    const content = `<hg_view id="view_main" x="0" y="0" w="240" h="240" entry="true"></hg_view>`;
    const warnings = warningsFor(content);
    expect(bestPracticeCount(warnings)).toBe(0);
  });

  it('does not warn about an id-less hg_view inside an XML comment', () => {
    const content = `
      <!-- disabled screen, intentionally left without an id:
        <hg_view x="0" y="0" w="240" h="240"></hg_view>
      -->
      <hg_view id="view_main" x="0" y="0" w="240" h="240" entry="true"></hg_view>
    `;
    const warnings = warningsFor(content);
    expect(bestPracticeCount(warnings)).toBe(0);
  });

  it('flags a genuinely id-less hg_view even when a commented-out one precedes it', () => {
    const content = `
      <!-- <hg_view x="0" y="0" w="240" h="240"></hg_view> -->
      <hg_view x="0" y="0" w="240" h="240" entry="true"></hg_view>
    `;
    const warnings = warningsFor(content);
    expect(bestPracticeCount(warnings)).toBe(1);
  });

  it('does not false-positive on an attribute value containing ">" (quoted content ends the tag correctly)', () => {
    const content = `<hg_view id="view_main" name="a > b" x="0" y="0" w="240" h="240" entry="true"></hg_view>`;
    const warnings = warningsFor(content);
    expect(bestPracticeCount(warnings)).toBe(0);
  });

  it('still detects a missing id even when a sibling attribute value contains ">"', () => {
    const content = `<hg_view name="a > b" x="0" y="0" w="240" h="240" entry="true"></hg_view>`;
    const warnings = warningsFor(content);
    expect(bestPracticeCount(warnings)).toBe(1);
  });

  it('handles multiple hg_view tags independently', () => {
    const content = `
      <hg_view id="view_a" x="0" y="0" w="1" h="1"></hg_view>
      <hg_view x="0" y="0" w="1" h="1"></hg_view>
      <hg_view id="view_c" x="0" y="0" w="1" h="1"></hg_view>
    `;
    const warnings = warningsFor(content);
    expect(bestPracticeCount(warnings)).toBe(1);
  });
});
