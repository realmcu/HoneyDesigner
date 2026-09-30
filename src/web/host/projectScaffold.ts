/**
 * 浏览器版新建工程：生成与 CreateProjectPanel._createProjectStructure 相同的工程骨架
 * （project.json、ui/{Name}Main.hml、assets/conversion.json、src/、README.md）。
 *
 * VS Code 工作区文件与 AI 协作资产（.claude/skills、AGENTS.md）由扩展在打开工程时
 * 分发，浏览器版不生成；导出 ZIP 后用 VS Code 打开即可补齐。
 */
import { HmlTemplateManager } from '../../hml/HmlTemplateManager';
import { DEFAULT_ROMFS_BASE_ADDR } from '../../common/ProjectConfig';

export interface NewProjectOptions {
    name: string;
    appId: string;
    resolution: string;
    targetEngine: 'honeygui' | 'lvgl';
    cornerRadius: number;
    minSdk: string;
    pixelMode: string;
    romfsBaseAddr?: string;
    locale: 'en' | 'zh-cn';
}

export const PROJECT_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const CONVERSION_CONFIG_ZH = `{
  "_comment": [
    "资源转换配置文件 - 用于配置图片、视频等资源的转换参数",
    "",
    "【图片默认值】",
    "  format: adaptive16 (自适应16位: 有透明度→ARGB8565, 无透明度→RGB565)",
    "  compression: none (不压缩)",
    "  可选格式: RGB565, RGB888, ARGB8565, ARGB8888, I8, adaptive16, adaptive24",
    "  可选压缩: none, rle, fastlz, yuv, adaptive",
    "",
    "【视频默认值】",
    "  format: MJPEG",
    "  quality: 5 (MJPEG/AVI范围1-31, 1为最高质量; H264范围0-51)",
    "  frameRate: 保持原始帧率",
    "  可选格式: MJPEG, AVI, H264",
    "",
    "【字体默认值】",
    "  输出格式: 位图字体 (.bin)",
    "",
    "【3D模型默认值】",
    "  输出格式: HoneyGUI 3D格式 (.bin)"
  ],
  "version": "1.0",
  "defaultSettings": {
    "format": "adaptive16",
    "compression": "none"
  },
  "items": {}
}`;

const CONVERSION_CONFIG_EN = `{
  "_comment": [
    "Asset conversion config file - Configure conversion parameters for images, videos, etc.",
    "",
    "[Image Defaults]",
    "  format: adaptive16 (Adaptive 16-bit: with alpha→ARGB8565, without alpha→RGB565)",
    "  compression: none",
    "  Available formats: RGB565, RGB888, ARGB8565, ARGB8888, I8, adaptive16, adaptive24",
    "  Available compressions: none, rle, fastlz, yuv, adaptive",
    "",
    "[Video Defaults]",
    "  format: MJPEG",
    "  quality: 5 (MJPEG/AVI range 1-31, 1 is best quality; H264 range 0-51)",
    "  frameRate: Keep original frame rate",
    "  Available formats: MJPEG, AVI, H264",
    "",
    "[Font Defaults]",
    "  Output format: Bitmap font (.bin)",
    "",
    "[3D Model Defaults]",
    "  Output format: HoneyGUI 3D format (.bin)"
  ],
  "version": "1.0",
  "defaultSettings": {
    "format": "adaptive16",
    "compression": "none"
  },
  "items": {}
}`;

/** 返回「工程内相对路径 → 文件内容」；空字符串值表示目录 */
export function scaffoldProject(options: NewProjectOptions): Map<string, Uint8Array> {
    const encoder = new TextEncoder();
    const files = new Map<string, Uint8Array>();
    const hmlFileName = `${options.name}Main.hml`;

    files.set('assets/conversion.json', encoder.encode(options.locale === 'zh-cn' ? CONVERSION_CONFIG_ZH : CONVERSION_CONFIG_EN));
    files.set(`ui/${hmlFileName}`, encoder.encode(HmlTemplateManager.generateMainHml(
        options.name,
        options.resolution,
        options.appId,
        options.minSdk,
        options.pixelMode
    )));
    files.set('README.md', encoder.encode(HmlTemplateManager.generateReadme(options.name, options.appId, options.resolution)));

    const projectConfig = {
        $schema: 'HoneyGUI',
        type: 'Designer',
        version: '1.0.0',
        name: options.name,
        appId: options.appId,
        resolution: options.resolution,
        cornerRadius: options.cornerRadius,
        targetEngine: options.targetEngine,
        aiAssets: true,
        minSdk: options.minSdk,
        pixelMode: options.pixelMode,
        mainHmlFile: `ui/${hmlFileName}`,
        romfsBaseAddr: options.romfsBaseAddr || DEFAULT_ROMFS_BASE_ADDR,
        created: new Date().toISOString(),
    };
    files.set('project.json', encoder.encode(JSON.stringify(projectConfig, null, 2)));
    // src/ 由代码生成填充，先放一个占位使目录在导出时存在
    files.set('src/.gitkeep', new Uint8Array(0));
    return files;
}
