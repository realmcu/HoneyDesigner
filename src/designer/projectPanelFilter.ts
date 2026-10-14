import { ProjectUtils } from '../utils/ProjectUtils';
import { PendingWriteRegistry } from './PendingWriteRegistry';

/**
 * 选出属于指定项目根目录的面板，可排除已单独处理的发起方文件。
 * 与 vscode 无关，便于在纯 Node 环境测试。
 */
export function filterPanelsByProject<T>(
    panels: Iterable<T>,
    getFilePath: (panel: T) => string | undefined,
    projectRoot: string,
    excludeFilePath?: string
): T[] {
    const rootKey = PendingWriteRegistry.normalizePathKey(projectRoot);
    const excludeKey = excludeFilePath ? PendingWriteRegistry.normalizePathKey(excludeFilePath) : undefined;
    const result: T[] = [];
    for (const panel of panels) {
        const filePath = getFilePath(panel);
        if (!filePath) { continue; }
        if (excludeKey && PendingWriteRegistry.normalizePathKey(filePath) === excludeKey) { continue; }
        const root = ProjectUtils.findProjectRoot(filePath);
        if (root && PendingWriteRegistry.normalizePathKey(root) === rootKey) {
            result.push(panel);
        }
    }
    return result;
}
