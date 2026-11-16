import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_ROMFS_BASE_ADDR, ResourceGroupConfig } from '../common/ProjectConfig';
import { ProtectedAreaMerger } from './honeygui/files';
import { writeFileIfChanged } from '../utils/fileWrite';

/**
 * Entry file generator
 * Generates the project-level entry file {ProjectName}Entry.c
 */
export class EntryFileGenerator {
    /**
     * Generate the entry file
     * @param srcDir Path to the src directory
     * @param projectName Project name
     * @param entryViewId The ID of the entry view (from HML with entry="true")
     * @param romfsBaseAddr Romfs base address for embedded flashing (e.g. "0x704D1000")
     * @param resourceGroups 资源分组：每个分组单独挂载到 /<name>
     */
    static generate(
        srcDir: string,
        projectName: string,
        entryViewId?: string,
        romfsBaseAddr?: string,
        resourceGroups?: ResourceGroupConfig[]
    ): string {
        // Ensure the directory exists
        if (!fs.existsSync(srcDir)) {
            fs.mkdirSync(srcDir, { recursive: true });
        }

        const entryFile = path.join(srcDir, `${projectName}Entry.c`);

        const baseAddr = romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR;
        const mainViewId = entryViewId || `${projectName}MainView`;

        // 分组 romfs 各自挂到 /<name>。分组 bin 内部不带目录层级，
        // 挂上后与原路径一致：assets/ota/bg.png -> /ota/bg.bin
        const groups = (resourceGroups || []).filter(g => g && g.name && g.baseAddr);
        const groupMounts = groups
            .map(g => `    gui_vfs_mount_romfs("/${g.name}", (void *)${g.baseAddr}, 0);`)
            .join('\n');

        // 有分组时根 romfs 不再参与：资源全在分组里，没有东西挂到 "/"。
        // 再挂一个空的 "/" 会遮住 POSIX 风格的相对路径解析，且与分组挂载抢根。
        const rootMount = groups.length > 0
            ? `    // Resource groups are defined: every resource lives in a group mount below,\n    // so no romfs is mounted at "/".\n`
            : `    gui_vfs_mount_romfs("/", (void *)${baseAddr}, 0);\n`;
        const groupMountBlock = groupMounts ? `${groupMounts}\n` : '';

        const content = `#include "gui_api.h"
#include "gui_view.h"
#include "gui_components_init.h"
#include "gui_vfs.h"

/* @protected start entry_includes */
// Add user includes here
/* @protected end entry_includes */

static int app_init(void)
{
#ifdef _HONEYGUI_SIMULATOR_
    // Simulator: Mount POSIX filesystem
    gui_vfs_mount_posix("/", "./assets");
#else
    // SOC: Mount romfs from flash address
${rootMount}${groupMountBlock}#endif

    /* @protected start app_init_pre */
    // Add user initialization code here (runs before the main view is created)
    /* @protected end app_init_pre */

    gui_view_create(gui_obj_get_root(), "${mainViewId}", 0, 0, 0, 0);

    /* @protected start app_init_post */
    // Add user initialization code here (runs after the main view is created)
    /* @protected end app_init_post */

    return 0;
}

GUI_INIT_APP_EXPORT(app_init);
`;

        // Preserve user code in protected areas across regeneration
        if (fs.existsSync(entryFile)) {
            const existing = fs.readFileSync(entryFile, 'utf-8');
            writeFileIfChanged(entryFile, ProtectedAreaMerger.merge(existing, content));
        } else {
            writeFileIfChanged(entryFile, content);
        }
        return entryFile;
    }
}
