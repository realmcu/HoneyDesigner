import * as fs from 'fs';

/**
 * 仅在内容发生变化时才写入文件。
 *
 * 背景:代码生成器每次都会重新产出文件内容,但多数情况下产物与磁盘上已有的完全一致。
 * 直接 `fs.writeFileSync` 会刷新文件的 mtime,使 SCons 等基于时间戳的构建系统误判文件
 * 已改动而触发无谓的重新编译。此函数在写入前先比对现有内容,相同则跳过写入——
 * 既不刷新 mtime(避免多余重编译),也不产生 git 改动(git 本就按内容比对)。
 *
 * 仅用于文本文件(编码可比较)。二进制产物请勿经此函数写入。
 *
 * @param filePath 目标文件路径
 * @param content  待写入的文本内容
 * @param encoding 文本编码,默认 'utf-8'
 * @returns 是否实际写入(true = 内容有变化已写入;false = 内容相同已跳过)
 */
export function writeFileIfChanged(
    filePath: string,
    content: string,
    encoding: BufferEncoding = 'utf-8'
): boolean {
    try {
        if (fs.existsSync(filePath) && fs.readFileSync(filePath, encoding) === content) {
            return false;
        }
    } catch {
        // 读取现有文件失败(权限/编码等)时,退回到正常写入
    }
    fs.writeFileSync(filePath, content, encoding);
    return true;
}
