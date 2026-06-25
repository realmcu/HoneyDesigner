import * as fs from 'fs';
import * as path from 'path';
import { ProjectUtils } from './ProjectUtils';
import { isPresetValue } from '../common/charsetPresets';

/**
 * 字符集来源（与 tools/font-converter 的 CharacterSetSource 结构兼容）
 */
export interface CharsetSourceLike {
    type: string; // 'range' | 'string' | 'file' | 'codepage'
    value: string;
}

/**
 * 字符集来源解析器
 *
 * 负责把 file / codepage 类型的「预置标识符」（如 "GBK.cst"、"CP936"）解析成
 * 插件安装目录内的绝对路径，供字体转换器消费。
 *
 * 设计要点：
 * - 预置标识符不含路径分隔符（见 isPresetValue），存入 HML / conversion.json 后
 *   跨机器、跨插件版本都稳定，解析时由本工具按 extensionRoot 还原物理路径。
 * - 用户自定义文件（含路径分隔符）原样透传，由下游按 basePath 解析，向后兼容。
 * - 找不到对应预置文件时同样原样透传，让下游报「缺字 / 文件不存在」而非在此静默吞掉。
 */
export class CharsetSourceResolver {
    /**
     * 规范化 CodePage 名称（"936" -> "CP936"，"cp936" -> "CP936"）
     */
    private static normalizeCodePageName(value: string): string {
        const upper = value.toUpperCase();
        return upper.startsWith('CP') ? upper : `CP${upper}`;
    }

    /**
     * 解析单个字符集来源：将预置标识符还原为插件内绝对路径。
     * 非预置（range/string、或自定义路径）原样返回。
     */
    static resolve(source: CharsetSourceLike): CharsetSourceLike {
        if (!source || !source.value) {
            return source;
        }

        if (source.type === 'file' && isPresetValue(source.value)) {
            const candidate = path.join(ProjectUtils.getCharsetDir(), source.value);
            if (fs.existsSync(candidate)) {
                return { type: 'file', value: candidate };
            }
            return source;
        }

        if (source.type === 'codepage' && isPresetValue(source.value)) {
            const cpName = this.normalizeCodePageName(source.value);
            const candidate = path.join(ProjectUtils.getCodePageDir(), cpName);
            if (fs.existsSync(candidate)) {
                return { type: 'codepage', value: candidate };
            }
            return source;
        }

        return source;
    }

    /**
     * 批量解析（保持顺序）
     */
    static resolveAll(sources: CharsetSourceLike[]): CharsetSourceLike[] {
        if (!Array.isArray(sources)) {
            return sources;
        }
        return sources.map((s) => this.resolve(s));
    }
}
