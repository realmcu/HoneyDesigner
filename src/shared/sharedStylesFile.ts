/**
 * styles.json 读写。
 *
 * 与 sharedStyles.ts 分开：合并/校验是纯函数（浏览器版也用），这里带 fs 依赖，
 * 只给宿主侧（插件与浏览器宿主）调用。
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    SharedStyleLibrary,
    SHARED_STYLES_RELATIVE_PATH,
    createEmptyStyleLibrary,
    normalizeStyleLibrary,
} from './sharedStyles';

export interface LoadedStyleLibrary {
    library: SharedStyleLibrary;
    /** 文件是否存在；不存在时 library 为空库，设计器据此提示「未创建样式文件」 */
    exists: boolean;
    errors: string[];
}

/**
 * 读取工程共享样式。文件缺失或损坏时返回空库，不抛异常：
 * 样式文件坏了不应该让工程打不开。
 */
export function loadSharedStyleLibrary(projectRoot: string | undefined): LoadedStyleLibrary {
    if (!projectRoot) {
        return { library: createEmptyStyleLibrary(), exists: false, errors: [] };
    }
    const filePath = path.join(projectRoot, SHARED_STYLES_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return { library: createEmptyStyleLibrary(), exists: false, errors: [] };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const { library, errors } = normalizeStyleLibrary(parsed);
        return { library, exists: true, errors };
    } catch (error) {
        return {
            library: createEmptyStyleLibrary(),
            exists: true,
            errors: [`styles.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`],
        };
    }
}

/** 写出 styles.json；空库且文件原本不存在时不创建文件 */
export function saveSharedStyleLibrary(projectRoot: string, library: SharedStyleLibrary): void {
    const filePath = path.join(projectRoot, SHARED_STYLES_RELATIVE_PATH);
    if (library.styles.length === 0 && !fs.existsSync(filePath)) {
        return;
    }
    fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, styles: library.styles }, null, 2)}\n`, 'utf8');
}
