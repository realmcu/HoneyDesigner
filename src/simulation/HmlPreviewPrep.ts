/**
 * 为 HML 运行时准备工程界面文件，并找出快速预览中看不到的内容。
 *
 * 快速预览由预编译引擎直接解析 ui/*.xml。运行时不读 i18n 目录，所以这里把带 i18nKey 的
 * 标签文本替换为当前语言的译文，与代码生成（LabelGenerator.resolveCodegenText）取同一份
 * 文本；其余内容保持原样。
 *
 * 检查只针对运行时缺失的能力（HmlPreviewSupport），结果用于在仿真窗口提示用户改用完整仿真。
 */
import type { I18nCatalog } from '../project-i18n/types';
import { resolveLocalizedText } from '../project-i18n/catalog';
import { scanOpenTags, parseTagAttributes } from '../hml/tagScan';
import {
    PREVIEW_COMPONENTS,
    PREVIEW_FUNCTION_ATTRIBUTES,
    PREVIEW_UNSUPPORTED_ATTRIBUTES,
    PREVIEW_UNSUPPORTED_VALUES,
    isActiveAttribute,
} from './HmlPreviewSupport';

/** 快速预览中缺失的一项内容；同名内容合并计数 */
export interface PreviewGap {
    /** component：组件不显示；attribute：属性不生效；function：工程 C 函数不执行 */
    kind: 'component' | 'attribute' | 'function';
    /** 组件标签、"标签.属性[=取值]" 或 C 函数名 */
    name: string;
    count: number;
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeXmlAttribute(value: string): string {
    return value.replace(/[&<>"']/g, ch => XML_ESCAPES[ch]);
}

/** 注释内容替换为等长空格：标签偏移保持不变，注释里的标签不会被扫描到 */
function blankComments(content: string): string {
    return content.replace(/<!--[\s\S]*?-->/g, comment => ' '.repeat(comment.length));
}

/**
 * 把带 i18nKey 的 hg_label 的 text 换成当前语言的文本（与代码生成一致：activeLocale →
 * defaultLocale → 原 text）。没有需要替换的标签时原样返回。
 */
export function localizeHml(content: string, catalog: I18nCatalog | undefined): string {
    if (!catalog || Object.keys(catalog.strings).length === 0) {
        return content;
    }
    const locale = catalog.activeLocale ?? catalog.defaultLocale;
    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (const tag of scanOpenTags(blankComments(content), 'hg_label')) {
        const attrs = parseTagAttributes(tag.attrsText);
        const key = attrs.get('i18nKey')?.trim();
        if (!key) {
            continue;
        }
        const fallback = attrs.get('text') ?? '';
        const text = resolveLocalizedText(catalog, key, locale, fallback).text;
        if (text === fallback) {
            continue;
        }
        const replacement = `text="${escapeXmlAttribute(text)}"`;
        const attrsStart = tag.start + 1 + tag.name.length;
        const textAttr = /(\s)text\s*=\s*("[^"]*"|'[^']*')/.exec(tag.attrsText);
        if (textAttr) {
            const start = attrsStart + textAttr.index + textAttr[1].length;
            edits.push({ start, end: attrsStart + textAttr.index + textAttr[0].length, text: replacement });
        } else {
            edits.push({ start: attrsStart, end: attrsStart, text: ` ${replacement}` });
        }
    }
    let result = content;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }
    return result;
}

/**
 * 字体转换的输入：每个字体组（与 BuildCore.groupLabelConfigsByFont 的分组一致）用到的
 * 字符、i18nKey 和附加字符集。保存 HML 后若出现转换时没有的内容，字体必须重新转换。
 */
export type FontRequirements = Map<string, Set<string>>;

const FONT_LABEL_TAGS = new Set(['hg_label', 'hg_time_label', 'hg_timer_label']);

export function fontRequirementsOf(contents: Iterable<string>): FontRequirements {
    const groups: FontRequirements = new Map();
    for (const content of contents) {
        for (const tag of scanOpenTags(blankComments(content))) {
            if (!FONT_LABEL_TAGS.has(tag.name)) {
                continue;
            }
            const attrs = parseTagAttributes(tag.attrsText);
            const fontFile = attrs.get('fontFile');
            if (!fontFile) {
                continue;
            }
            const key = attrs.get('fontType') === 'vector'
                ? `${fontFile}|vector`
                : `${fontFile}|${attrs.get('fontSize') ?? '16'}|${attrs.get('renderMode') ?? '4'}`;
            let tokens = groups.get(key);
            if (!tokens) {
                tokens = new Set();
                groups.set(key, tokens);
            }
            for (const ch of attrs.get('text') ?? '') {
                tokens.add(`c:${ch}`);
            }
            const i18nKey = attrs.get('i18nKey')?.trim();
            if (i18nKey) {
                tokens.add(`k:${i18nKey}`);
            }
            const charsets = attrs.get('characterSets');
            if (charsets) {
                tokens.add(`s:${charsets}`);
            }
        }
    }
    return groups;
}

/** converted 转换出的字体是否已包含 next 需要的全部内容（少了字符不必重新转换） */
export function fontRequirementsCovered(converted: FontRequirements, next: FontRequirements): boolean {
    for (const [key, tokens] of next) {
        const have = converted.get(key);
        if (!have) {
            return false;
        }
        for (const token of tokens) {
            if (!have.has(token)) {
                return false;
            }
        }
    }
    return true;
}

/** 汇总一个工程所有 HML 中快速预览缺失的内容 */
export class PreviewGapCollector {
    private readonly gaps = new Map<string, PreviewGap>();

    scan(content: string): void {
        for (const tag of scanOpenTags(blankComments(content))) {
            const attrs = parseTagAttributes(tag.attrsText);
            if (tag.name === 'event') {
                // onMessage 的处理函数
                this.addFunction(attrs.get('handler'));
            } else if (tag.name === 'action') {
                if (attrs.get('type') === 'callFunction') {
                    this.addFunction(attrs.get('functionName'));
                }
            } else if (tag.name.startsWith('hg_')) {
                this.scanComponent(tag.name, attrs);
            }
        }
    }

    list(): PreviewGap[] {
        const order: PreviewGap['kind'][] = ['component', 'function', 'attribute'];
        return [...this.gaps.values()].sort((a, b) =>
            order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name));
    }

    private add(kind: PreviewGap['kind'], name: string): void {
        const key = `${kind}:${name}`;
        const gap = this.gaps.get(key);
        if (gap) {
            gap.count++;
        } else {
            this.gaps.set(key, { kind, name, count: 1 });
        }
    }

    /** 函数名或调用表达式（如 "gui_stream_transport_get()"）；NULL 表示未设置 */
    private addFunction(name: string | undefined): void {
        const fn = name?.trim().replace(/\s*\(.*$/, '');
        if (fn && fn !== 'NULL') {
            this.add('function', fn);
        }
    }

    private scanComponent(tag: string, attrs: Map<string, string>): void {
        if (!PREVIEW_COMPONENTS.has(tag)) {
            this.add('component', tag);
            return;
        }
        // 旧版计时标签保存为 hg_label isTimerLabel="true"，运行时把它当作静态文本
        if (tag === 'hg_label' && attrs.get('isTimerLabel') === 'true') {
            this.add('component', 'hg_timer_label');
        }
        for (const name of PREVIEW_UNSUPPORTED_ATTRIBUTES[tag] ?? []) {
            const value = attrs.get(name);
            if (value !== undefined && isActiveAttribute(name, value)) {
                this.add('attribute', `${tag}.${name}`);
            }
        }
        for (const [name, values] of Object.entries(PREVIEW_UNSUPPORTED_VALUES[tag] ?? {})) {
            const value = attrs.get(name);
            if (value !== undefined && values.includes(value)) {
                this.add('attribute', `${tag}.${name}=${value}`);
            }
        }
        for (const name of PREVIEW_FUNCTION_ATTRIBUTES[tag] ?? []) {
            this.addFunction(attrs.get(name));
        }
        if (tag === 'hg_list' && attrs.get('useUserNoteDesign') === 'true') {
            this.addFunction(attrs.get('userNoteDesignFunc'));
        }
        this.scanTimers(attrs.get('timers'));
    }

    /** custom 定时器调用工程 C 函数；preset 动画由运行时解释执行 */
    private scanTimers(raw: string | undefined): void {
        let timers: unknown;
        try {
            timers = raw ? JSON.parse(raw) : undefined;
        } catch {
            return;
        }
        if (!Array.isArray(timers)) {
            return;
        }
        for (const timer of timers as Array<Record<string, unknown> | null>) {
            if (timer?.mode === 'custom' && typeof timer.callback === 'string') {
                this.addFunction(timer.callback);
            }
        }
    }
}
