/**
 * @yowasp/clang 的虚拟文件系统输入是嵌套对象（目录 → 子项），这里把「路径 → 内容」的扁平映射转换过去。
 */
export interface TreeNode {
    [name: string]: TreeNode | string | Uint8Array;
}

export function treeFromFlat(flat: Record<string, Uint8Array | string>): TreeNode {
    const root: TreeNode = {};
    for (const [path, data] of Object.entries(flat)) {
        const parts = path.split('/').filter(Boolean);
        let node = root;
        for (const dir of parts.slice(0, -1)) {
            const next = node[dir];
            node = (typeof next === 'object' && !(next instanceof Uint8Array) ? next : (node[dir] = {})) as TreeNode;
        }
        node[parts[parts.length - 1]] = data;
    }
    return root;
}
