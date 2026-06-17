/**
 * HoneyGUI项目配置 - 统一定义
 */

// 图片压缩配置
export interface ImageCompressionConfig {
    enabled?: boolean;           // 是否启用压缩
    algorithm?: 'none' | 'rle' | 'fastlz' | 'yuv';  // 压缩算法
    yuvSampleMode?: 'yuv444' | 'yuv422' | 'yuv411'; // YUV 采样模式
    yuvBlurBits?: 0 | 1 | 2 | 4;  // YUV 模糊位数
    yuvFastlz?: boolean;          // YUV 是否叠加 FastLZ
}

// 强制转换配置（支持精确路径和 glob 模式）
export interface AlwaysConvertConfig {
    images?: string[];   // 图片资源路径或 glob 模式，如 "icons/**/*.png" 或 "icon1.png"
    videos?: string[];   // 视频资源路径或 glob 模式
    models?: string[];   // 3D 模型资源路径或 glob 模式
    fonts?: string[];    // 字体资源路径或 glob 模式，如 "fonts/my.ttf"
}

export interface ProjectConfig {
    $schema?: string;         // 项目 schema 标识，固定为 "HoneyGUI"
    type?: string;            // 项目类型，固定为 "Designer"
    name?: string;
    version?: string;
    description?: string;
    author?: {
        name?: string;
        email?: string;
    };
    resolution?: string;
    pixelMode?: 'RGB565' | 'RGB888' | 'ARGB8888';  // 像素格式，默认 RGB565
    targetEngine?: 'honeygui' | 'lvgl';  // 目标GUI引擎，默认honeygui

    // 是否分发 AI 协作资产（.claude/skills/ + 根 AGENTS.md）。默认 true（未设置即开启）；
    // 设为 false 则不分发，并清理已分发的产物。
    aiAssets?: boolean;

    assetsDir?: string;      // 资源目录，默认 "assets"
    uiDir?: string;          // UI目录，默认 "ui"
    srcDir?: string;         // 源码目录，默认 "src"
    romfsBaseAddr?: string;   // romfs 基地址（十六进制，如 "0x704D1000"），用于嵌入式烧录
    
    // 屏幕形状配置（与 SDK DRV_LCD_CORNER_RADIUS 对应）
    // 0 = 矩形（默认）, -1 = 圆形, >0 = 圆角半径（像素）
    cornerRadius?: number;
    
    // 图片压缩配置
    imageCompression?: ImageCompressionConfig;
    
    // 视频转换配置
    videoFormat?: 'mjpeg' | 'avi' | 'h264';  // 默认视频输出格式
    videoQuality?: number;    // 视频质量 (0-100)，默认 85
    videoFrameRate?: number;  // 视频帧率，默认 30
    
    // 强制转换配置（用于标记需要转换但暂未使用的资源）
    alwaysConvert?: AlwaysConvertConfig;
    
    designer?: {
        canvasBackgroundColor?: string;
        gridSize?: number;
        showGrid?: boolean;
        snapToGrid?: boolean;
        [key: string]: any;
    };
    preview?: {
        runnerPath?: string;
        autoDownload?: boolean;
        timeoutMs?: number;
        [key: string]: any;
    };
    uart?: {
        port?: string;       // 串口号，如 "COM3" 或 "/dev/ttyUSB0"
        baudRate?: number;   // 波特率，默认 115200
        chipType?: string;   // 芯片类型: RTL87X3E, RTL87X3EP, RTL87X3D, RTL87X3G
    };
    [key: string]: any;
}

/**
 * 默认配置常量
 */
export const DEFAULT_ROMFS_BASE_ADDR = '0x704D1000';  // 默认 romfs 基地址

/**
 * 项目配置默认值
 */
export const DEFAULT_PROJECT_CONFIG: Partial<ProjectConfig> = {
    targetEngine: 'honeygui',
    assetsDir: 'assets',
    uiDir: 'ui',
    srcDir: 'src',
    romfsBaseAddr: DEFAULT_ROMFS_BASE_ADDR,
    cornerRadius: 0  // 默认矩形屏幕，-1 为圆形，>0 为圆角半径
};
