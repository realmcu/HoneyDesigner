/**
 * AI 助手的提示词与结果校验
 *
 * - 系统提示：HML 规范全文（与扩展分发到工程里的是同一份）+ 输出格式约定
 * - 上下文：当前 HML 全文、分辨率、引擎、资源清单、选中组件
 * - 回复里取出完整 HML，用与 /api/validate-hml 相同的校验服务检查，
 *   再补一项校验服务不查、但会让仿真编译失败的检查：引用的资源文件是否存在
 */
import * as path from 'path';
import * as fs from '../shims/fs';
import { HmlValidationService } from '../../services/HmlValidationService';
import { loadProjectI18nCatalog } from '../../project-i18n/files';
import hmlSpec from '../../../vibe-designer/skills/honeygui-designer/references/hml-spec.md?raw';
import commonMistakes from '../../../vibe-designer/skills/honeygui-designer/references/common-mistakes.md?raw';

export type TargetEngine = 'honeygui' | 'lvgl';

/** 资源清单上限：再多对模型没有帮助，只会挤占上下文 */
const MAX_LISTED_ASSETS = 400;

export function buildSystemPrompt(engine: TargetEngine): string {
    return [
        'You are the AI assistant built into HoneyGUI Designer, a visual editor for embedded GUIs written in HML (an XML dialect).',
        'The user describes a change; you edit the HML file that is currently open in the designer.',
        '',
        '## Output rules',
        '- When the request needs the design to change, reply with ONE short sentence describing the change, followed by the COMPLETE new file in a single ```xml fenced block that starts with <?xml or <hml and ends with </hml>. Never send partial files or diffs.',
        '- Keep every component, id and attribute the user did not ask to change exactly as it is.',
        '- When the user only asks a question, answer briefly without a code block.',
        '- Reply in the language the user writes in.',
        '',
        '## Hard constraints',
        `- This project targets the ${engine} engine. Only use components the specification marks as ready (✓) for ${engine}; never use planned or unsupported ones.`,
        '- Image paths (src, imageOn, imageOff) must start with "assets/"; fontFile must start with "/" (relative to assets). Only reference files that appear in the asset list you are given.',
        '- Every hg_label / hg_time_label / hg_timer_label needs a fontFile that exists in the asset list.',
        '- Exactly one hg_view has entry="true" across the project; do not add or remove entry views unless asked.',
        '- Component ids must be unique, valid C identifiers (lowercase_with_underscores).',
        '',
        '## HML specification (single source of truth)',
        hmlSpec,
        '',
        '## Common mistakes to avoid',
        commonMistakes,
    ].join('\n');
}

export interface DesignContext {
    projectRoot: string;
    filePath: string;
    hml: string;
    resolution?: string;
    engine: TargetEngine;
    selectedIds: string[];
}

export function listAssets(projectRoot: string): string[] {
    const assetsDir = path.posix.join(projectRoot, 'assets');
    return fs.vfs.listFiles(assetsDir).map(file => path.posix.relative(assetsDir, file));
}

/** 当前轮的用户消息：上下文 + 需求。历史轮次只保留需求文本，避免旧 HML 反复计费 */
export function buildContextMessage(context: DesignContext, request: string): string {
    const assets = listAssets(context.projectRoot);
    const listed = assets.slice(0, MAX_LISTED_ASSETS).map(name => `- assets/${name}`);
    if (assets.length > MAX_LISTED_ASSETS) {
        listed.push(`- ... (${assets.length - MAX_LISTED_ASSETS} more)`);
    }
    return [
        '<design_context>',
        `File: ${path.posix.relative(context.projectRoot, context.filePath)}`,
        `Resolution: ${context.resolution || 'unknown'}`,
        `Target engine: ${context.engine}`,
        `Selected components: ${context.selectedIds.length > 0 ? context.selectedIds.join(', ') : '(none)'}`,
        '',
        'Assets (fontFile uses the path after "assets", e.g. /font.ttf):',
        listed.length > 0 ? listed.join('\n') : '(no assets)',
        '',
        'Current HML:',
        '```xml',
        context.hml,
        '```',
        '</design_context>',
        '',
        request,
    ].join('\n');
}

/** 取回复里的完整 HML；没有（只是回答问题）时返回 undefined */
export function extractHml(reply: string): string | undefined {
    const fenced = /```[a-zA-Z]*\s*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    let found: string | undefined;
    while ((match = fenced.exec(reply)) !== null) {
        if (/<hml[\s>]/.test(match[1]) && match[1].includes('</hml>')) {
            found = match[1];
        }
    }
    if (!found) {
        const start = reply.search(/<\?xml|<hml[\s>]/);
        const end = reply.lastIndexOf('</hml>');
        if (start >= 0 && end > start) {
            found = reply.slice(start, end + '</hml>'.length);
        }
    }
    return found ? `${found.trim()}\n` : undefined;
}

/** 回复中的代码块在对话里折叠显示 */
export function summarizeReply(reply: string, label: (lines: number) => string): string {
    return reply.replace(/```[a-zA-Z]*\s*\n?([\s\S]*?)(```|$)/g, (_all, body: string) => `\n${label(body.split('\n').length)}\n`).trim();
}

const validator = new HmlValidationService();

/** 引用了工程里不存在的资源：校验服务只查路径格式，这里补查文件 */
function missingAssetErrors(hml: string, projectRoot: string): string[] {
    const errors: string[] = [];
    const seen = new Set<string>();
    const check = (attribute: string, value: string, absolute: string) => {
        const key = `${attribute}=${value}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        if (!fs.existsSync(absolute)) {
            errors.push(`${attribute}="${value}" refers to a file that does not exist in the project assets`);
        }
    };
    for (const match of hml.matchAll(/\b(src|imageOn|imageOff)="(assets\/[^"]+)"/g)) {
        check(match[1], match[2], path.posix.join(projectRoot, match[2]));
    }
    for (const match of hml.matchAll(/\bfontFile="(\/[^"]+)"/g)) {
        check('fontFile', match[1], path.posix.join(projectRoot, 'assets', match[1]));
    }
    return errors;
}

export function validateGeneratedHml(hml: string, projectRoot: string, filePath: string): string[] {
    const i18nCatalog = loadProjectI18nCatalog(projectRoot);
    const result = validator.validateHml(hml, {
        projectRoot,
        filePath,
        i18nCatalog,
        previewLocale: i18nCatalog.activeLocale || i18nCatalog.defaultLocale,
    });
    const errors = result.errors.map(error => error.componentId ? `[${error.componentId}] ${error.message}` : error.message);
    // XML 都解析不了时资源检查没有意义
    return result.errors.some(error => error.type === 'syntax') ? errors : [...errors, ...missingAssetErrors(hml, projectRoot)];
}
