import * as path from 'path';

/**
 * Romfs 配置工具类
 * 统一管理 romfs 文件名和变量名的生成规则
 */
export class RomfsConfig {
    private static readonly ROMFS_FILENAME = 'app_romfs.c';

    /**
     * 获取 romfs 输出文件名
     */
    static getFileName(): string {
        return this.ROMFS_FILENAME;
    }

    /**
     * 获取 romfs 二进制输出文件名（在基础名后追加基地址后缀）
     * 例如基地址 0x70536400 → app_romfs_0x70536400.bin
     * 若未提供基地址，则回退到不带后缀的 app_romfs.bin
     */
    static getBinFileName(baseAddr?: string): string {
        const addr = (baseAddr || '').trim();
        return addr ? `app_romfs_${addr}.bin` : 'app_romfs.bin';
    }

    /**
     * 判断文件名是否为 romfs 二进制产物
     * 匹配 app_romfs.bin 以及带基地址后缀的 app_romfs_<addr>.bin
     */
    static isBinFileName(fileName: string): boolean {
        return /^app_romfs(_.*)?\.bin$/.test(fileName);
    }

    /**
     * 根据 mkromfs_for_honeygui.py 的逻辑计算 romfs root 变量名
     * 规则：去掉扩展名，转换为合法 C 标识符，加 _root 后缀
     */
    static getRootName(): string {
        const nameWithoutExt = path.basename(this.ROMFS_FILENAME, path.extname(this.ROMFS_FILENAME));
        const rootName = nameWithoutExt.replace(/[^a-zA-Z0-9_]/g, '_') + '_root';
        return rootName;
    }
}
