/**
 * 预置字符集 / 代码页清单（随插件一起分发）
 *
 * 这些文件位于插件安装目录：
 *   - charset:  tools/font-converter/charset/*.cst   （file 类型）
 *   - CodePage: tools/font-converter/CodePage/CP*     （codepage 类型）
 *
 * 本模块同时被 Webview（React，DefaultProperties）与扩展端
 * （ToolsPanelHtml / CharsetSourceResolver）引用，因此必须是
 * 纯数据 + 纯函数，禁止 import vscode / fs / path 等运行时依赖。
 *
 * ⚠️ 下拉里列出的是「精选子集」，物理文件仍由 .vscodeignore 全量打包
 *    （charset/** + 常用 CodePage）。从下拉删除某项不影响已打包文件，旧工程
 *    里存的标识符（即便是被移除的项）仍能被 CharsetSourceResolver 正常解析，
 *    向后兼容。注意：CP*.cst 不放进 .cst 下拉——它们与 CodePage 下拉的 CP*
 *    等价（同一字符集的两种表示），统一从 CodePage 选，避免重复与混淆。
 *    新增预置文件时仍须同步 .vscodeignore 的打包白名单，否则会出现
 *    “下拉里能选、但文件没进包、构建时缺字” 的情况。
 */

export interface CharsetPreset {
  /** 存入 HML / conversion.json 的稳定标识符（跨机器、跨插件版本不变） */
  id: string;
  /** 双语显示名 */
  label: { en: string; zh: string };
}

/**
 * 预置 .cst 字符集（对应 file 类型）。id = charset 目录下的文件名。
 * 只收录「有名字的标准字符集」；CP*.cst 不收（与 CodePage 下拉重复，见上注）；
 * UNICODE.cst 不收（全 BMP 码点，嵌入式一键选会撑爆字库，是脚枪）。
 * 这两类文件仍随包分发，旧工程已存的标识符可正常解析。
 */
export const PRESET_CHARSETS: CharsetPreset[] = [
  { id: 'ASCII.cst', label: { en: 'ASCII (Basic Latin)', zh: 'ASCII（基本拉丁）' } },
  { id: 'GB2312.cst', label: { en: 'GB2312 (Simplified Chinese)', zh: 'GB2312（简体中文）' } },
  { id: 'GB2312-8K.cst', label: { en: 'GB2312 8K (Common Simplified Chinese)', zh: 'GB2312-8K（简体中文常用字）' } },
  { id: 'GBK.cst', label: { en: 'GBK (Simplified Chinese Extended)', zh: 'GBK（简体中文扩展）' } },
  { id: 'KSX1001.cst', label: { en: 'KS X 1001 (Korean)', zh: 'KS X 1001（韩文）' } },
  { id: 'ISO8859-1.cst', label: { en: 'ISO 8859-1 (Western European)', zh: 'ISO 8859-1（西欧 Latin-1）' } },
  { id: 'KOI8-R.cst', label: { en: 'KOI8-R (Russian)', zh: 'KOI8-R（俄文）' } },
  { id: 'IBM860.cst', label: { en: 'IBM860 (Portuguese DOS)', zh: 'IBM860（葡萄牙文 DOS）' } },
];

/** 预置 CodePage（对应 codepage 类型）。id = CP 名 */
export const PRESET_CODEPAGES: CharsetPreset[] = [
  { id: 'CP936', label: { en: 'CP936 (Simplified Chinese GBK)', zh: 'CP936（简体中文 GBK）' } },
  { id: 'CP950', label: { en: 'CP950 (Traditional Chinese Big5)', zh: 'CP950（繁体中文 Big5）' } },
  { id: 'CP932', label: { en: 'CP932 (Japanese Shift-JIS)', zh: 'CP932（日文 Shift-JIS）' } },
  { id: 'CP949', label: { en: 'CP949 (Korean UHC)', zh: 'CP949（韩文 UHC）' } },
  { id: 'CP1250', label: { en: 'CP1250 (Central European)', zh: 'CP1250（中欧）' } },
  { id: 'CP1251', label: { en: 'CP1251 (Cyrillic)', zh: 'CP1251（西里尔）' } },
  { id: 'CP1252', label: { en: 'CP1252 (Western European)', zh: 'CP1252（西欧）' } },
  { id: 'CP1253', label: { en: 'CP1253 (Greek)', zh: 'CP1253（希腊文）' } },
  { id: 'CP1254', label: { en: 'CP1254 (Turkish)', zh: 'CP1254（土耳其文）' } },
  { id: 'CP1255', label: { en: 'CP1255 (Hebrew)', zh: 'CP1255（希伯来文）' } },
  { id: 'CP1256', label: { en: 'CP1256 (Arabic)', zh: 'CP1256（阿拉伯文）' } },
  { id: 'CP1257', label: { en: 'CP1257 (Baltic)', zh: 'CP1257（波罗的海）' } },
  { id: 'CP1258', label: { en: 'CP1258 (Vietnamese)', zh: 'CP1258（越南文）' } },
  { id: 'CP874', label: { en: 'CP874 (Thai)', zh: 'CP874（泰文）' } },
  { id: 'CP437', label: { en: 'CP437 (DOS Latin US)', zh: 'CP437（DOS 拉丁-美国）' } },
];

/**
 * 判断 file / codepage 的 value 是否为“预置标识符”（而非用户自定义文件路径）。
 * 约定：不含路径分隔符即视为预置标识符（如 "GBK.cst"、"CP936"）；
 * 含 "/" 或 "\\" 的视为用户自定义路径，走旧的路径解析逻辑（向后兼容）。
 */
export function isPresetValue(value: string | undefined | null): boolean {
  return !!value && !value.includes('/') && !value.includes('\\');
}

/**
 * 取预置项显示名。
 * @param list PRESET_CHARSETS 或 PRESET_CODEPAGES
 * @param id   预置标识符
 * @param lang 当前语言（以 "zh" 开头取中文，否则英文）
 * @returns 友好显示名；未知 id 回退为 id 本身
 */
export function getPresetLabel(list: CharsetPreset[], id: string, lang: string): string {
  const preset = list.find((p) => p.id === id);
  if (!preset) {
    return id;
  }
  const useZh = !!lang && lang.toLowerCase().startsWith('zh');
  return useZh ? preset.label.zh : preset.label.en;
}
