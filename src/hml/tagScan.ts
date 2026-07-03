/**
 * 尊重引号的轻量 XML 开标签扫描（非完整解析）。
 *
 * 动机：用 /<tag\b[^>]*>/ 一类正则提取开标签，属性值里出现 '>'（如
 * text="a > b"）是合法 XML，正则会在首个 '>' 处截断标签，导致其后的属性
 * （id / name 等）漏检。本工具逐字符前进并跳过引号内内容，找到真正的标签
 * 结束 '>' —— 引号内的 '>'、'<'、引号另一种类都不影响边界判定。
 *
 * 共享方：
 * - HmlValidationService.validateViewIds（hg_view 缺 id 警告，R6）
 * - NavEditService._detectRoundTripLoss（round-trip 预检的 unknownTags /
 *   nameAttributes 检测，写盘确认拦截）
 *
 * 注意：调用方需自行剔除 XML 注释（两处调用场景的注释语义不同：一个只
 * 防误报，一个要单独上报 comments 丢失类），本工具不处理 <!-- -->。
 */

/** 扫描到的一个开标签 */
export interface ScannedOpenTag {
    /** 标签名（'<' 后紧随的名字） */
    name: string;
    /**
     * 标签名之后、真正的 '>' 之前的属性文本（保留前导空白；自闭合标签含
     * 结尾 '/'）。可直接用 /\sattr\s*=/ 一类带 \s 前缀的正则匹配属性。
     */
    attrsText: string;
    /** 完整开标签原文（含 '<名字' 与结尾 '>'；未闭合标签截到内容末尾） */
    raw: string;
}

/**
 * 扫描 content 中的全部开标签（闭标签 </x>、声明 <?xml、<!DOCTYPE、注释头
 * <!-- 均不匹配标签名起始字符，天然被跳过）。
 *
 * @param content 待扫描文本（调用方已按需剔除注释）
 * @param tagName 只返回该标签名的开标签（精确匹配）；缺省返回全部。
 *                注意：即使过滤，扫描仍逐标签推进以正确跳过引号内容。
 */
export function scanOpenTags(content: string, tagName?: string): ScannedOpenTag[] {
    const tags: ScannedOpenTag[] = [];
    const startRe = /<([A-Za-z_][A-Za-z0-9_.:-]*)/g;
    let match: RegExpExecArray | null;
    while ((match = startRe.exec(content)) !== null) {
        // 从标签名结束处逐字符找真正的 '>'：引号内的 '>' 不算标签结束
        let i = startRe.lastIndex;
        let quote: '"' | "'" | null = null;
        while (i < content.length) {
            const ch = content[i];
            if (quote) {
                if (ch === quote) {
                    quote = null;
                }
            } else if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (ch === '>') {
                break;
            }
            i++;
        }
        const name = match[1];
        if (!tagName || name === tagName) {
            tags.push({
                name,
                attrsText: content.slice(startRe.lastIndex, i),
                raw: content.slice(match.index, Math.min(i + 1, content.length)),
            });
        }
        // 从标签结束处继续找下一个，避免重复扫描引号内容
        startRe.lastIndex = Math.min(i + 1, content.length);
    }
    return tags;
}
