import * as path from 'path';
import { ProjectUtils } from '../utils/ProjectUtils';

/**
 * HML模板管理类 - 集中管理所有HML模板生成逻辑
 * 按照方案一：只生成标准格式XML
 */
export class HmlTemplateManager {
    /**
     * 生成标准HML文件内容
     * 格式：<?xml version="1.0" encoding="UTF-8"?>
     *       <hml>
     *           <meta>
     *               <project .../>
     *               <author .../>
     *           </meta>
     *           <view>
     *               <!-- components -->
     *           </view>
     *       </hml>
     *
     * @param projectName 项目名称
     * @param resolution 分辨率 (格式: "WIDTHXHEIGHT")
     * @param appId 应用ID
     * @param minSdk 最小SDK版本
     * @param pixelMode 像素模式
     * @returns 格式化的HML文件内容
     */
    static generateMainHml(
        projectName: string,
        resolution: string,
        appId?: string,
        minSdk?: string,
        pixelMode?: string,
        entry = true
    ): string {
        // 解析分辨率
        const { width, height } = ProjectUtils.parseResolution(resolution);

        // 生成标准格式HML内容
        return `<?xml version="1.0" encoding="UTF-8"?>
<hml>
    <meta>
        <project name="${projectName}" appId="${appId || ''}" resolution="${resolution}" minSdk="${minSdk || ''}" pixelMode="${pixelMode || ''}" />
        <author name="Anonymous" />
    </meta>
    <view>
        <hg_view id="${projectName}MainView" entry="${entry}" x="0" y="0" width="${width}" height="${height}" backgroundColor="#000000" />
    </view>
</hml>`;
    }

    /**
     * 生成独立的HML文件内容（不包含完整的meta信息，用于模块化UI设计）
     * @param hmlId HML文件ID
     * @param resolution 分辨率
     * @param description 描述
     * @returns 格式化的HML文件内容
     */
    static generateStandaloneHml(
        hmlId: string,
        resolution: string,
        description?: string
    ): string {
        // 解析分辨率
        const { width, height } = ProjectUtils.parseResolution(resolution);

        // 生成HML内容（不包含完整的meta信息，只保留必要的meta字段）
        let header = `<!-- ${hmlId} - ${description || 'Standalone HML file'} -->`;
        header += `\n<!-- Created: ${new Date().toISOString()} -->`;

        return `${header}
<?xml version="1.0" encoding="UTF-8"?>
<hml>
    <meta>
        <description value="${description || ''}" />
    </meta>
    <view>
        <!-- Add your components here -->
    </view>
</hml>`;
    }

    /**
     * 生成空白的HML文件内容
     * @param hmlId HML文件ID
     * @param resolution 分辨率
     * @returns 格式化的HML文件内容
     */
    static generateEmptyHml(hmlId: string, resolution: string): string {
        const { width, height } = ProjectUtils.parseResolution(resolution);

        return `<?xml version="1.0" encoding="UTF-8"?>
<hml>
    <meta>
        <description value="Empty HML file: ${hmlId}" />
    </meta>
    <view>
        <!-- Add your components here -->
    </view>
</hml>`;
    }

    /**
     * 生成项目主C++文件内容
     * @param projectName 项目名称
     * @param appId 应用ID
     * @returns 格式化的C++文件内容
     */
    static generateMainCpp(projectName: string, appId?: string): string {
        let headerComments = `// ${projectName} Main Program`;
        if (appId) headerComments += `\n// APP ID: ${appId}`;

        return `${headerComments}

#include <iostream>

// <honeygui-protect-begin:handler>
void OnWelcomeButtonClick() {
    std::cout << "Welcome to ${projectName}!" << std::endl;
}
// <honeygui-protect-end:handler>

int main() {
    std::cout << "${projectName} starting..." << std::endl;
    return 0;
}`;
    }

    /**
     * 生成项目README文件内容
     * @param projectName 项目名称
     * @param appId 应用ID（可选）
     * @param resolution 分辨率
     * @returns 格式化的README文件内容
     */
    static generateReadme(
        projectName: string,
        appId?: string,
        resolution?: string
    ): string {
        let readme = `# ${projectName}\n\nA HoneyGUI project created with HoneyGUI Visual Designer.\n\n## Project Information\n\n`;

        if (appId) readme += `- **APP ID**: ${appId}\n`;
        if (resolution) readme += `- **Resolution**: ${resolution}\n`;

        readme += `- **Format**: Standard HML Format (v1.0)\n- **Created**: ${new Date().toISOString()}\n\n## Project Structure\n\n- **ui/**: HML UI definition files\n- **src/**: C++ source code files\n- **assets/**: Project assets (images, fonts, etc.)\n\n## Getting Started\n\nOpen this project in HoneyGUI Visual Designer to start editing your UI.\n\n## HML File Format\n\nThis project uses the standard HML format:\n\n\u0060\u0060\u0060xml\n<?xml version="1.0" encoding="UTF-8"?>
<hml>
    <meta>
        <project ... />
        <author ... />
    </meta>
    <view>
        <!-- UI components -->
    </view>
</hml>
\u0060\u0060\u0060\n`;

        return readme;
    }

    /**
     * 生成项目配置JSON内容
     * @param projectName 项目名称
     * @param appId 应用ID
     * @param resolution 分辨率
     * @param minSdk 最小SDK版本
     * @returns 格式化的项目配置JSON内容
     */
    static generateProjectConfig(
        projectName: string,
        appId: string,
        resolution: string,
        minSdk?: string
    ): string {
        const config = {
            name: projectName,
            appId,
            resolution,
            minSdk: minSdk || '',
            hmlFormat: 'standard',  // 明确标识使用标准格式
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString()
        };

        return JSON.stringify(config, null, 2);
    }

    /**
     * 获取HML文件的标准文件名
     * @param projectName 项目名称
     * @returns HML文件名
     */
    static getHmlFileName(projectName: string): string {
        return `${projectName.toLowerCase()}.hml`;
    }

    /**
     * 获取项目主HML文件的标准路径
     * @param projectRootPath 项目根目录路径
     * @param projectName 项目名称
     * @returns HML文件路径
     */
    static getMainHmlFilePath(projectRootPath: string, projectName: string): string {
        return path.join(projectRootPath, 'ui', `${projectName.toLowerCase()}.hml`);
    }

    /**
     * 获取项目文件的标准路径
     * @param projectRootPath 项目根目录路径
     * @param projectName 项目名称
     * @returns 项目文件路径对象
     */
    static getProjectFilePaths(projectRootPath: string, projectName: string): {
        hml: string;
        cpp: string;
        config: string;
        readme: string;
    } {
        return {
            hml: this.getMainHmlFilePath(projectRootPath, projectName),
            cpp: path.join(projectRootPath, 'src', 'main.cpp'),
            config: path.join(projectRootPath, 'project.json'),
            readme: path.join(projectRootPath, 'README.md')
        };
    }
}
