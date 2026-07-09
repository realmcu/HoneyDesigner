import * as path from 'path';
import { writeFileIfChanged } from '../utils/fileWrite';

/**
 * SConscript 生成器
 */
export class SConscriptGenerator {
    /**
     * 为指定目录生成 SConscript 文件
     */
    static generate(targetDir: string): void {
        const content = `from building import *
import os

cwd = GetCurrentDir()
src = []
for root, dirs, files in os.walk(cwd):
    for f in files:
        if f.endswith('.c'):
            src.append(os.path.join(root, f))

CPPPATH = [cwd]
for root, dirs, files in os.walk(cwd):
    CPPPATH.append(root)

group = DefineGroup('project', src, depend=[''], CPPPATH=CPPPATH)
Return('group')
`;
        const sconscriptPath = path.join(targetDir, 'SConscript');
        writeFileIfChanged(sconscriptPath, content);
    }
}
