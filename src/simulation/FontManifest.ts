import * as fs from 'fs';
import * as path from 'path';

/**
 * 字体转换结果清单：记录上次转换时每个字体组覆盖了哪些码点，用于判断当前需求是否已满足。
 *
 * 桌面版之前按 HML 修改时间判断字体是否过期，改控件坐标、增删无关控件都会重转全部字体。
 * 改为按字体组比对「已转换码点 ⊇ 当前需求码点」：新增的字符若已在附加字符集（如 GB2312）
 * 范围内就不必重转，只有出现真正的新码点、更大字号或字体/字符集文件变化才重转。
 * 放在 build/ 而非 build/assets/，既不进 romfs，也不受 *.cst 清理影响。
 */
export interface FontManifestGroup {
    /** 输入指纹：字体文件、字符集文件的内容指纹 + 字号/渲染模式等转换参数 */
    fingerprint: string;
    /** 该组转换时实际请求的全部码点 */
    chars: string;
    /** 矢量字体的曲线离散精度（组内最大字号）；位图字体为 0 */
    precision: number;
}

export interface FontManifest {
    version: 1;
    groups: Record<string, FontManifestGroup>;
}

const MANIFEST_NAME = 'font-manifest.json';

export function fontManifestPath(buildDir: string): string {
    return path.join(buildDir, MANIFEST_NAME);
}

export function loadFontManifest(buildDir: string): FontManifest {
    const filePath = fontManifestPath(buildDir);
    try {
        if (!fs.existsSync(filePath)) {
            return { version: 1, groups: {} };
        }
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FontManifest;
        if (parsed?.version !== 1 || typeof parsed.groups !== 'object' || !parsed.groups) {
            return { version: 1, groups: {} };
        }
        return parsed;
    } catch {
        // 清单损坏时当作没有清单：全部重转一次，不影响正确性
        return { version: 1, groups: {} };
    }
}

export function saveFontManifest(buildDir: string, manifest: FontManifest): void {
    try {
        if (!fs.existsSync(buildDir)) {
            fs.mkdirSync(buildDir, { recursive: true });
        }
        fs.writeFileSync(fontManifestPath(buildDir), JSON.stringify(manifest, null, 2), 'utf-8');
    } catch {
        // 写清单失败只影响下次增量判断，不影响本次转换结果
    }
}

/**
 * 清单里该组已覆盖的内容是否满足当前需求。
 * 指纹不同（字体或字符集文件变了）、码点缺失、矢量精度不足都视为不满足。
 */
export function manifestCovers(
    manifest: FontManifest,
    key: string,
    fingerprint: string,
    chars: Iterable<number>,
    precision: number,
): boolean {
    const group = manifest.groups[key];
    // 手改或旧版本写坏的条目按「不满足」处理，否则这里会抛异常并让每次转换都失败
    if (!group || typeof group.fingerprint !== 'string' || typeof group.chars !== 'string'
        || group.fingerprint !== fingerprint) {
        return false;
    }
    if (precision > (group.precision ?? 0)) {
        return false;
    }
    const have = new Set<number>();
    for (const ch of group.chars) {
        const cp = ch.codePointAt(0);
        if (cp !== undefined) {
            have.add(cp);
        }
    }
    for (const cp of chars) {
        if (!have.has(cp)) {
            return false;
        }
    }
    return true;
}
