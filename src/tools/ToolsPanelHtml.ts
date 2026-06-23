import * as vscode from 'vscode';

/** 资源转换工具翻译接口 */
export interface ToolsPanelTranslations {
    title: string;
    all: string;
    image: string;
    video: string;
    model3d: string;
    font: string;
    glass: string;
    selectFiles: string;
    selectFolder: string;
    pleaseSetOutputDirFirst: string;
    root: string;
    properties: string;
    selectFileToViewSettings: string;
    outputDir: string;
    selectDir: string;
    notSelected: string;
    baseAddr: string;
    baseAddrTooltip: string;
    clear: string;
    startConvert: string;
    preparing: string;
    dragFilesHere: string;
    pleaseSelectOutputDirFirst: string;
    currentFolderEmpty: string;
    imageConversionConfig: string;
    targetFormat: string;
    compression: string;
    adaptive16: string;
    adaptive24: string;
    noCompression: string;
    yuvSampling: string;
    blurLevel: string;
    none: string;
    fastlzSecondary: string;
    videoSettings: string;
    format: string;
    quality: string;
    frameRate: string;
    keepOriginal: string;
    noExtraSettings: string;
    fontSettings: string;
    outputFormat: string;
    bitmapFont: string;
    vectorFont: string;
    vectorFontHint: string;
    vectorFontPrecisionHint: string;
    bitmapFontSizeHint: string;
    fontSize: string;
    fixed: string;
    renderMode: string;
    bit1Mono: string;
    bit2Gray4: string;
    bit4Gray16: string;
    bit8Gray256: string;
    cropMode: string;
    auto: string;
    enabled: string;
    disabled: string;
    characterSet: string;
    addCharacterSet: string;
    glassSettings: string;
    effectArea: string;
    effectIntensity: string;
    conversionConfig: string;
    inheritedFrom: string;
    inherit: string;
    defaultSettings: string;
    unicodeRange: string;
    customChars: string;
    charsetFile: string;
    codepageFile: string;
    rangeFormat: string;
    cstTxtFile: string;
    egCP936: string;
    browse: string;
    complete: string;
    success: string;
    failed: string;
    generatingPreview: string;
    previewFailed: string;
    enableDither: string;
    ditherHint: string;
    videoScale: string;
    pixels: string;
    percentage: string;
    width: string;
    height: string;
    widthPct: string;
    heightPct: string;
    videoCrop: string;
    xPos: string;
    yPos: string;
    autoCenterHint: string;
    preprocessOrder: string;
    cropThenScale: string;
    scaleThenCrop: string;
    originalSize: string;
}

/** 获取资源转换工具翻译 */
export function getToolsPanelTranslations(): ToolsPanelTranslations {
    return {
        title: vscode.l10n.t('Resource Conversion Tool'),
        all: vscode.l10n.t('All'),
        image: vscode.l10n.t('Image'),
        video: vscode.l10n.t('Video'),
        model3d: vscode.l10n.t('3D Model'),
        font: vscode.l10n.t('Font'),
        glass: vscode.l10n.t('Glass'),
        selectFiles: vscode.l10n.t('Select Files'),
        selectFolder: vscode.l10n.t('Select Folder'),
        pleaseSetOutputDirFirst: vscode.l10n.t('Please set output directory first'),
        root: vscode.l10n.t('Root'),
        properties: vscode.l10n.t('Properties'),
        selectFileToViewSettings: vscode.l10n.t('Select file to view settings'),
        outputDir: vscode.l10n.t('Output Directory'),
        selectDir: vscode.l10n.t('Select Directory'),
        notSelected: vscode.l10n.t('Not Selected'),
        baseAddr: vscode.l10n.t('Base Address'),
        baseAddrTooltip: vscode.l10n.t('ROMFS base address for embedded flashing'),
        clear: vscode.l10n.t('Clear'),
        startConvert: vscode.l10n.t('Start Convert'),
        preparing: vscode.l10n.t('Preparing...'),
        dragFilesHere: vscode.l10n.t('Drag files or folders here'),
        pleaseSelectOutputDirFirst: vscode.l10n.t('Please select output directory first'),
        currentFolderEmpty: vscode.l10n.t('Current folder is empty'),
        imageConversionConfig: vscode.l10n.t('Image Conversion Config'),
        targetFormat: vscode.l10n.t('Target Format'),
        compression: vscode.l10n.t('Compression'),
        adaptive16: vscode.l10n.t('Adaptive 16-bit'),
        adaptive24: vscode.l10n.t('Adaptive 24-bit'),
        noCompression: vscode.l10n.t('No Compression'),
        yuvSampling: vscode.l10n.t('YUV Sampling'),
        blurLevel: vscode.l10n.t('Blur Level'),
        none: vscode.l10n.t('None'),
        fastlzSecondary: vscode.l10n.t('FastLZ Secondary Compression'),
        videoSettings: vscode.l10n.t('Video Settings'),
        format: vscode.l10n.t('Format'),
        quality: vscode.l10n.t('Quality'),
        frameRate: vscode.l10n.t('Frame Rate'),
        keepOriginal: vscode.l10n.t('Keep Original'),
        noExtraSettings: vscode.l10n.t('No extra settings'),
        fontSettings: vscode.l10n.t('Font Settings'),
        outputFormat: vscode.l10n.t('Output Format'),
        bitmapFont: vscode.l10n.t('Bitmap Font'),
        vectorFont: vscode.l10n.t('Vector Font'),
        vectorFontHint: vscode.l10n.t('Vector font supports runtime size adjustment'),
        vectorFontPrecisionHint: vscode.l10n.t('Vector font precision hint'),
        bitmapFontSizeHint: vscode.l10n.t('Bitmap font size hint'),
        fontSize: vscode.l10n.t('Font Size'),
        fixed: vscode.l10n.t('Fixed'),
        renderMode: vscode.l10n.t('Render Mode'),
        bit1Mono: vscode.l10n.t('1-bit (Mono)'),
        bit2Gray4: vscode.l10n.t('2-bit (4 Gray)'),
        bit4Gray16: vscode.l10n.t('4-bit (16 Gray)'),
        bit8Gray256: vscode.l10n.t('8-bit (256 Gray)'),
        cropMode: vscode.l10n.t('Crop Mode'),
        auto: vscode.l10n.t('Auto'),
        enabled: vscode.l10n.t('Enabled'),
        disabled: vscode.l10n.t('Disabled'),
        characterSet: vscode.l10n.t('Character Set'),
        addCharacterSet: vscode.l10n.t('+ Add Character Set'),
        glassSettings: vscode.l10n.t('Glass Settings'),
        effectArea: vscode.l10n.t('Effect Area'),
        effectIntensity: vscode.l10n.t('Effect Intensity'),
        conversionConfig: vscode.l10n.t('Conversion Config'),
        inheritedFrom: vscode.l10n.t('Inherited from'),
        inherit: vscode.l10n.t('Inherit'),
        defaultSettings: vscode.l10n.t('Default Settings'),
        unicodeRange: vscode.l10n.t('Unicode Range'),
        customChars: vscode.l10n.t('Custom Characters'),
        charsetFile: vscode.l10n.t('Charset File'),
        codepageFile: vscode.l10n.t('CodePage File'),
        rangeFormat: vscode.l10n.t('Format: start-end'),
        cstTxtFile: vscode.l10n.t('.cst / .txt file'),
        egCP936: vscode.l10n.t('e.g. CP936'),
        browse: vscode.l10n.t('Browse'),
        complete: vscode.l10n.t('Complete'),
        success: vscode.l10n.t('success'),
        failed: vscode.l10n.t('failed'),
        generatingPreview: vscode.l10n.t('Generating preview...'),
        previewFailed: vscode.l10n.t('Preview failed'),
        enableDither: vscode.l10n.t('Enable Dither'),
        ditherHint: vscode.l10n.t('ditherHint'),
        videoScale: vscode.l10n.t('Scale'),
        pixels: vscode.l10n.t('Pixels'),
        percentage: vscode.l10n.t('Percentage'),
        width: vscode.l10n.t('Width'),
        height: vscode.l10n.t('Height'),
        widthPct: vscode.l10n.t('Width %'),
        heightPct: vscode.l10n.t('Height %'),
        videoCrop: vscode.l10n.t('Crop'),
        xPos: vscode.l10n.t('X'),
        yPos: vscode.l10n.t('Y'),
        autoCenterHint: vscode.l10n.t('auto center'),
        preprocessOrder: vscode.l10n.t('Order'),
        cropThenScale: vscode.l10n.t('Crop → Scale'),
        scaleThenCrop: vscode.l10n.t('Scale → Crop'),
        originalSize: vscode.l10n.t('Original'),
    };
}

export function getToolsPanelHtml(t: ToolsPanelTranslations): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${t.title}</title>
    <style>${getStyles()}</style>
</head>
<body>
    <div class="container">
        <h1>🔧 ${t.title}</h1>
        <div class="main-layout">
            <div class="left-panel">
                <div class="panel-header">
                    <select class="filter-select" id="filterSelect" onchange="setFilter(this.value)" disabled>
                        <option value="all">${t.all}</option>
                        <option value="image">🖼️ ${t.image}</option>
                        <option value="video">🎬 ${t.video}</option>
                        <option value="model">📦 ${t.model3d}</option>
                        <option value="font">🔤 ${t.font}</option>
                        <option value="glass">🔮 ${t.glass}</option>
                    </select>
                    <div class="header-buttons">
                        <button class="icon-btn" id="selectFilesBtn" onclick="selectFiles()" title="${t.pleaseSetOutputDirFirst}" disabled>📁</button>
                        <button class="icon-btn" id="selectFolderBtn" onclick="selectFolder()" title="${t.pleaseSetOutputDirFirst}" disabled>📂</button>
                    </div>
                </div>
                <div class="breadcrumb" id="breadcrumb">
                    <span class="breadcrumb-item" onclick="navigateTo(-1)">🏠 ${t.root}</span>
                </div>
                <div class="file-grid disabled" id="fileGrid" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                    <div class="file-grid-inner" id="fileGridInner">
                        <div class="empty-hint">${t.pleaseSelectOutputDirFirst}</div>
                    </div>
                </div>
                <input type="file" id="fileInput" multiple accept=".png,.jpg,.jpeg,.bmp,.gif,.mp4,.avi,.mov,.mkv,.webm,.obj,.gltf,.ttf,.otf,.svg" style="display:none" onchange="handleFileSelect(event)">
                <input type="file" id="folderInput" multiple webkitdirectory="" directory="" style="display:none" onchange="handleFileSelect(event)">
            </div>
            <div class="right-panel">
                <div class="panel-header">${t.properties}</div>
                <div class="properties" id="properties">
                    <div class="preview-area" id="previewArea"></div>
                    <div class="no-selection">${t.selectFileToViewSettings}</div>
                </div>
            </div>
        </div>
        <div class="output-section">
            <span>${t.outputDir}:</span>
            <button onclick="selectOutputDir()">${t.selectDir}</button>
            <span id="outputDirPath" class="output-path">${t.notSelected}</span>
            <span class="base-addr-label">${t.baseAddr}:</span>
            <input type="text" id="baseAddrInput" class="base-addr-input" value="0x704D1000" placeholder="0x704D1000" title="${t.baseAddrTooltip}">
        </div>
        <div class="footer">
            <div class="stats" id="stats">🖼️ 0  🎬 0  📦 0</div>
            <div class="actions">
                <button id="clearBtn" onclick="clearAll()" title="${t.pleaseSetOutputDirFirst}" disabled>🗑️ ${t.clear}</button>
                <button id="convertBtn" onclick="startConvert()" title="${t.pleaseSetOutputDirFirst}" disabled>▶️ ${t.startConvert}</button>
            </div>
        </div>
        <div class="progress-section" id="progressSection" style="display:none">
            <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
            <div class="progress-text" id="progressText">${t.preparing}</div>
        </div>
        <div class="results" id="results" style="display:none"></div>
    </div>
    <script>${getScript(t)}</script>
</body>
</html>`;
}

function getStyles(): string {
    return `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);padding:16px;height:100vh;overflow:hidden}
.container{display:flex;flex-direction:column;height:100%}
h1{font-size:16px;margin-bottom:12px}
.main-layout{display:flex;flex:1;gap:12px;min-height:0;overflow:hidden}
.left-panel,.right-panel{background:var(--vscode-input-background);border-radius:4px;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.left-panel{flex:1}
.right-panel{width:300px}
.panel-header{padding:8px 12px;border-bottom:1px solid var(--vscode-panel-border);display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:13px}
.filter-select{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);color:var(--vscode-input-foreground);padding:4px 8px;border-radius:4px;font-size:12px}
.header-buttons{display:flex;gap:4px}
.icon-btn{background:transparent;border:none;cursor:pointer;padding:4px 8px;border-radius:4px;font-size:14px}
.icon-btn:hover{background:var(--vscode-toolbar-hoverBackground)}
.breadcrumb{padding:6px 12px;border-bottom:1px solid var(--vscode-panel-border);font-size:12px;display:flex;align-items:center;flex-wrap:wrap;gap:2px}
.breadcrumb-item{cursor:pointer;padding:2px 6px;border-radius:3px;color:var(--vscode-textLink-foreground)}
.breadcrumb-item:hover{background:var(--vscode-toolbar-hoverBackground)}
.breadcrumb-separator{color:var(--vscode-descriptionForeground);margin:0 2px}
.file-grid{flex:1;overflow-y:auto;padding:8px}
.file-grid-inner{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}
.file-grid.drag-over{background:var(--vscode-list-hoverBackground);outline:2px dashed var(--vscode-focusBorder);outline-offset:-4px}
.file-grid.disabled{pointer-events:none;opacity:0.6}
.empty-hint{grid-column:1/-1;color:var(--vscode-descriptionForeground);text-align:center;padding:60px 20px;font-size:13px}
.grid-item{position:relative;border-radius:4px;overflow:hidden;cursor:pointer;background:var(--vscode-editor-background);border:2px solid transparent;flex-shrink:0}
.grid-item:hover{border-color:var(--vscode-focusBorder)}
.grid-item.selected{border-color:var(--vscode-focusBorder);background:var(--vscode-list-activeSelectionBackground)}
.grid-item .thumb{width:100%;height:0;padding-bottom:100%;position:relative;background:#1e1e1e;overflow:hidden}
.grid-item .thumb img,.grid-item .thumb video,.grid-item .thumb .icon{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.grid-item .thumb .icon{display:flex;align-items:center;justify-content:center;font-size:36px}
.grid-item .info{padding:4px 6px;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
.grid-item .remove-btn{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;border:none;cursor:pointer;font-size:10px;display:none;align-items:center;justify-content:center}
.grid-item:hover .remove-btn{display:flex}
.grid-item .type-badge{position:absolute;top:2px;left:2px;font-size:11px;background:rgba(0,0,0,0.5);padding:2px 4px;border-radius:3px}
.grid-item .count-badge{position:absolute;bottom:22px;right:4px;font-size:9px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);padding:1px 5px;border-radius:8px}
.folder-item .thumb{background:var(--vscode-editor-background)}
.properties{flex:1;padding:12px;overflow-y:auto;display:flex;flex-direction:column}
.preview-area{margin-bottom:12px}
.preview-area img,.preview-area video{max-width:100%;max-height:180px;border-radius:4px;display:block;margin:0 auto}
.preview-area .model-preview{text-align:center;padding:40px;background:#1e1e1e;border-radius:4px;font-size:48px}
.no-selection{color:var(--vscode-descriptionForeground);text-align:center;padding:20px;font-size:12px}
.prop-group{margin-bottom:12px}
.prop-group-title{font-size:11px;font-weight:600;margin-bottom:6px;color:var(--vscode-descriptionForeground)}
.prop-row{display:flex;align-items:center;margin-bottom:6px;font-size:12px}
.prop-row label{width:65px;color:var(--vscode-descriptionForeground)}
.prop-row select,.prop-row input{flex:1;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);color:var(--vscode-input-foreground);padding:4px 6px;border-radius:3px;font-size:11px}
.prop-row button{padding:4px 8px;font-size:10px;flex:none}
.charset-list{margin-top:6px;border:1px solid var(--vscode-panel-border);border-radius:3px;max-height:150px;overflow-y:auto}
.charset-item{display:flex;flex-direction:column;padding:6px;font-size:11px;border-bottom:1px solid var(--vscode-panel-border);gap:4px}
.charset-item:last-child{border-bottom:none}
.charset-item .charset-row{display:flex;align-items:center;gap:4px}
.charset-item select{width:auto;min-width:90px;flex:none}
.charset-item input{flex:1;min-width:0}
.charset-item .remove-charset{background:transparent;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;padding:2px 4px;font-size:12px;flex:none}
.charset-item .remove-charset:hover{color:#f44}
.charset-item .browse-btn{padding:2px 8px;font-size:10px;flex:none}
.charset-hint{font-size:9px;color:var(--vscode-descriptionForeground);padding-left:94px}
.add-charset{margin-top:4px;font-size:10px;padding:3px 8px}
.charset-stats{margin-top:6px;font-size:10px;color:var(--vscode-descriptionForeground)}
.charset-stats-warn{margin-top:4px;font-size:10px;color:var(--vscode-editorWarning-foreground)}
.output-section{display:flex;align-items:center;gap:10px;padding:10px 0;font-size:13px}
.output-path{flex:1;padding:6px 10px;background:var(--vscode-textBlockQuote-background);border-radius:4px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.base-addr-label{margin-left:10px;white-space:nowrap}
.base-addr-input{width:110px;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);color:var(--vscode-input-foreground);border-radius:4px;font-size:12px;font-family:monospace}
.footer{display:flex;justify-content:space-between;align-items:center;padding:10px 0}
.stats{font-size:13px}
.actions{display:flex;gap:8px}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px}
button:hover{background:var(--vscode-button-hoverBackground)}
button:disabled{opacity:.5;cursor:not-allowed}
.progress-section{padding:10px 0}
.progress-bar{height:6px;background:var(--vscode-progressBar-background);border-radius:3px;overflow:hidden}
.progress-fill{height:100%;background:var(--vscode-progressBar-foreground,#0e70c0);width:0;transition:width .3s}
.progress-text{font-size:12px;margin-top:6px;color:var(--vscode-descriptionForeground)}
.results{padding:12px;border-radius:4px;font-size:12px;white-space:pre-wrap;max-height:100px;overflow-y:auto}
.results.success{background:#2e7d32;color:#fff}
.results.error{background:#c62828;color:#fff}
.results.mixed{background:var(--vscode-textBlockQuote-background)}
.file-name{font-size:12px;font-weight:500;margin-bottom:4px;word-break:break-all}
.file-path{font-size:10px;color:var(--vscode-descriptionForeground);margin-bottom:8px}
`;
}

function getScript(t: ToolsPanelTranslations): string {
    return `
const T = ${JSON.stringify(t)};
const vscode = acquireVsCodeApi();
const files = new Map();
const blobUrls = new Map();
let selectedId = null;
let selectedFolder = null;
let outputDir = '';
let currentPath = [];
let filterType = 'all';
const folderSettings = {};
let conversionConfig = null;  // conversion.json 配置
const videoInfoCache = new Map();  // 视频原始尺寸缓存 id → {width, height}
let currentScaleBase = { w: 0, h: 0 };  // 缩放比例计算基础尺寸（考虑裁剪顺序）

const IMAGE_EXTS = ['.png','.jpg','.jpeg','.bmp','.gif'];
const VIDEO_EXTS = ['.mp4','.avi','.mov','.mkv','.webm'];
const MODEL_EXTS = ['.obj','.gltf','.mtl'];
const FONT_EXTS = ['.ttf','.otf'];
const GLASS_EXTS = ['.glass'];
const AUXILIARY_EXTS = ['.bin'];  // 辅助文件（如 GLTF 的 buffer 文件）

function getFileType(name) {
    const ext = name.toLowerCase().match(/\\.[^.]+$/)?.[0] || '';
    if (IMAGE_EXTS.includes(ext)) return 'image';
    if (VIDEO_EXTS.includes(ext)) return 'video';
    if (MODEL_EXTS.includes(ext)) return 'model';
    if (FONT_EXTS.includes(ext)) return 'font';
    if (GLASS_EXTS.includes(ext)) return 'glass';
    if (AUXILIARY_EXTS.includes(ext)) return 'auxiliary';
    return 'unknown';
}

// 获取图片的转换配置（从 conversion.json）
function getImageConversionConfig(relativePath) {
    if (!conversionConfig) return null;
    const normalizedPath = (relativePath || '').replace(/\\\\/g, '/').replace(/^\\/+|\\/+$/g, '');
    return conversionConfig.items[normalizedPath] || null;
}

// 获取文件夹的转换配置
function getFolderConversionConfig(folderPath) {
    if (!conversionConfig) return null;
    const normalizedPath = (folderPath || '').replace(/\\\\/g, '/').replace(/^\\/+|\\/+$/g, '');
    return conversionConfig.items[normalizedPath] || null;
}

// 解析有效配置（处理继承）
function resolveEffectiveConfig(assetPath) {
    if (!conversionConfig) {
        return { format: 'adaptive16', compression: 'none', videoFormat: 'mjpeg', isInherited: true, inheritedFrom: T.defaultSettings };
    }
    
    const normalizedPath = (assetPath || '').replace(/\\\\/g, '/').replace(/^\\/+|\\/+$/g, '');
    const itemSettings = conversionConfig.items[normalizedPath] || {};
    
    // 检查是否有明确的图片格式配置
    const hasExplicitFormat = itemSettings.format && itemSettings.format !== 'inherit';
    // 检查是否有明确的视频格式配置
    const hasExplicitVideoFormat = itemSettings.videoFormat && itemSettings.videoFormat !== 'inherit';
    
    // 如果图片和视频格式都有明确配置，直接返回
    if (hasExplicitFormat && hasExplicitVideoFormat) {
        return { ...itemSettings, isInherited: false };
    }
    
    // 需要继承：查找父级配置
    const pathParts = normalizedPath.split('/');
    let inheritedFormat = null;
    let inheritedVideoFormat = null;
    let inheritedFrom = T.defaultSettings;
    let parentSettings = {};
    
    for (let i = pathParts.length - 1; i >= 0; i--) {
        const parentPath = pathParts.slice(0, i).join('/');
        const settings = parentPath ? conversionConfig.items[parentPath] : undefined;
        
        if (settings) {
            // 继承图片格式
            if (!inheritedFormat && settings.format && settings.format !== 'inherit') {
                inheritedFormat = settings.format;
                if (!inheritedVideoFormat) inheritedFrom = parentPath || '根目录';
            }
            // 继承视频格式
            if (!inheritedVideoFormat && settings.videoFormat && settings.videoFormat !== 'inherit') {
                inheritedVideoFormat = settings.videoFormat;
                inheritedFrom = parentPath || '根目录';
            }
            // 合并其他设置
            parentSettings = { ...settings, ...parentSettings };
        }
        
        // 如果都找到了，可以提前退出
        if (inheritedFormat && inheritedVideoFormat) break;
    }
    
    // 构建最终配置
    const result = {
        ...conversionConfig.defaultSettings,
        ...parentSettings,
        ...itemSettings,
        isInherited: !hasExplicitFormat || !hasExplicitVideoFormat,
        inheritedFrom
    };
    
    // 应用继承的格式
    if (!hasExplicitFormat) {
        result.format = inheritedFormat || conversionConfig.defaultSettings?.format || 'adaptive16';
    }
    if (!hasExplicitVideoFormat) {
        result.videoFormat = inheritedVideoFormat || 'mjpeg';
    }
    
    return result;
}

// 更新转换配置
function updateConversionConfig(assetPath, settings) {
    vscode.postMessage({ type: 'updateConversionConfig', assetPath, settings });
}

function selectFiles() { 
    if (!outputDir) return;
    console.log('selectFiles clicked');
    document.getElementById('fileInput').click(); 
}
function selectFolder() { 
    if (!outputDir) return;
    console.log('selectFolder clicked');
    const input = document.getElementById('folderInput');
    console.log('folderInput element:', input);
    console.log('webkitdirectory attr:', input.webkitdirectory);
    input.click(); 
}
function selectOutputDir() { vscode.postMessage({type:'selectOutputDir'}); }

let inputDirName = '';  // 记录输入目录名称

function handleFileSelect(e) {
    console.log('handleFileSelect triggered');
    const fileList = e.target.files;
    console.log('files:', fileList?.length);
    if (!fileList) return;
    
    // 尝试从第一个文件的 webkitRelativePath 提取根目录名
    const firstFile = fileList[0];
    if (firstFile && firstFile.webkitRelativePath) {
        const rootDir = firstFile.webkitRelativePath.split('/')[0];
        if (rootDir && rootDir !== inputDirName) {
            inputDirName = rootDir;
            // 通知后端输入目录名称（用于查找 conversion.json）
            vscode.postMessage({ type: 'setInputDir', dir: rootDir });
        }
    }
    
    Array.from(fileList).forEach(file => {
        console.log('file:', file.name, 'webkitRelativePath:', file.webkitRelativePath);
        const relativePath = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(0,-1).join('/') : '';
        processFile(file, relativePath);
    });
    e.target.value = '';
}

function handleDragOver(e) { 
    if (!outputDir) return;
    e.preventDefault(); 
    e.currentTarget.classList.add('drag-over'); 
}
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }

function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (!outputDir) return;
    const items = e.dataTransfer.items;
    if (items) {
        Array.from(items).forEach(item => {
            const entry = item.webkitGetAsEntry?.();
            if (entry) processEntry(entry, '');
        });
    }
}

function processEntry(entry, relativePath) {
    if (entry.isFile) {
        entry.file(file => processFile(file, relativePath));
    } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const readAll = () => {
            reader.readEntries(entries => {
                if (entries.length) {
                    entries.forEach(e => processEntry(e, relativePath ? relativePath+'/'+entry.name : entry.name));
                    readAll();
                }
            });
        };
        readAll();
    }
}

function processFile(file, relativePath) {
    const type = getFileType(file.name);
    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
    
    // 特殊处理：.bin 文件可能是 GLTF buffer，允许通过，由后端判断
    if (type === 'unknown' && ext !== '.bin') return;
    
    const id = Date.now() + '_' + Math.random().toString(36).substr(2,9);
    
    // 辅助文件（如 GLTF 的 .bin buffer 文件）只复制到 origin，不显示在 UI 中
    if (type === 'auxiliary') {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = Array.from(new Uint8Array(e.target.result));
            // 只复制文件，不添加到 files 列表
            vscode.postMessage({ type:'copyFileToOrigin', id, name:file.name, relativePath, data });
        };
        reader.readAsArrayBuffer(file);
        return;
    }
    
    // 对 .glass 文件，需要以 SVG 类型创建 blob 以便正确预览
    let blobUrl;
    if (type === 'glass') {
        // 读取文件内容后创建带正确 MIME 类型的 blob
        const reader = new FileReader();
        reader.onload = (e) => {
            const svgBlob = new Blob([e.target.result], { type: 'image/svg+xml' });
            blobUrl = URL.createObjectURL(svgBlob);
            blobUrls.set(id, blobUrl);
            
            const dataReader = new FileReader();
            dataReader.onload = (e2) => {
                const data = Array.from(new Uint8Array(e2.target.result));
                files.set(id, { id, name: file.name, relativePath, type, data, blobUrl });
                // 复制文件到 origin 文件夹
                vscode.postMessage({ type:'copyFileToOrigin', id, name:file.name, relativePath, data });
                renderGrid();
                updateStats();
            };
            dataReader.readAsArrayBuffer(file);
        };
        reader.readAsArrayBuffer(file);
        return;
    }
    
    blobUrl = URL.createObjectURL(file);
    blobUrls.set(id, blobUrl);
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = Array.from(new Uint8Array(e.target.result));
        // 所有文件都添加到前端（包括 bin），后端会处理类型识别
        files.set(id, { id, name: file.name, relativePath, type, data, blobUrl });
        // 复制文件到 origin 文件夹
        vscode.postMessage({ type:'copyFileToOrigin', id, name:file.name, relativePath, data });
        renderGrid();
        updateStats();
    };
    reader.readAsArrayBuffer(file);
}

function setFilter(type) {
    filterType = type;
    currentPath = [];
    selectedId = null;
    renderBreadcrumb();
    renderGrid();
    renderProperties();
    updateFilterCounts();
}

function updateFilterCounts() {
    let img=0, vid=0, mod=0, fnt=0, gls=0;
    files.forEach(f => { if(f.type==='image')img++; else if(f.type==='video')vid++; else if(f.type==='model')mod++; else if(f.type==='font')fnt++; else if(f.type==='glass')gls++; });
    const total = img + vid + mod + fnt + gls;
    const sel = document.getElementById('filterSelect');
    sel.options[0].text = T.all+' ('+total+')';
    sel.options[1].text = '🖼️ '+T.image+' ('+img+')';
    sel.options[2].text = '🎬 '+T.video+' ('+vid+')';
    sel.options[3].text = '📦 '+T.model3d+' ('+mod+')';
    sel.options[4].text = '🔤 '+T.font+' ('+fnt+')';
    sel.options[5].text = '🔮 '+T.glass+' ('+gls+')';
}

function getCurrentContent() {
    const folders = new Map();
    const currentFiles = [];
    const pathPrefix = currentPath.join('/');
    
    files.forEach(f => {
        if (filterType !== 'all' && f.type !== filterType) return;
        
        if (filterType !== 'all') {
            currentFiles.push(f);
            return;
        }
        
        if (pathPrefix) {
            if (!f.relativePath.startsWith(pathPrefix)) return;
            const rest = f.relativePath.slice(pathPrefix.length + 1);
            if (rest.includes('/')) {
                const folderName = rest.split('/')[0];
                if (!folders.has(folderName)) folders.set(folderName, { name: folderName, count: 0 });
                folders.get(folderName).count++;
            } else if (rest === '') {
                currentFiles.push(f);
            } else {
                const folderName = rest;
                if (!folders.has(folderName)) folders.set(folderName, { name: folderName, count: 0 });
                folders.get(folderName).count++;
            }
        } else {
            if (f.relativePath === '') {
                currentFiles.push(f);
            } else {
                const folderName = f.relativePath.split('/')[0];
                if (!folders.has(folderName)) folders.set(folderName, { name: folderName, count: 0 });
                folders.get(folderName).count++;
            }
        }
    });
    
    return { folders: Array.from(folders.values()), files: currentFiles };
}

function renderBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    if (filterType !== 'all') {
        bc.style.display = 'none';
        return;
    }
    bc.style.display = 'flex';
    let html = '<span class="breadcrumb-item" onclick="navigateTo(-1)">🏠 '+T.root+'</span>';
    currentPath.forEach((name, i) => {
        html += '<span class="breadcrumb-separator">/</span>';
        html += '<span class="breadcrumb-item" onclick="navigateTo('+i+')">'+name+'</span>';
    });
    bc.innerHTML = html;
}

function navigateTo(index) {
    if (index < 0) currentPath = [];
    else currentPath = currentPath.slice(0, index + 1);
    selectedId = null;
    selectedFolder = null;
    renderBreadcrumb();
    renderGrid();
    renderProperties();
}

function enterFolder(name) {
    currentPath.push(name);
    selectedId = null;
    selectedFolder = null;
    renderBreadcrumb();
    renderGrid();
    renderProperties();
}

function renderGrid() {
    const grid = document.getElementById('fileGridInner');
    if (files.size === 0) {
        grid.innerHTML = '<div class="empty-hint">' + (outputDir ? T.dragFilesHere : T.pleaseSelectOutputDirFirst) + '</div>';
        return;
    }
    
    const { folders, files: currentFiles } = getCurrentContent();
    
    if (folders.length === 0 && currentFiles.length === 0) {
        grid.innerHTML = '<div class="empty-hint">'+T.currentFolderEmpty+'</div>';
        return;
    }
    
    let html = '';
    
    folders.forEach(folder => {
        const folderPath = currentPath.length ? currentPath.join('/') + '/' + folder.name : folder.name;
        const isSelected = selectedFolder === folderPath;
        html += '<div class="grid-item folder-item'+(isSelected?' selected':'')+'" onclick="selectFolderItem(\\''+folderPath+'\\',event)" ondblclick="enterFolder(\\''+folder.name+'\\')">'; 
        html += '<div class="thumb"><span class="icon">📁</span></div>';
        html += '<span class="count-badge">'+folder.count+'</span>';
        html += '<div class="info" title="'+folder.name+'">'+folder.name+'</div>';
        html += '<button class="remove-btn" onclick="removeFolder(event,\\''+folderPath+'\\')">✕</button>';
        html += '</div>';
    });
    
    currentFiles.forEach(f => {
        const isSelected = selectedId === f.id;
        html += '<div class="grid-item' + (isSelected ? ' selected' : '') + '" onclick="selectItem(\\''+f.id+'\\')">';
        html += '<div class="thumb">';
        if (f.type === 'image') {
            html += '<img src="'+f.blobUrl+'" alt="'+f.name+'">';
        } else if (f.type === 'video') {
            html += '<video src="'+f.blobUrl+'" muted></video>';
        } else if (f.type === 'model') {
            html += '<span class="icon">📦</span>';
        } else if (f.type === 'glass') {
            html += '<img src="'+f.blobUrl+'" alt="'+f.name+'">';
        } else {
            html += '<span class="icon">🔤</span>';
        }
        html += '</div>';
        html += '<span class="type-badge">' + (f.type==='image'?'🖼️':f.type==='video'?'🎬':f.type==='model'?'📦':f.type==='font'?'🔤':'🔮') + '</span>';
        html += '<div class="info" title="'+f.name+'">'+f.name+'</div>';
        html += '<button class="remove-btn" onclick="removeFile(event,\\''+f.id+'\\')">✕</button>';
        html += '</div>';
    });
    
    grid.innerHTML = html;
}

function selectFolderItem(folderPath, e) {
    if (e) e.stopPropagation();
    selectedFolder = folderPath;
    selectedId = null;
    renderGrid();
    renderProperties();
}

function selectItem(id) {
    selectedId = id;
    selectedFolder = null;
    renderGrid();
    renderProperties();
    scheduleCharsetStats();
    // Request video info for proportional scale hints
    const file = files.get(id);
    if (file && file.type === 'video' && !videoInfoCache.has(id)) {
        vscode.postMessage({ type: 'getVideoInfo', id, name: file.name, relativePath: file.relativePath });
    }
}

function removeFile(e, id) {
    e.stopPropagation();
    const file = files.get(id);
    if (!file) return;
    
    const url = blobUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    blobUrls.delete(id);
    files.delete(id);
    // 传递文件名和路径，以便后端删除硬盘上的文件
    vscode.postMessage({type:'removeFile', id, name: file.name, relativePath: file.relativePath});
    if (selectedId === id) { selectedId = null; renderProperties(); }
    renderGrid();
    updateStats();
}

// 删除文件夹
function removeFolder(e, folderPath) {
    e.stopPropagation();
    
    // 从内存中删除该文件夹下的所有文件
    const idsToDelete = [];
    files.forEach((file, id) => {
        if (file.relativePath === folderPath || file.relativePath.startsWith(folderPath + '/')) {
            idsToDelete.push(id);
        }
    });
    idsToDelete.forEach(id => {
        const url = blobUrls.get(id);
        if (url) URL.revokeObjectURL(url);
        blobUrls.delete(id);
        files.delete(id);
    });
    
    // 通知后端删除硬盘上的文件夹
    vscode.postMessage({type:'removeFolder', folderPath});
    
    if (selectedFolder === folderPath || (selectedFolder && selectedFolder.startsWith(folderPath + '/'))) {
        selectedFolder = null;
        renderProperties();
    }
    renderGrid();
    updateStats();
}

function clearAll() {
    blobUrls.forEach(url => URL.revokeObjectURL(url));
    blobUrls.clear();
    files.clear();
    selectedId = null;
    selectedFolder = null;
    currentPath = [];
    filterType = 'all';
    Object.keys(folderSettings).forEach(k => delete folderSettings[k]);
    document.getElementById('filterSelect').value = 'all';
    vscode.postMessage({type:'clearFiles'});
    renderBreadcrumb();
    renderGrid();
    updateStats();
    renderProperties();
}

function updateStats() {
    let img=0, vid=0, mod=0, fnt=0, gls=0;
    files.forEach(f => { if(f.type==='image')img++; else if(f.type==='video')vid++; else if(f.type==='model')mod++; else if(f.type==='font')fnt++; else if(f.type==='glass')gls++; });
    document.getElementById('stats').textContent = '🖼️ '+img+'  🎬 '+vid+'  📦 '+mod+'  🔤 '+fnt+'  🔮 '+gls;
    document.getElementById('convertBtn').disabled = !(files.size && outputDir);
    document.getElementById('clearBtn').disabled = !outputDir || !files.size;
    updateFilterCounts();
}

function renderProperties() {
    const props = document.getElementById('properties');
    
    if (selectedFolder) {
        const settings = folderSettings[selectedFolder] || {};
        let imgCount = 0, vidCount = 0, modCount = 0, fntCount = 0, glsCount = 0;
        files.forEach(f => {
            if (f.relativePath === selectedFolder || f.relativePath.startsWith(selectedFolder + '/')) {
                if (f.type === 'image') imgCount++;
                else if (f.type === 'video') vidCount++;
                else if (f.type === 'model') modCount++;
                else if (f.type === 'font') fntCount++;
                else if (f.type === 'glass') glsCount++;
            }
        });
        
        let html = '<div class="preview-area"><div class="model-preview">📁</div></div>';
        html += '<div class="file-name">'+selectedFolder.split('/').pop()+'</div>';
        html += '<div class="file-path">🖼️ '+imgCount+'  🎬 '+vidCount+'  📦 '+modCount+'  🔤 '+fntCount+'  🔮 '+glsCount+'</div>';
        
        if (imgCount > 0) {
            // 使用 conversion.json 配置
            const folderConfig = getFolderConversionConfig(selectedFolder) || {};
            const effectiveConfig = resolveEffectiveConfig(selectedFolder);
            const currentFormat = folderConfig.format || 'adaptive16';
            const currentCompression = folderConfig.compression || 'none';
            
            html += '<div class="prop-group"><div class="prop-group-title">🖼️ '+T.imageConversionConfig+' ('+imgCount+')</div>' +
                '<div class="prop-row"><label>'+T.targetFormat+':</label><select onchange="updateFolderImageConfig(\\'format\\',this.value)">' +
                '<option value="adaptive16"'+(currentFormat==='adaptive16'?' selected':'')+'>'+T.adaptive16+'</option>' +
                '<option value="adaptive24"'+(currentFormat==='adaptive24'?' selected':'')+'>'+T.adaptive24+'</option>' +
                '<option value="RGB565"'+(currentFormat==='RGB565'?' selected':'')+'>RGB565</option>' +
                '<option value="RGB888"'+(currentFormat==='RGB888'?' selected':'')+'>RGB888</option>' +
                '<option value="ARGB8565"'+(currentFormat==='ARGB8565'?' selected':'')+'>ARGB8565</option>' +
                '<option value="ARGB8888"'+(currentFormat==='ARGB8888'?' selected':'')+'>ARGB8888</option>' +
                '<option value="I8"'+(currentFormat==='I8'?' selected':'')+'>I8</option>' +
                '<option value="A8"'+(currentFormat==='A8'?' selected':'')+'>A8</option>' +
                '<option value="A4"'+(currentFormat==='A4'?' selected':'')+'>A4</option>' +
                '<option value="A2"'+(currentFormat==='A2'?' selected':'')+'>A2</option>' +
                '<option value="A1"'+(currentFormat==='A1'?' selected':'')+'>A1</option>' +
                '</select></div>' +
                '<div class="prop-row"><label>'+T.compression+':</label><select onchange="updateFolderImageConfig(\\'compression\\',this.value)">' +
                '<option value="none"'+(currentCompression==='none'?' selected':'')+'>'+T.noCompression+'</option>' +
                '<option value="rle"'+(currentCompression==='rle'?' selected':'')+'>RLE</option>' +
                '<option value="fastlz"'+(currentCompression==='fastlz'?' selected':'')+'>FastLZ</option>' +
                '<option value="yuv"'+(currentCompression==='yuv'?' selected':'')+'>YUV</option>' +
                '</select></div>' +
                '<div class="prop-row"><label></label><label style="width:auto;display:flex;align-items:center;gap:4px" title="'+T.ditherHint+'"><input type="checkbox" '+(folderConfig.dither!==false?'checked':'')+' onchange="updateFolderImageConfig(\\'dither\\',this.checked)">'+T.enableDither+'</label></div>';
            
            // YUV 参数
            if (currentCompression === 'yuv') {
                const yuvParams = folderConfig.yuvParams || { sampling: 'YUV422', blur: 'none', fastlzSecondary: false };
                html += '<div class="prop-row"><label>'+T.yuvSampling+':</label><select onchange="updateFolderYuvParam(\\'sampling\\',this.value)">' +
                    '<option value="YUV444"'+(yuvParams.sampling==='YUV444'?' selected':'')+'>YUV444</option>' +
                    '<option value="YUV422"'+(yuvParams.sampling==='YUV422'?' selected':'')+'>YUV422</option>' +
                    '<option value="YUV411"'+(yuvParams.sampling==='YUV411'?' selected':'')+'>YUV411</option>' +
                    '</select></div>' +
                    '<div class="prop-row"><label>'+T.blurLevel+':</label><select onchange="updateFolderYuvParam(\\'blur\\',this.value)">' +
                    '<option value="none"'+(yuvParams.blur==='none'?' selected':'')+'>'+T.none+'</option>' +
                    '<option value="1bit"'+(yuvParams.blur==='1bit'?' selected':'')+'>1bit</option>' +
                    '<option value="2bit"'+(yuvParams.blur==='2bit'?' selected':'')+'>2bit</option>' +
                    '<option value="4bit"'+(yuvParams.blur==='4bit'?' selected':'')+'>4bit</option>' +
                    '</select></div>' +
                    '<div class="prop-row"><label></label><label style="width:auto;display:flex;align-items:center;gap:4px"><input type="checkbox" '+(yuvParams.fastlzSecondary?'checked':'')+' onchange="updateFolderYuvParam(\\'fastlzSecondary\\',this.checked)">'+T.fastlzSecondary+'</label></div>';
            }
            html += '</div>';
        }
        
        if (vidCount > 0) {
            // 使用 conversion.json 配置
            const folderVideoConfig = getFolderConversionConfig(selectedFolder) || {};
            const currentVideoFormat = folderVideoConfig.videoFormat || 'mjpeg';
            const currentVideoQuality = folderVideoConfig.videoQuality || 1;
            const currentVideoFrameRate = folderVideoConfig.videoFrameRate || '';
            const folderScale = folderVideoConfig.videoScale;
            const folderScaleMode = folderScale ? folderScale.mode : 'disabled';
            const folderCrop = folderVideoConfig.videoCrop;
            const folderCropEnabled = !!folderCrop;
            const folderHasBoth = (folderScaleMode !== 'disabled') && folderCropEnabled;
            const folderPreprocessOrder = folderVideoConfig.preprocessOrder || 'crop-then-scale';
            
            html += '<div class="prop-group"><div class="prop-group-title">🎬 '+T.videoSettings+' ('+vidCount+')</div>' +
                '<div class="prop-row"><label>'+T.format+':</label><select onchange="updateFolderVideoConfig(\\'videoFormat\\',this.value)">' +
                '<option value="mjpeg"'+(currentVideoFormat==='mjpeg'?' selected':'')+'>MJPEG</option>' +
                '<option value="avi"'+(currentVideoFormat==='avi'?' selected':'')+'>AVI</option>' +
                '<option value="h264"'+(currentVideoFormat==='h264'?' selected':'')+'>H.264</option>' +
                '</select></div>' +
                '<div class="prop-row"><label>'+T.quality+':</label><input type="number" min="1" max="31" value="'+currentVideoQuality+'" onchange="updateFolderVideoConfig(\\'videoQuality\\',+this.value)"></div>' +
                '<div class="prop-row"><label>'+T.frameRate+':</label><input type="number" value="'+currentVideoFrameRate+'" placeholder="'+T.keepOriginal+'" onchange="updateFolderVideoConfig(\\'videoFrameRate\\',this.value?+this.value:null)"></div>' +
                '<div class="prop-row"><label>'+T.videoScale+':</label><select onchange="updateFolderVideoScaleConfig(\\'mode\\',this.value)">' +
                '<option value="disabled"'+(folderScaleMode==='disabled'?' selected':'')+'>'+T.disabled+'</option>' +
                '<option value="pixels"'+(folderScaleMode==='pixels'?' selected':'')+'>'+T.pixels+'</option>' +
                '<option value="percentage"'+(folderScaleMode==='percentage'?' selected':'')+'>'+T.percentage+'</option>' +
                '</select></div>' +
                (folderScaleMode==='pixels' ?
                    '<div class="prop-row"><label>'+T.width+':</label><input type="number" min="2" value="'+(folderScale&&folderScale.width!=null?folderScale.width:'')+'" placeholder="'+T.keepOriginal+'" onchange="updateFolderVideoScaleConfig(\\'width\\',this.value?+this.value:null)"></div>' +
                    '<div class="prop-row"><label>'+T.height+':</label><input type="number" min="2" value="'+(folderScale&&folderScale.height!=null?folderScale.height:'')+'" placeholder="'+T.keepOriginal+'" onchange="updateFolderVideoScaleConfig(\\'height\\',this.value?+this.value:null)"></div>'
                : folderScaleMode==='percentage' ?
                    '<div class="prop-row"><label>'+T.widthPct+':</label><input type="number" min="1" max="1000" value="'+(folderScale&&folderScale.widthPercentage!=null?folderScale.widthPercentage:'')+'" placeholder="'+T.keepOriginal+'" onchange="updateFolderVideoScaleConfig(\\'widthPercentage\\',this.value?+this.value:null)"></div>' +
                    '<div class="prop-row"><label>'+T.heightPct+':</label><input type="number" min="1" max="1000" value="'+(folderScale&&folderScale.heightPercentage!=null?folderScale.heightPercentage:'')+'" placeholder="'+T.keepOriginal+'" onchange="updateFolderVideoScaleConfig(\\'heightPercentage\\',this.value?+this.value:null)"></div>'
                : '') +
                '<div class="prop-row"><label>'+T.videoCrop+':</label><label style="width:auto;display:flex;align-items:center;gap:4px"><input type="checkbox" '+(folderCropEnabled?'checked':'')+' onchange="updateFolderVideoCropConfig(\\'enabled\\',this.checked)">'+T.enabled+'</label></div>' +
                (folderCropEnabled ?
                    '<div class="prop-row"><label>'+T.width+':</label><input type="number" min="2" value="'+(folderCrop&&folderCrop.width?folderCrop.width:'')+'" onchange="updateFolderVideoCropConfig(\\'width\\',this.value?+this.value:0)"></div>' +
                    '<div class="prop-row"><label>'+T.height+':</label><input type="number" min="2" value="'+(folderCrop&&folderCrop.height?folderCrop.height:'')+'" onchange="updateFolderVideoCropConfig(\\'height\\',this.value?+this.value:0)"></div>' +
                    '<div class="prop-row"><label>'+T.xPos+':</label><input type="number" min="0" value="'+(folderCrop&&folderCrop.x!=null?folderCrop.x:'')+'" placeholder="'+T.autoCenterHint+'" onchange="updateFolderVideoCropConfig(\\'x\\',this.value)"></div>' +
                    '<div class="prop-row"><label>'+T.yPos+':</label><input type="number" min="0" value="'+(folderCrop&&folderCrop.y!=null?folderCrop.y:'')+'" placeholder="'+T.autoCenterHint+'" onchange="updateFolderVideoCropConfig(\\'y\\',this.value)"></div>'
                : '') +
                (folderHasBoth ?
                    '<div class="prop-row"><label>'+T.preprocessOrder+':</label><select onchange="updateFolderVideoConfig(\\'preprocessOrder\\',this.value)">' +
                    '<option value="crop-then-scale"'+(folderPreprocessOrder==='crop-then-scale'?' selected':'')+'>'+T.cropThenScale+'</option>' +
                    '<option value="scale-then-crop"'+(folderPreprocessOrder==='scale-then-crop'?' selected':'')+'>'+T.scaleThenCrop+'</option>' +
                    '</select></div>'
                : '') +
                '</div>';
        }
        
        if (modCount > 0) {
            html += '<div class="prop-group"><div class="prop-group-title">📦 '+T.model3d+' ('+modCount+')</div><div style="font-size:11px;color:var(--vscode-descriptionForeground)">'+T.noExtraSettings+'</div></div>';
        }
        
        if (fntCount > 0) {
            const charsets = settings.font?.characterSets || [{type:'range',value:'0x20-0x7E'}];
            const isVector = settings.font?.outputFormat === 'vector';
            const displayFontSize = isVector ? 32 : (settings.font?.fontSize || 32);
            const displayRenderMode = isVector ? 8 : (settings.font?.renderMode || 4);
            html += '<div class="prop-group"><div class="prop-group-title">🔤 '+T.fontSettings+' ('+fntCount+')</div>' +
                '<div class="prop-row"><label>'+T.outputFormat+':</label><select onchange="handleFolderOutputFormatChange(this.value)">' +
                '<option value="bitmap"'+(!settings.font?.outputFormat||settings.font?.outputFormat==='bitmap'?' selected':'')+'>'+T.bitmapFont+'</option>' +
                '<option value="vector"'+(settings.font?.outputFormat==='vector'?' selected':'')+'>'+T.vectorFont+'</option>' +
                '</select></div>' +
                '<div class="prop-row"><label>'+T.fontSize+':<span title="'+(isVector?T.vectorFontPrecisionHint:T.bitmapFontSizeHint)+'" style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:10px;margin-left:4px;cursor:help;">?</span></label><input type="number" min="8" max="200" value="'+displayFontSize+'" onchange="updateFolderSetting(\\'font\\',\\'fontSize\\',+this.value)"></div>' +
                '<div class="prop-row"><label>'+T.renderMode+':</label><select onchange="updateFolderSetting(\\'font\\',\\'renderMode\\',+this.value)"'+(isVector?' disabled style="opacity:0.5"':'')+'>'+
                '<option value="1"'+(displayRenderMode===1?' selected':'')+'>'+T.bit1Mono+'</option>' +
                '<option value="2"'+(displayRenderMode===2?' selected':'')+'>'+T.bit2Gray4+'</option>' +
                '<option value="4"'+(displayRenderMode===4?' selected':'')+'>'+T.bit4Gray16+'</option>' +
                '<option value="8"'+(displayRenderMode===8?' selected':'')+'>'+T.bit8Gray256+'</option>' +
                '</select>'+(isVector ? '<span style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px">('+T.fixed+')</span>' : '')+'</div>' +
                '<div class="prop-row"><label>'+T.cropMode+':</label><select onchange="updateFolderSetting(\\'font\\',\\'crop\\',this.value)">' +
                '<option value="auto"'+(!settings.font?.crop||settings.font?.crop==='auto'?' selected':'')+'>'+T.auto+'</option>' +
                '<option value="true"'+(settings.font?.crop==='true'?' selected':'')+'>'+T.enabled+'</option>' +
                '<option value="false"'+(settings.font?.crop==='false'?' selected':'')+'>'+T.disabled+'</option>' +
                '</select></div>' +
                '<div class="prop-group-title" style="margin-top:8px">'+T.characterSet+'</div>' +
                '<div class="charset-list" id="folderCharsetList">' + renderCharsetItems(charsets, true) + '</div>' +
                '<button class="add-charset" onclick="addFolderCharset()">'+T.addCharacterSet+'</button>' +
                '</div>';
        }
        
        if (glsCount > 0) {
            html += '<div class="prop-group"><div class="prop-group-title">🔮 '+T.glassSettings+' ('+glsCount+')</div>' +
                '<div class="prop-row"><label>'+T.effectArea+':</label><input type="number" min="0" max="100" value="'+(settings.glass?.blurRadius||50)+'" onchange="updateFolderSetting(\\'glass\\',\\'blurRadius\\',+this.value)"><span style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px">%</span></div>' +
                '<div class="prop-row"><label>'+T.effectIntensity+':</label><input type="number" min="0" max="100" value="'+(settings.glass?.blurIntensity||50)+'" onchange="updateFolderSetting(\\'glass\\',\\'blurIntensity\\',+this.value)"><span style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px">%</span></div>' +
                '</div>';
        }
        
        props.innerHTML = html;
        return;
    }
    
    if (!selectedId) {
        props.innerHTML = '<div class="preview-area"></div><div class="no-selection">'+T.selectFileToViewSettings+'</div>';
        return;
    }
    
    const file = files.get(selectedId);
    if (!file) { props.innerHTML = '<div class="no-selection">'+T.failed+'</div>'; return; }
    
    const inherited = getInheritedSettings(file);
    const settings = file.settings || {};
    
    let html = '<div class="preview-area">';
    if (file.type === 'image') {
        html += '<img src="'+file.blobUrl+'">';
    } else if (file.type === 'video') {
        html += '<video src="'+file.blobUrl+'" controls muted style="max-height:150px"></video>';
    } else if (file.type === 'model') {
        html += '<div class="model-preview">📦</div>';
    } else if (file.type === 'glass') {
        // 玻璃效果：显示预览图或加载状态
        html += '<div id="glassPreviewArea">' +
            '<img id="glassPreviewImage" src="'+file.blobUrl+'" style="max-width:100%;max-height:180px;border-radius:4px">' +
            '<div id="glassPreviewLoading" style="display:none;padding:40px;color:var(--vscode-descriptionForeground);text-align:center">⏳ '+T.generatingPreview+'</div>' +
            '<div id="glassPreviewError" style="display:none;padding:10px;color:#f44;font-size:11px;text-align:center"></div>' +
            '</div>';
    } else {
        html += '<div class="model-preview">🔤</div>';
    }
    html += '</div>';
    
    html += '<div class="file-name">'+file.name+'</div>';
    if (file.relativePath) html += '<div class="file-path">📁 '+file.relativePath+'</div>';
    
    if (file.type === 'image') {
        // 使用 conversion.json 配置
        const imagePath = file.relativePath ? file.relativePath + '/' + file.name : file.name;
        const imageConfig = getImageConversionConfig(imagePath) || {};
        const effectiveConfig = resolveEffectiveConfig(imagePath);
        const currentFormat = imageConfig.format || 'inherit';
        const currentCompression = imageConfig.compression || effectiveConfig.compression || 'none';
        const isInherited = !imageConfig.format || imageConfig.format === 'inherit';
        
        html += '<div class="prop-group"><div class="prop-group-title">'+T.conversionConfig+(isInherited?' <span style="color:var(--vscode-descriptionForeground)">('+T.inheritedFrom+': '+effectiveConfig.inheritedFrom+')</span>':'')+'</div>' +
            '<div class="prop-row"><label>'+T.targetFormat+':</label><select onchange="updateImageConfig(\\'format\\',this.value)">' +
            '<option value="inherit"'+(currentFormat==='inherit'?' selected':'')+'>'+T.inherit+' ('+(effectiveConfig.format||T.adaptive16)+')</option>' +
            '<option value="RGB565"'+(currentFormat==='RGB565'?' selected':'')+'>RGB565</option>' +
            '<option value="RGB888"'+(currentFormat==='RGB888'?' selected':'')+'>RGB888</option>' +
            '<option value="ARGB8565"'+(currentFormat==='ARGB8565'?' selected':'')+'>ARGB8565</option>' +
            '<option value="ARGB8888"'+(currentFormat==='ARGB8888'?' selected':'')+'>ARGB8888</option>' +
            '<option value="I8"'+(currentFormat==='I8'?' selected':'')+'>I8</option>' +
            '<option value="A8"'+(currentFormat==='A8'?' selected':'')+'>A8</option>' +
            '<option value="A4"'+(currentFormat==='A4'?' selected':'')+'>A4</option>' +
            '<option value="A2"'+(currentFormat==='A2'?' selected':'')+'>A2</option>' +
            '<option value="A1"'+(currentFormat==='A1'?' selected':'')+'>A1</option>' +
            '</select></div>' +
            '<div class="prop-row"><label>'+T.compression+':</label><select onchange="updateImageConfig(\\'compression\\',this.value)">' +
            '<option value="none"'+(currentCompression==='none'?' selected':'')+'>'+T.noCompression+'</option>' +
            '<option value="rle"'+(currentCompression==='rle'?' selected':'')+'>RLE</option>' +
            '<option value="fastlz"'+(currentCompression==='fastlz'?' selected':'')+'>FastLZ</option>' +
            '<option value="yuv"'+(currentCompression==='yuv'?' selected':'')+'>YUV</option>' +
            '</select></div>' +
            '<div class="prop-row"><label></label><label style="width:auto;display:flex;align-items:center;gap:4px" title="'+T.ditherHint+'"><input type="checkbox" '+(imageConfig.dither===true||(imageConfig.dither===undefined && effectiveConfig.dither!==false)?'checked':'')+' onchange="updateImageConfig(\\'dither\\',this.checked)">'+T.enableDither+'</label></div>';
        
        // YUV 参数
        if (currentCompression === 'yuv') {
            const yuvParams = imageConfig.yuvParams || effectiveConfig.yuvParams || { sampling: 'YUV422', blur: 'none', fastlzSecondary: false };
            html += '<div class="prop-row"><label>'+T.yuvSampling+':</label><select onchange="updateImageYuvParam(\\'sampling\\',this.value)">' +
                '<option value="YUV444"'+(yuvParams.sampling==='YUV444'?' selected':'')+'>YUV444</option>' +
                '<option value="YUV422"'+(yuvParams.sampling==='YUV422'?' selected':'')+'>YUV422</option>' +
                '<option value="YUV411"'+(yuvParams.sampling==='YUV411'?' selected':'')+'>YUV411</option>' +
                '</select></div>' +
                '<div class="prop-row"><label>'+T.blurLevel+':</label><select onchange="updateImageYuvParam(\\'blur\\',this.value)">' +
                '<option value="none"'+(yuvParams.blur==='none'?' selected':'')+'>'+T.none+'</option>' +
                '<option value="1bit"'+(yuvParams.blur==='1bit'?' selected':'')+'>1bit</option>' +
                '<option value="2bit"'+(yuvParams.blur==='2bit'?' selected':'')+'>2bit</option>' +
                '<option value="4bit"'+(yuvParams.blur==='4bit'?' selected':'')+'>4bit</option>' +
                '</select></div>' +
                '<div class="prop-row"><label></label><label style="width:auto;display:flex;align-items:center;gap:4px"><input type="checkbox" '+(yuvParams.fastlzSecondary?'checked':'')+' onchange="updateImageYuvParam(\\'fastlzSecondary\\',this.checked)">'+T.fastlzSecondary+'</label></div>';
        }
        html += '</div>';
    } else if (file.type === 'video') {
        // 使用 conversion.json 配置
        const videoPath = file.relativePath ? file.relativePath + '/' + file.name : file.name;
        const videoConfig = getImageConversionConfig(videoPath) || {};
        const effectiveConfig = resolveEffectiveConfig(videoPath);
        const currentFormat = videoConfig.videoFormat || '';
        const currentQuality = videoConfig.videoQuality || '';
        const currentFrameRate = videoConfig.videoFrameRate || '';
        const inheritedFormat = effectiveConfig.videoFormat || 'mjpeg';
        const inheritedQuality = effectiveConfig.videoQuality || 1;
        const inheritedFrameRate = effectiveConfig.videoFrameRate || '';
        const currentScale = videoConfig.videoScale;
        const scaleMode = currentScale ? currentScale.mode : 'disabled';
        const currentCrop = videoConfig.videoCrop;
        const cropEnabled = !!currentCrop;
        const hasBothScaleAndCrop = (scaleMode !== 'disabled') && cropEnabled;
        const currentPreprocessOrder = videoConfig.preprocessOrder || 'crop-then-scale';
        const videoInfo = videoInfoCache.get(selectedId);
        const origW = (videoInfo && videoInfo.width) || 0;
        const origH = (videoInfo && videoInfo.height) || 0;
        // Scale base depends on preprocess order:
        // crop-then-scale → base is cropped dimensions; scale-then-crop → base is original dimensions
        const cropW = currentCrop && currentCrop.width ? currentCrop.width : 0;
        const cropH = currentCrop && currentCrop.height ? currentCrop.height : 0;
        const scaleBaseW = (cropEnabled && currentPreprocessOrder === 'crop-then-scale' && cropW && cropH) ? cropW : origW;
        const scaleBaseH = (cropEnabled && currentPreprocessOrder === 'crop-then-scale' && cropW && cropH) ? cropH : origH;
        currentScaleBase = { w: scaleBaseW, h: scaleBaseH };
        const scaleWVal = currentScale && currentScale.width != null ? currentScale.width : null;
        const scaleHVal = currentScale && currentScale.height != null ? currentScale.height : null;
        const wPropHint = (scaleBaseW && scaleBaseH && scaleHVal !== null && scaleWVal === null) ? String(Math.round(scaleHVal * scaleBaseW / scaleBaseH / 2) * 2) : T.keepOriginal;
        const hPropHint = (scaleBaseW && scaleBaseH && scaleWVal !== null && scaleHVal === null) ? String(Math.round(scaleWVal * scaleBaseH / scaleBaseW / 2) * 2) : T.keepOriginal;
        const scaleWPctVal = currentScale && currentScale.widthPercentage != null ? currentScale.widthPercentage : null;
        const scaleHPctVal = currentScale && currentScale.heightPercentage != null ? currentScale.heightPercentage : null;
        const wPctHint = (scaleHPctVal !== null && scaleWPctVal === null) ? String(scaleHPctVal) : T.keepOriginal;
        const hPctHint = (scaleWPctVal !== null && scaleHPctVal === null) ? String(scaleWPctVal) : T.keepOriginal;
        
        html += '<div class="prop-group"><div class="prop-group-title">'+T.conversionConfig+'</div>' +
            (origW && origH ? '<div class="prop-row"><label>'+T.originalSize+':</label><span style="font-size:11px;color:var(--vscode-descriptionForeground)">'+origW+'×'+origH+'</span></div>' : '') +
            '<div class="prop-row"><label>'+T.format+':</label><select onchange="updateVideoConfig(\\'videoFormat\\',this.value)">' +
            '<option value=""'+(!currentFormat?' selected':'')+'>'+T.inherit+' ('+inheritedFormat.toUpperCase()+')</option>' +
            '<option value="mjpeg"'+(currentFormat==='mjpeg'?' selected':'')+'>MJPEG</option>' +
            '<option value="avi"'+(currentFormat==='avi'?' selected':'')+'>AVI</option>' +
            '<option value="h264"'+(currentFormat==='h264'?' selected':'')+'>H.264</option>' +
            '</select></div>' +
            '<div class="prop-row"><label>'+T.quality+':</label><input type="number" min="1" max="31" value="'+currentQuality+'" placeholder="'+T.inherit+' ('+inheritedQuality+')" onchange="updateVideoConfig(\\'videoQuality\\',this.value?+this.value:null)"></div>' +
            '<div class="prop-row"><label>'+T.frameRate+':</label><input type="number" value="'+currentFrameRate+'" placeholder="'+(inheritedFrameRate||T.keepOriginal)+'" onchange="updateVideoConfig(\\'videoFrameRate\\',this.value?+this.value:null)"></div>' +
            '<div class="prop-row"><label>'+T.videoScale+':</label><select onchange="updateVideoScaleConfig(\\'mode\\',this.value)">' +
            '<option value="disabled"'+(scaleMode==='disabled'?' selected':'')+'>'+T.disabled+'</option>' +
            '<option value="pixels"'+(scaleMode==='pixels'?' selected':'')+'>'+T.pixels+'</option>' +
            '<option value="percentage"'+(scaleMode==='percentage'?' selected':'')+'>'+T.percentage+'</option>' +
            '</select></div>' +
            (scaleMode==='pixels' ?
                '<div class="prop-row"><label>'+T.width+':</label><input id="scaleWidthInput" type="number" min="2" value="'+(scaleWVal!=null?scaleWVal:'')+'" placeholder="'+wPropHint+'" oninput="onScaleWidthInput(this.value)" onchange="updateVideoScaleConfig(\\'width\\',this.value?+this.value:null)"></div>' +
                '<div class="prop-row"><label>'+T.height+':</label><input id="scaleHeightInput" type="number" min="2" value="'+(scaleHVal!=null?scaleHVal:'')+'" placeholder="'+hPropHint+'" oninput="onScaleHeightInput(this.value)" onchange="updateVideoScaleConfig(\\'height\\',this.value?+this.value:null)"></div>'
            : scaleMode==='percentage' ?
                '<div class="prop-row"><label>'+T.widthPct+':</label><input id="scaleWidthPctInput" type="number" min="1" max="1000" value="'+(scaleWPctVal!=null?scaleWPctVal:'')+'" placeholder="'+wPctHint+'" oninput="onScaleWidthPctInput(this.value)" onchange="updateVideoScaleConfig(\\'widthPercentage\\',this.value?+this.value:null)"></div>' +
                '<div class="prop-row"><label>'+T.heightPct+':</label><input id="scaleHeightPctInput" type="number" min="1" max="1000" value="'+(scaleHPctVal!=null?scaleHPctVal:'')+'" placeholder="'+hPctHint+'" oninput="onScaleHeightPctInput(this.value)" onchange="updateVideoScaleConfig(\\'heightPercentage\\',this.value?+this.value:null)"></div>'
            : '') +
            '<div class="prop-row"><label>'+T.videoCrop+':</label><label style="width:auto;display:flex;align-items:center;gap:4px"><input type="checkbox" '+(cropEnabled?'checked':'')+' onchange="updateVideoCropConfig(\\'enabled\\',this.checked)">'+T.enabled+'</label></div>' +
            (cropEnabled ?
                '<div class="prop-row"><label>'+T.width+':</label><input type="number" min="2" value="'+(currentCrop&&currentCrop.width?currentCrop.width:'')+'" onchange="updateVideoCropConfig(\\'width\\',this.value?+this.value:0)"></div>' +
                '<div class="prop-row"><label>'+T.height+':</label><input type="number" min="2" value="'+(currentCrop&&currentCrop.height?currentCrop.height:'')+'" onchange="updateVideoCropConfig(\\'height\\',this.value?+this.value:0)"></div>' +
                '<div class="prop-row"><label>'+T.xPos+':</label><input type="number" min="0" value="'+(currentCrop&&currentCrop.x!=null?currentCrop.x:'')+'" placeholder="'+T.autoCenterHint+'" onchange="updateVideoCropConfig(\\'x\\',this.value)"></div>' +
                '<div class="prop-row"><label>'+T.yPos+':</label><input type="number" min="0" value="'+(currentCrop&&currentCrop.y!=null?currentCrop.y:'')+'" placeholder="'+T.autoCenterHint+'" onchange="updateVideoCropConfig(\\'y\\',this.value)"></div>'
            : '') +
            (hasBothScaleAndCrop ?
                '<div class="prop-row"><label>'+T.preprocessOrder+':</label><select onchange="updateVideoConfig(\\'preprocessOrder\\',this.value)">' +
                '<option value="crop-then-scale"'+(currentPreprocessOrder==='crop-then-scale'?' selected':'')+'>'+T.cropThenScale+'</option>' +
                '<option value="scale-then-crop"'+(currentPreprocessOrder==='scale-then-crop'?' selected':'')+'>'+T.scaleThenCrop+'</option>' +
                '</select></div>'
            : '') +
            '</div>';
    } else if (file.type === 'font') {
        const ifnt = inherited.font || {};
        const charsets = settings.characterSets || ifnt.characterSets || [{type:'range',value:'0x20-0x7E'}];
        const effectiveOutputFormat = settings.outputFormat || ifnt.outputFormat || 'bitmap';
        const isVector = effectiveOutputFormat === 'vector';
        const displayFontSize = isVector ? 32 : (settings.fontSize || ifnt.fontSize || 32);
        const displayRenderMode = isVector ? 8 : (settings.renderMode || ifnt.renderMode || 4);
        html += '<div class="prop-group"><div class="prop-group-title">'+T.conversionConfig+'</div>' +
            '<div class="prop-row"><label>'+T.outputFormat+':</label><select onchange="handleFileOutputFormatChange(this.value)">' +
            '<option value=""'+(!settings.outputFormat?' selected':'')+'>'+T.inherit+' ('+(ifnt.outputFormat==='vector'?T.vectorFont:T.bitmapFont)+')</option>' +
            '<option value="bitmap"'+(settings.outputFormat==='bitmap'?' selected':'')+'>'+T.bitmapFont+'</option>' +
            '<option value="vector"'+(settings.outputFormat==='vector'?' selected':'')+'>'+T.vectorFont+'</option>' +
            '</select></div>' +
            '<div class="prop-row"><label>'+T.fontSize+':<span title="'+(isVector?T.vectorFontPrecisionHint:T.bitmapFontSizeHint)+'" style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:10px;margin-left:4px;cursor:help;">?</span></label><input type="number" min="8" max="200" value="'+(settings.fontSize||'')+'" placeholder="'+T.inherit+' ('+(ifnt.fontSize||32)+')" onchange="updateSetting(\\'fontSize\\',this.value?+this.value:null)"></div>' +
            '<div class="prop-row"><label>'+T.renderMode+':</label><select onchange="updateSetting(\\'renderMode\\',this.value?+this.value:null)"'+(isVector?' disabled style="opacity:0.5"':'')+'>'+
            '<option value=""'+(!settings.renderMode&&!isVector?' selected':'')+'>'+T.inherit+' ('+(ifnt.renderMode||4)+'bit)</option>' +
            '<option value="1"'+(!isVector&&settings.renderMode===1?' selected':'')+'>'+T.bit1Mono+'</option>' +
            '<option value="2"'+(!isVector&&settings.renderMode===2?' selected':'')+'>'+T.bit2Gray4+'</option>' +
            '<option value="4"'+(!isVector&&settings.renderMode===4?' selected':'')+'>'+T.bit4Gray16+'</option>' +
            '<option value="8"'+(isVector||settings.renderMode===8?' selected':'')+'>'+T.bit8Gray256+'</option>' +
            '</select>'+(isVector ? '<span style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px">('+T.fixed+')</span>' : '')+'</div>' +
            '<div class="prop-row"><label>'+T.cropMode+':</label><select onchange="updateSetting(\\'crop\\',this.value||null)">' +
            '<option value=""'+(!settings.crop?' selected':'')+'>'+T.inherit+' ('+(ifnt.crop==='true'?T.enabled:ifnt.crop==='false'?T.disabled:T.auto)+')</option>' +
            '<option value="auto"'+(settings.crop==='auto'?' selected':'')+'>'+T.auto+'</option>' +
            '<option value="true"'+(settings.crop==='true'?' selected':'')+'>'+T.enabled+'</option>' +
            '<option value="false"'+(settings.crop==='false'?' selected':'')+'>'+T.disabled+'</option>' +
            '</select></div>' +
            '<div class="prop-group-title" style="margin-top:8px">'+T.characterSet+'</div>' +
            '<div class="charset-list" id="fileCharsetList">' + renderCharsetItems(charsets, false) + '</div>' +
            '<button class="add-charset" onclick="addFileCharset()">'+T.addCharacterSet+'</button>' +
            '<div id="fileCharsetStats" class="charset-stats"></div>' +
            '<div id="fileCharsetWarn" class="charset-stats-warn"></div>' +
            '</div>';
    } else if (file.type === 'glass') {
        const igls = inherited.glass || {};
        html += '<div class="prop-group"><div class="prop-group-title">'+T.conversionConfig+'</div>' +
            '<div class="prop-row"><label>'+T.effectArea+':</label><input type="number" min="0" max="100" value="'+(settings.blurRadius||'')+'" placeholder="'+T.inherit+' ('+(igls.blurRadius||50)+')" onchange="updateGlassSetting(\\'blurRadius\\',this.value?+this.value:null)"><span style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px">%</span></div>' +
            '<div class="prop-row"><label>'+T.effectIntensity+':</label><input type="number" min="0" max="100" value="'+(settings.blurIntensity||'')+'" placeholder="'+T.inherit+' ('+(igls.blurIntensity||50)+')" onchange="updateGlassSetting(\\'blurIntensity\\',this.value?+this.value:null)"><span style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px">%</span></div>' +
            '</div>';
        // 选中 glass 文件时自动请求预览
        setTimeout(() => requestGlassPreview(), 100);
    } else {
        html += '<div class="prop-group"><div class="prop-group-title">'+T.conversionConfig+'</div><div style="font-size:11px;color:var(--vscode-descriptionForeground)">'+T.noExtraSettings+'</div></div>';
    }
    
    props.innerHTML = html;
}

function getInheritedSettings(file) {
    if (!file.relativePath) return {};
    const parts = file.relativePath.split('/');
    for (let i = parts.length; i > 0; i--) {
        const folderPath = parts.slice(0, i).join('/');
        if (folderSettings[folderPath]) return folderSettings[folderPath];
    }
    return {};
}

function updateFolderSetting(category, key, value) {
    if (!folderSettings[selectedFolder]) folderSettings[selectedFolder] = {};
    if (!folderSettings[selectedFolder][category]) folderSettings[selectedFolder][category] = {};
    if (value === null) delete folderSettings[selectedFolder][category][key];
    else folderSettings[selectedFolder][category][key] = value;
    vscode.postMessage({type:'updateFolderSettings', folderPath: selectedFolder, settings: folderSettings[selectedFolder]});
}

// 更新文件夹的图片转换配置（保存到 conversion.json）
function updateFolderImageConfig(key, value) {
    if (!selectedFolder) return;
    const currentConfig = getFolderConversionConfig(selectedFolder) || {};
    const newConfig = { ...currentConfig };
    
    if (value === null || value === '') {
        delete newConfig[key];
    } else {
        newConfig[key] = value;
    }
    
    // 如果选择 YUV 压缩但没有 yuvParams，添加默认值
    if (key === 'compression' && value === 'yuv' && !newConfig.yuvParams) {
        newConfig.yuvParams = { sampling: 'YUV422', blur: 'none', fastlzSecondary: false };
    }
    // 如果不是 YUV 压缩，移除 yuvParams
    if (key === 'compression' && value !== 'yuv') {
        delete newConfig.yuvParams;
    }
    
    updateConversionConfig(selectedFolder, newConfig);
    renderProperties();
}

// 更新文件夹的 YUV 参数
function updateFolderYuvParam(key, value) {
    if (!selectedFolder) return;
    const currentConfig = getFolderConversionConfig(selectedFolder) || {};
    const yuvParams = currentConfig.yuvParams || { sampling: 'YUV422', blur: 'none', fastlzSecondary: false };
    yuvParams[key] = value;
    
    const newConfig = { ...currentConfig, yuvParams };
    updateConversionConfig(selectedFolder, newConfig);
    renderProperties();
}

// 更新文件夹的视频转换配置（保存到 conversion.json）
function updateFolderVideoConfig(key, value) {
    if (!selectedFolder) return;
    const currentConfig = getFolderConversionConfig(selectedFolder) || {};
    const newConfig = { ...currentConfig };
    
    if (value === null || value === '') {
        delete newConfig[key];
    } else {
        newConfig[key] = value;
    }
    
    updateConversionConfig(selectedFolder, newConfig);
    renderProperties();
}

// 更新单个图片的转换配置
function updateImageConfig(key, value) {
    const file = files.get(selectedId);
    if (!file || file.type !== 'image') return;
    
    const imagePath = file.relativePath ? file.relativePath + '/' + file.name : file.name;
    const currentConfig = getImageConversionConfig(imagePath) || {};
    const newConfig = { ...currentConfig };
    
    if (value === null || value === '' || value === 'inherit') {
        delete newConfig[key];
    } else {
        newConfig[key] = value;
    }
    
    // 如果选择 YUV 压缩但没有 yuvParams，添加默认值
    if (key === 'compression' && value === 'yuv' && !newConfig.yuvParams) {
        newConfig.yuvParams = { sampling: 'YUV422', blur: 'none', fastlzSecondary: false };
    }
    // 如果不是 YUV 压缩，移除 yuvParams
    if (key === 'compression' && value !== 'yuv') {
        delete newConfig.yuvParams;
    }
    
    updateConversionConfig(imagePath, newConfig);
    renderProperties();
}

// 更新单个图片的 YUV 参数
function updateImageYuvParam(key, value) {
    const file = files.get(selectedId);
    if (!file || file.type !== 'image') return;
    
    const imagePath = file.relativePath ? file.relativePath + '/' + file.name : file.name;
    const currentConfig = getImageConversionConfig(imagePath) || {};
    const yuvParams = currentConfig.yuvParams || { sampling: 'YUV422', blur: 'none', fastlzSecondary: false };
    yuvParams[key] = value;
    
    const newConfig = { ...currentConfig, yuvParams };
    updateConversionConfig(imagePath, newConfig);
    renderProperties();
}

// 更新单个视频的转换配置（保存到 conversion.json）
function updateVideoConfig(key, value) {
    const file = files.get(selectedId);
    if (!file || file.type !== 'video') return;
    
    const videoPath = file.relativePath ? file.relativePath + '/' + file.name : file.name;
    const currentConfig = getImageConversionConfig(videoPath) || {};
    const newConfig = { ...currentConfig };
    
    if (value === null || value === '') {
        delete newConfig[key];
    } else {
        newConfig[key] = value;
    }
    
    updateConversionConfig(videoPath, newConfig);
    renderProperties();
}

// 更新单个视频的缩放配置
function updateVideoScaleConfig(field, value) {
    const file = files.get(selectedId);
    if (!file || file.type !== 'video') return;
    const videoPath = file.relativePath ? file.relativePath + '/' + file.name : file.name;
    const currentConfig = getImageConversionConfig(videoPath) || {};
    const newConfig = { ...currentConfig };
    if (field === 'mode') {
        if (value === 'disabled') {
            delete newConfig.videoScale;
            delete newConfig.preprocessOrder;
        } else {
            const oldMode = newConfig.videoScale && newConfig.videoScale.mode;
            const info = videoInfoCache.get(selectedId);
            if (oldMode === 'pixels' && value === 'percentage' && info && info.width && info.height) {
                // pixels → percentage: convert stored pixel values to percentages (crop-order-aware base)
                const cropCfg = newConfig.videoCrop;
                const ppOrder = newConfig.preprocessOrder || 'crop-then-scale';
                const bW = (cropCfg && ppOrder === 'crop-then-scale' && cropCfg.width && cropCfg.height) ? cropCfg.width : info.width;
                const bH = (cropCfg && ppOrder === 'crop-then-scale' && cropCfg.width && cropCfg.height) ? cropCfg.height : info.height;
                const old = newConfig.videoScale || {};
                newConfig.videoScale = { mode: 'percentage' };
                if (old.width != null) newConfig.videoScale.widthPercentage = Math.round(old.width / bW * 100 * 10) / 10;
                if (old.height != null) newConfig.videoScale.heightPercentage = Math.round(old.height / bH * 100 * 10) / 10;
            } else if (oldMode === 'percentage' && value === 'pixels' && info && info.width && info.height) {
                // percentage → pixels: convert stored percentages to pixel values (crop-order-aware base)
                const cropCfg = newConfig.videoCrop;
                const ppOrder = newConfig.preprocessOrder || 'crop-then-scale';
                const bW = (cropCfg && ppOrder === 'crop-then-scale' && cropCfg.width && cropCfg.height) ? cropCfg.width : info.width;
                const bH = (cropCfg && ppOrder === 'crop-then-scale' && cropCfg.width && cropCfg.height) ? cropCfg.height : info.height;
                const old = newConfig.videoScale || {};
                newConfig.videoScale = { mode: 'pixels' };
                if (old.widthPercentage != null) newConfig.videoScale.width = Math.round(bW * old.widthPercentage / 100 / 2) * 2;
                if (old.heightPercentage != null) newConfig.videoScale.height = Math.round(bH * old.heightPercentage / 100 / 2) * 2;
            } else {
                newConfig.videoScale = { ...newConfig.videoScale, mode: value };
            }
        }
    } else {
        if (!newConfig.videoScale) newConfig.videoScale = { mode: 'pixels' };
        if (value === null) { delete newConfig.videoScale[field]; }
        else { newConfig.videoScale[field] = value; }
    }
    updateConversionConfig(videoPath, newConfig);
    renderProperties();
}

// 更新单个视频的裁剪配置
function updateVideoCropConfig(field, value) {
    const file = files.get(selectedId);
    if (!file || file.type !== 'video') return;
    const videoPath = file.relativePath ? file.relativePath + '/' + file.name : file.name;
    const currentConfig = getImageConversionConfig(videoPath) || {};
    const newConfig = { ...currentConfig };
    if (field === 'enabled') {
        if (!value) {
            delete newConfig.videoCrop;
            delete newConfig.preprocessOrder;
        } else {
            newConfig.videoCrop = newConfig.videoCrop || { width: 100, height: 100 };
        }
    } else if (field === 'x' || field === 'y') {
        if (!newConfig.videoCrop) newConfig.videoCrop = { width: 100, height: 100 };
        if (value === '' || value === null) { delete newConfig.videoCrop[field]; }
        else { newConfig.videoCrop[field] = +value; }
    } else {
        if (!newConfig.videoCrop) newConfig.videoCrop = { width: 100, height: 100 };
        if (value === null) { delete newConfig.videoCrop[field]; }
        else { newConfig.videoCrop[field] = value; }
    }
    updateConversionConfig(videoPath, newConfig);
    renderProperties();
}

// 更新文件夹视频缩放配置
function updateFolderVideoScaleConfig(field, value) {
    if (!selectedFolder) return;
    const currentConfig = getFolderConversionConfig(selectedFolder) || {};
    const newConfig = { ...currentConfig };
    if (field === 'mode') {
        if (value === 'disabled') {
            delete newConfig.videoScale;
            delete newConfig.preprocessOrder;
        } else {
            newConfig.videoScale = { ...newConfig.videoScale, mode: value };
        }
    } else {
        if (!newConfig.videoScale) newConfig.videoScale = { mode: 'pixels' };
        if (value === null) { delete newConfig.videoScale[field]; }
        else { newConfig.videoScale[field] = value; }
    }
    updateConversionConfig(selectedFolder, newConfig);
    renderProperties();
}

// 更新文件夹视频裁剪配置
function updateFolderVideoCropConfig(field, value) {
    if (!selectedFolder) return;
    const currentConfig = getFolderConversionConfig(selectedFolder) || {};
    const newConfig = { ...currentConfig };
    if (field === 'enabled') {
        if (!value) {
            delete newConfig.videoCrop;
            delete newConfig.preprocessOrder;
        } else {
            newConfig.videoCrop = newConfig.videoCrop || { width: 100, height: 100 };
        }
    } else if (field === 'x' || field === 'y') {
        if (!newConfig.videoCrop) newConfig.videoCrop = { width: 100, height: 100 };
        if (value === '' || value === null) { delete newConfig.videoCrop[field]; }
        else { newConfig.videoCrop[field] = +value; }
    } else {
        if (!newConfig.videoCrop) newConfig.videoCrop = { width: 100, height: 100 };
        if (value === null) { delete newConfig.videoCrop[field]; }
        else { newConfig.videoCrop[field] = value; }
    }
    updateConversionConfig(selectedFolder, newConfig);
    renderProperties();
}

// 动态计算等比例缩放提示（oninput 实时更新）
function onScaleWidthInput(value) {
    const { w, h } = currentScaleBase;
    if (!w || !h) return;
    const hInput = document.getElementById('scaleHeightInput');
    if (!hInput || hInput.value !== '') return;
    hInput.placeholder = value ? String(Math.round(+value * h / w / 2) * 2) : T.keepOriginal;
}

function onScaleHeightInput(value) {
    const { w, h } = currentScaleBase;
    if (!w || !h) return;
    const wInput = document.getElementById('scaleWidthInput');
    if (!wInput || wInput.value !== '') return;
    wInput.placeholder = value ? String(Math.round(+value * w / h / 2) * 2) : T.keepOriginal;
}

function onScaleWidthPctInput(value) {
    const hInput = document.getElementById('scaleHeightPctInput');
    if (!hInput || hInput.value !== '') return;
    hInput.placeholder = value || T.keepOriginal;
}

function onScaleHeightPctInput(value) {
    const wInput = document.getElementById('scaleWidthPctInput');
    if (!wInput || wInput.value !== '') return;
    wInput.placeholder = value || T.keepOriginal;
}

function updateSetting(key, value) {
    const file = files.get(selectedId);
    if (!file) return;
    if (!file.settings) file.settings = {};
    if (value === null) delete file.settings[key];
    else file.settings[key] = value;
    vscode.postMessage({type:'updateFileSettings', id:selectedId, settings: file.settings});
    if (file.type === 'font' && (key === 'fontSize' || key === 'renderMode')) {
        scheduleCharsetStats();
    }
}

// 保存点阵字体设置的临时存储
const bitmapFontSettings = {
    folder: {},  // folderPath -> {fontSize, renderMode}
    file: {}     // fileId -> {fontSize, renderMode}
};

function handleFolderOutputFormatChange(value) {
    const settings = folderSettings[selectedFolder] || {};
    const currentFontSettings = settings.font || {};
    
    if (value === 'vector') {
        // 切换到矢量字体：保存当前设置
        bitmapFontSettings.folder[selectedFolder] = {
            fontSize: currentFontSettings.fontSize || 32,
            renderMode: currentFontSettings.renderMode || 4
        };
        // 设置矢量字体固定值
        updateFolderSetting('font', 'outputFormat', 'vector');
        updateFolderSetting('font', 'fontSize', 32);
        updateFolderSetting('font', 'renderMode', 8);
    } else {
        // 切换到点阵字体：恢复之前保存的设置
        const saved = bitmapFontSettings.folder[selectedFolder] || {};
        updateFolderSetting('font', 'outputFormat', 'bitmap');
        if (saved.fontSize) updateFolderSetting('font', 'fontSize', saved.fontSize);
        if (saved.renderMode) updateFolderSetting('font', 'renderMode', saved.renderMode);
    }
    renderProperties();
}

function handleFileOutputFormatChange(value) {
    const file = files.get(selectedId);
    if (!file) return;
    const settings = file.settings || {};
    
    if (value === 'vector') {
        // 切换到矢量字体：保存当前设置
        bitmapFontSettings.file[selectedId] = {
            fontSize: settings.fontSize,
            renderMode: settings.renderMode
        };
        // 设置矢量字体固定值
        updateSetting('outputFormat', 'vector');
        updateSetting('fontSize', 32);
        updateSetting('renderMode', 8);
    } else if (value === 'bitmap') {
        // 切换到点阵字体：恢复之前保存的设置
        const saved = bitmapFontSettings.file[selectedId] || {};
        updateSetting('outputFormat', 'bitmap');
        if (saved.fontSize) updateSetting('fontSize', saved.fontSize);
        else updateSetting('fontSize', null);
        if (saved.renderMode) updateSetting('renderMode', saved.renderMode);
        else updateSetting('renderMode', null);
    } else {
        // 继承：清除设置
        const saved = bitmapFontSettings.file[selectedId] || {};
        updateSetting('outputFormat', null);
        if (saved.fontSize) updateSetting('fontSize', saved.fontSize);
        else updateSetting('fontSize', null);
        if (saved.renderMode) updateSetting('renderMode', saved.renderMode);
        else updateSetting('renderMode', null);
    }
    renderProperties();
}

// 字符集相关函数
function renderCharsetItems(charsets, isFolder) {
    return charsets.map((cs, i) => {
        const prefix = isFolder ? 'folder' : 'file';
        const needBrowse = cs.type === 'file' || cs.type === 'codepage';
        const placeholders = {range:T.rangeFormat, string:T.customChars, file:T.browse, codepage:T.browse};
        const hints = {range:T.rangeFormat, string:'', file:T.cstTxtFile, codepage:T.egCP936};
        // 文件类型只显示文件名
        const displayValue = needBrowse && cs.value ? cs.value.split(/[\\\\/]/).pop() : (cs.value || '');
        return '<div class="charset-item">' +
            '<div class="charset-row">' +
            '<select onchange="updateCharsetType('+i+',this.value,'+isFolder+')">' +
            '<option value="range"'+(cs.type==='range'?' selected':'')+'>'+T.unicodeRange+'</option>' +
            '<option value="string"'+(cs.type==='string'?' selected':'')+'>'+T.customChars+'</option>' +
            '<option value="file"'+(cs.type==='file'?' selected':'')+'>'+T.charsetFile+'</option>' +
            '<option value="codepage"'+(cs.type==='codepage'?' selected':'')+'>'+T.codepageFile+'</option>' +
            '</select>' +
            '<input type="text" id="'+prefix+'Charset'+i+'" value="'+displayValue+'" placeholder="'+placeholders[cs.type]+'" onchange="updateCharsetValue('+i+',this.value,'+isFolder+')"'+(needBrowse?' readonly':'')+' title="'+(cs.value||'')+'">' +
            (needBrowse ? '<button class="browse-btn" onclick="browseCharsetFile('+i+',\\''+cs.type+'\\','+isFolder+')">'+T.browse+'</button>' : '') +
            (charsets.length > 1 ? '<span class="remove-charset" onclick="removeCharset('+i+','+isFolder+')">✕</span>' : '') +
            '</div>' +
            (hints[cs.type] ? '<div class="charset-hint">'+hints[cs.type]+'</div>' : '') +
            '</div>';
    }).join('');
}

function getCharsets(isFolder) {
    if (isFolder) {
        const settings = folderSettings[selectedFolder] || {};
        return settings.font?.characterSets || [{type:'range',value:'0x20-0x7E'}];
    } else {
        const file = files.get(selectedId);
        const inherited = getInheritedSettings(file);
        return file?.settings?.characterSets || inherited.font?.characterSets || [{type:'range',value:'0x20-0x7E'}];
    }
}

function setCharsets(charsets, isFolder) {
    if (isFolder) {
        if (!folderSettings[selectedFolder]) folderSettings[selectedFolder] = {};
        if (!folderSettings[selectedFolder].font) folderSettings[selectedFolder].font = {};
        folderSettings[selectedFolder].font.characterSets = charsets;
        vscode.postMessage({type:'updateFolderSettings', folderPath: selectedFolder, settings: folderSettings[selectedFolder]});
    } else {
        const file = files.get(selectedId);
        if (!file) return;
        if (!file.settings) file.settings = {};
        file.settings.characterSets = charsets;
        vscode.postMessage({type:'updateFileSettings', id:selectedId, settings: file.settings});
    }
    refreshCharsetList(isFolder);
}

function refreshCharsetList(isFolder) {
    const listId = isFolder ? 'folderCharsetList' : 'fileCharsetList';
    const list = document.getElementById(listId);
    if (list) list.innerHTML = renderCharsetItems(getCharsets(isFolder), isFolder);
    if (!isFolder) scheduleCharsetStats();
}

let charsetStatsTimer = null;
function scheduleCharsetStats() {
    if (charsetStatsTimer) clearTimeout(charsetStatsTimer);
    charsetStatsTimer = setTimeout(requestCharsetStats, 300);
}

function requestCharsetStats() {
    if (!selectedId) return;
    const file = files.get(selectedId);
    if (!file || file.type !== 'font') return;
    const inherited = getInheritedSettings(file);
    const ifnt = inherited.font || {};
    const fontSize = file.settings?.fontSize || ifnt.fontSize || 32;
    const bpp = file.settings?.renderMode || ifnt.renderMode || 4;
    vscode.postMessage({
        type: 'getCharsetStats',
        id: selectedId,
        characterSets: getCharsets(false),
        fontSize,
        bpp
    });
}

function renderCharsetStats(charCount, estimatedSizeKB, missingChars) {
    const statsEl = document.getElementById('fileCharsetStats');
    const warnEl = document.getElementById('fileCharsetWarn');
    if (!statsEl || !warnEl) return;

    statsEl.textContent = charCount > 0
        ? '将包含 ' + charCount.toLocaleString() + ' 个字符，预计约 ' + estimatedSizeKB + ' KB'
        : '';

    if (!missingChars || missingChars.length === 0) {
        warnEl.textContent = '';
        return;
    }

    const MAX_SHOW = 5;
    const shown = missingChars.slice(0, MAX_SHOW).map(c => '「' + c + '」').join('');
    const rest = missingChars.length - MAX_SHOW;
    const charList = rest > 0 ? shown + '...等 ' + rest + ' 个' : shown;
    const advice = missingChars.length > MAX_SHOW ? '\\n建议缩小字符集范围或更换字体' : '';
    warnEl.textContent = '⚠️ ' + missingChars.length + ' 个字符在字体中不存在：' + charList + advice;
}

function updateCharsetType(idx, type, isFolder) {
    const charsets = getCharsets(isFolder);
    charsets[idx].type = type;
    charsets[idx].value = '';
    setCharsets(charsets, isFolder);
}

function updateCharsetValue(idx, value, isFolder) {
    const charsets = getCharsets(isFolder);
    charsets[idx].value = value;
    setCharsets(charsets, isFolder);
}

function addFolderCharset() {
    const charsets = getCharsets(true);
    charsets.push({type:'range', value:''});
    setCharsets(charsets, true);
}

function addFileCharset() {
    const charsets = getCharsets(false);
    charsets.push({type:'range', value:''});
    setCharsets(charsets, false);
}

function removeCharset(idx, isFolder) {
    const charsets = getCharsets(isFolder);
    if (charsets.length <= 1) return;
    charsets.splice(idx, 1);
    setCharsets(charsets, isFolder);
}

function browseCharsetFile(idx, type, isFolder) {
    currentCharsetIdx = idx;
    currentCharsetIsFolder = isFolder;
    vscode.postMessage({type:'selectCharsetFile', charsetIdx: idx, charsetType: type});
}

let currentCharsetIdx = 0;
let currentCharsetIsFolder = false;

function startConvert() {
    if (!outputDir || !files.size) return;
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('results').style.display = 'none';
    document.getElementById('convertBtn').disabled = true;
    const baseAddr = document.getElementById('baseAddrInput').value || '0x704D1000';
    vscode.postMessage({type:'startConvert', baseAddr: baseAddr});
}

// 玻璃效果设置更新（带防抖的自动预览）
let glassPreviewTimer = null;
function updateGlassSetting(key, value) {
    updateSetting(key, value);
    // 防抖：延迟请求预览
    if (glassPreviewTimer) clearTimeout(glassPreviewTimer);
    glassPreviewTimer = setTimeout(() => requestGlassPreview(), 500);
}

// 请求玻璃效果预览
function requestGlassPreview() {
    if (!selectedId) return;
    const file = files.get(selectedId);
    if (!file || file.type !== 'glass') return;
    
    // 显示加载状态
    const img = document.getElementById('glassPreviewImage');
    const loading = document.getElementById('glassPreviewLoading');
    const error = document.getElementById('glassPreviewError');
    
    if (img) img.style.display = 'none';
    if (loading) loading.style.display = 'block';
    if (error) error.style.display = 'none';
    
    // 发送预览请求
    vscode.postMessage({
        type: 'previewGlass',
        id: selectedId,
        data: file.data,
        settings: file.settings || {}
    });
}

// 保留旧函数名兼容
function previewGlassEffect() {
    requestGlassPreview();
}

// 更新 UI 启用/禁用状态
function updateUIState() {
    const hasOutputDir = !!outputDir;
    const fileGrid = document.getElementById('fileGrid');
    const selectFilesBtn = document.getElementById('selectFilesBtn');
    const selectFolderBtn = document.getElementById('selectFolderBtn');
    const filterSelect = document.getElementById('filterSelect');
    const clearBtn = document.getElementById('clearBtn');
    const convertBtn = document.getElementById('convertBtn');
    
    // 文件网格区域
    if (fileGrid) {
        if (hasOutputDir) {
            fileGrid.classList.remove('disabled');
        } else {
            fileGrid.classList.add('disabled');
        }
    }
    
    // 按钮状态和提示
    if (selectFilesBtn) {
        selectFilesBtn.disabled = !hasOutputDir;
        selectFilesBtn.title = hasOutputDir ? T.selectFiles : T.pleaseSetOutputDirFirst;
    }
    if (selectFolderBtn) {
        selectFolderBtn.disabled = !hasOutputDir;
        selectFolderBtn.title = hasOutputDir ? T.selectFolder : T.pleaseSetOutputDirFirst;
    }
    if (filterSelect) filterSelect.disabled = !hasOutputDir;
    if (clearBtn) {
        clearBtn.title = hasOutputDir ? T.clear : T.pleaseSetOutputDirFirst;
    }
    if (convertBtn) {
        convertBtn.title = hasOutputDir ? T.startConvert : T.pleaseSetOutputDirFirst;
    }
    
    // 更新空提示文本
    if (files.size === 0) {
        const gridInner = document.getElementById('fileGridInner');
        if (gridInner) {
            gridInner.innerHTML = '<div class="empty-hint">' + (hasOutputDir ? T.dragFilesHere : T.pleaseSelectOutputDirFirst) + '</div>';
        }
    }
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'outputDirSelected') {
        outputDir = msg.dir;
        document.getElementById('outputDirPath').textContent = msg.dir;
        updateUIState();
        updateStats();
    } else if (msg.type === 'conversionConfigLoaded') {
        // 加载 conversion.json 配置
        conversionConfig = msg.config;
        renderProperties();
    } else if (msg.type === 'clearFilesUI') {
        // 后端请求清空 UI（不发送消息回后端）
        blobUrls.forEach(url => URL.revokeObjectURL(url));
        blobUrls.clear();
        files.clear();
        selectedId = null;
        selectedFolder = null;
        currentPath = [];
        conversionConfig = null;
        videoInfoCache.clear();
        Object.keys(folderSettings).forEach(k => delete folderSettings[k]);
        renderBreadcrumb();
        renderGrid();
        updateStats();
        renderProperties();
    } else if (msg.type === 'addFileFromBackend') {
        // 后端发送的文件，添加到前端
        const { id, name, relativePath, data } = msg;
        let type = getFileType(name);
        
        // 特殊处理：后端发送的 bin 文件一定是 GLTF buffer（已经过后端验证）
        const ext = name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
        if (type === 'unknown' && ext === '.bin') {
            type = 'model';
        }
        
        if (type === 'unknown') return;
        
        // 创建 Blob URL 用于预览
        const uint8Array = new Uint8Array(data);
        let blobUrl;
        if (type === 'glass') {
            const svgBlob = new Blob([uint8Array], { type: 'image/svg+xml' });
            blobUrl = URL.createObjectURL(svgBlob);
        } else {
            const blob = new Blob([uint8Array]);
            blobUrl = URL.createObjectURL(blob);
        }
        blobUrls.set(id, blobUrl);
        files.set(id, { id, name, relativePath, type, data, blobUrl });
        renderGrid();
        updateStats();
    } else if (msg.type === 'originLoaded') {
        // origin 文件夹加载完成
        updateFilterCounts();
        renderGrid();
    } else if (msg.type === 'fileDuplicate') {
        // 文件重复，从前端移除
        const url = blobUrls.get(msg.id);
        if (url) URL.revokeObjectURL(url);
        blobUrls.delete(msg.id);
        files.delete(msg.id);
        renderGrid();
        updateStats();
    } else if (msg.type === 'charsetFileSelected') {
        const charsets = getCharsets(currentCharsetIsFolder);
        charsets[msg.charsetIdx].value = msg.filePath;
        setCharsets(charsets, currentCharsetIsFolder);
    } else if (msg.type === 'progress') {
        const pct = msg.total ? (msg.current / msg.total * 100) : 0;
        document.getElementById('progressFill').style.width = pct + '%';
        document.getElementById('progressText').textContent = msg.current + '/' + msg.total + '  ' + msg.fileName;
    } else if (msg.type === 'convertComplete') {
        document.getElementById('progressSection').style.display = 'none';
        document.getElementById('convertBtn').disabled = false;
        const r = document.getElementById('results');
        r.style.display = 'block';
        const ok = msg.results.filter(x=>x.success).length;
        const fail = msg.results.length - ok;
        r.className = 'results ' + (fail ? (ok ? 'mixed' : 'error') : 'success');
        r.textContent = T.complete+': ' + ok + ' '+T.success+', ' + fail + ' '+T.failed;
        if (fail) r.textContent += '\\n' + msg.results.filter(x=>!x.success).map(x=>x.fileName+': '+x.error).join('\\n');
    } else if (msg.type === 'videoInfoResult') {
        if (msg.info) videoInfoCache.set(msg.id, msg.info);
        if (selectedId === msg.id) renderProperties();
    } else if (msg.type === 'charsetStatsResult') {
        renderCharsetStats(msg.charCount, msg.estimatedSizeKB, msg.missingChars);
    } else if (msg.type === 'glassPreviewResult') {
        // 处理玻璃预览结果
        const img = document.getElementById('glassPreviewImage');
        const loading = document.getElementById('glassPreviewLoading');
        const errorEl = document.getElementById('glassPreviewError');
        
        if (loading) loading.style.display = 'none';
        
        if (msg.success && msg.base64) {
            if (img) {
                img.src = msg.base64;
                img.style.display = 'block';
            }
            if (errorEl) errorEl.style.display = 'none';
        } else {
            // 预览失败时显示原始 SVG
            const file = files.get(msg.id);
            if (img && file) {
                img.src = file.blobUrl;
                img.style.display = 'block';
            }
            if (errorEl) {
                errorEl.textContent = T.previewFailed+': ' + (msg.error || '');
                errorEl.style.display = 'block';
            }
        }
    }
});
`;
}
