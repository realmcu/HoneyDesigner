/**
 * 浏览器版文件选择
 *
 * 宿主代码通过 vscode.window.showOpenDialog 拿到「本机文件路径」后再复制进工程。
 * 浏览器里拿不到本机路径，因此先把用户选中的文件读入内存文件系统的暂存目录，
 * 再把暂存路径交回宿主代码，后续复制逻辑保持不变。
 */
import * as path from 'path';
import * as fs from '../shims/fs';

const STAGING_ROOT = '/__picked';
const STAGING_TTL_MS = 10 * 60 * 1000;

let stagingSeq = 0;

export interface PickFilesOptions {
    directory: boolean;
    multiple: boolean;
    /** 不带点的扩展名列表；为空表示不限制 */
    extensions: string[];
    label?: string;
}

function chooseFiles(options: PickFilesOptions): Promise<File[] | undefined> {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = options.multiple || options.directory;
        if (options.directory) {
            input.setAttribute('webkitdirectory', '');
        } else if (options.extensions.length > 0) {
            input.accept = options.extensions.map(ext => `.${ext}`).join(',');
        }
        input.style.display = 'none';

        let settled = false;
        const finish = (files: File[] | undefined) => {
            if (settled) {
                return;
            }
            settled = true;
            input.remove();
            resolve(files && files.length > 0 ? files : undefined);
        };

        input.addEventListener('change', () => finish(input.files ? Array.from(input.files) : undefined));
        input.addEventListener('cancel', () => finish(undefined));
        document.body.appendChild(input);
        input.click();
    });
}

/**
 * 弹出浏览器文件选择框，返回暂存后的内存文件系统路径。
 * 选择目录时返回目录路径（目录结构保持不变）。
 */
export async function pickFiles(options: PickFilesOptions): Promise<string[] | undefined> {
    const files = await chooseFiles(options);
    if (!files) {
        return undefined;
    }

    const stagingDir = path.posix.join(STAGING_ROOT, String(++stagingSeq));
    const picked: string[] = [];

    for (const file of files) {
        const relative = options.directory && file.webkitRelativePath ? file.webkitRelativePath : file.name;
        const target = path.posix.join(stagingDir, relative);
        fs.mkdirSync(path.posix.dirname(target), { recursive: true });
        fs.writeFileSync(target, new Uint8Array(await file.arrayBuffer()));
        if (!options.directory) {
            picked.push(target);
        }
    }

    if (options.directory) {
        const topLevel = files[0].webkitRelativePath.split('/')[0];
        picked.push(path.posix.join(stagingDir, topLevel));
    }

    // 暂存文件只在宿主复制进工程之前有用，稍后清理以释放内存
    setTimeout(() => fs.rmSync(stagingDir, { recursive: true, force: true }), STAGING_TTL_MS);
    return picked;
}
