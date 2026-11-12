import * as fs from 'fs';
import * as path from 'path';
import { Document as HmlDocument, Component, RawHmlChild } from './types';
import { HmlParser } from './HmlParser';
import { SharedStyleLibrary, findSharedStyle, matchesStyleValue, resolveSharedStyle } from '../shared/sharedStyles';

/**
 * HML序列化器类
 * 按照方案一：只支持标准格式 <hml><meta>...</meta><view>...</view></hml>
 */
export class HmlSerializer {
    // 存储所有组件的ID到组件的映射，用于递归序列化时查找子组件
    private componentMap = new Map<string, Component>();
    /** 本次序列化的共享样式库；用于识别「来自样式」的属性，不写回 HML */
    private styleLibrary?: SharedStyleLibrary;
    // 当前 HML 文件路径（用于生成 SVG 文件路径）
    private currentHmlPath: string = '';

    /**
     * 将HML文档对象序列化为文件
     * @param document HML文档对象
     * @param filePath 目标文件路径
     * @returns Promise
     */
    public async serializeToFile(document: HmlDocument, filePath: string, styleLibrary?: SharedStyleLibrary): Promise<void> {
        try {
            // 保存当前 HML 路径，用于生成 SVG 文件路径
            this.currentHmlPath = filePath;

            // 先保存所有 Canvas 的 SVG 文件
            this._saveCanvasSvgFiles(document, filePath);

            const content = this.serialize(document, styleLibrary);

            // 1) 生成临时路径
            const dir = path.dirname(filePath);
            const base = path.basename(filePath);
            const tempPath = path.join(dir, `.${base}.tmp`);

            // 2) 写入临时文件
            fs.writeFileSync(tempPath, content, 'utf8');

            // 3) 完整性校验（解析检查）
            try {
                const parser = new HmlParser();
                const parsed = parser.parse(content);
                if (!parsed || !parsed.view) {
                    throw new Error('序列化结果校验失败：view 结构缺失');
                }
            } catch (verifyErr) {
                // 校验失败，删除临时文件并报错
                try { fs.unlinkSync(tempPath); } catch {}
                throw verifyErr;
            }

            // 不创建 .bak 备份文件，直接进行原子替换

            // 5) 原子替换：重命名临时文件到目标文件（带重试机制）
            await this._renameWithRetry(tempPath, filePath, 5, 100);

            // 6) 再次快速读取并校验（保障落盘内容）
            const written = fs.readFileSync(filePath, 'utf8');
            if (!written || written.length === 0) {
                throw new Error('写入后文件为空');
            }
        } catch (error) {
            throw new Error(`保存HML文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 保存所有 hg_canvas 组件的 SVG 内容到独立文件
     * @param document HML 文档
     * @param hmlFilePath HML 文件路径
     */
    private _saveCanvasSvgFiles(document: HmlDocument, hmlFilePath: string): void {
        if (!document.view.components) return;

        const hmlDir = path.dirname(hmlFilePath);
        const hmlBaseName = path.basename(hmlFilePath, '.hml');

        document.view.components.forEach(component => {
            if (component.type === 'hg_canvas' && component.data?.svgContent) {
                const svgContent = component.data.svgContent as string;
                // 生成 SVG 文件名：hmlBaseName_canvasId.svg
                const svgFileName = `${hmlBaseName}_${component.id}.svg`;
                const svgFilePath = path.join(hmlDir, svgFileName);

                try {
                    fs.writeFileSync(svgFilePath, svgContent, 'utf8');
                    // 更新组件的 svgFile 属性（相对路径）
                    component.data.svgFile = svgFileName;
                    // 清除 svgContent，避免重复存储
                    delete component.data.svgContent;
                } catch (error) {
                    console.error(`[HmlSerializer] 保存 SVG 文件失败: ${svgFilePath}`, error);
                }
            }
        });
    }

    /**
     * 将HML文档对象序列化为字符串
     * 只支持标准格式：<?xml version="1.0" encoding="UTF-8"?>
     *                <hml>
     *                    <meta>...</meta>
     *                    <view>...</view>
     *                </hml>
     *
     * @param document HML文档对象
     * @returns 序列化后的HML字符串
     */
    public serialize(document: HmlDocument, styleLibrary?: SharedStyleLibrary): string {
        try {
            this.styleLibrary = styleLibrary;
            return this._serializeStandardFormat(document);
        } catch (error) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(`序列化HML内容失败: ${String(error)}`);
        }
    }

    /**
     * 使用标准格式序列化（meta + view结构）
     * 这是唯一的序列化格式
     */
    private _serializeStandardFormat(document: HmlDocument): string {
        // 清空并重新填充组件映射表
        this.componentMap.clear();
        if (document.view.components) {
            document.view.components.forEach(comp => {
                this.componentMap.set(comp.id, comp);
            });
        }

        let hmlContent = '<?xml version="1.0" encoding="UTF-8"?>' + '\n';
        hmlContent += '<hml>' + '\n';

        // 序列化meta部分
        hmlContent += this._serializeMeta(document.meta);

        // 序列化view部分
        hmlContent += this._serializeView(document.view);

        // hml 根元素下的注释 / 未知元素
        hmlContent += this._serializeRawChildren(document.rawChildren, 1);

        hmlContent += '</hml>';

        return hmlContent;
    }

    /**
     * 序列化meta对象
     * @param meta meta对象
     * @returns 序列化后的meta XML字符串
     */
    private _serializeMeta(meta: any): string {
        if (!meta || typeof meta !== 'object') {
            return '    <meta />' + '\n';
        }

        let metaContent = '    <meta>' + '\n';

        // 注释原样写回
        const comments: string[] | undefined = meta._comments;
        if (Array.isArray(comments)) {
            comments.forEach(comment => {
                metaContent += '        <!--' + comment + '-->' + '\n';
            });
        }

        // 解析时记录了子元素的原始顺序；按该顺序写回，未知元素用解析出的原文，
        // project / author 用当前对象（设计器可能改过）
        const knownOrder: Array<{ tag: string; xml: string }> | undefined = meta._children;
        const written = new Set<string>();
        if (Array.isArray(knownOrder)) {
            knownOrder.forEach(({ tag, xml }) => {
                written.add(tag);
                const value = meta[tag];
                if (tag === 'project' && !value) {
                    return;
                }
                if (tag === 'author' && !value) {
                    return;
                }
                if (tag === 'project' || tag === 'author') {
                    metaContent += this._serializeElement(tag, value, 2);
                } else if (value === undefined || value === null || value === '') {
                    // 设计器不会删除 meta 字段，这里只是防御
                    metaContent += '        ' + xml + '\n';
                } else {
                    metaContent += '        ' + xml + '\n';
                }
            });
        }

        // 没有原始顺序记录时（例如新建文档）：project、author 优先，其余照旧
        const skipKeys = ['_children', '_comments', 'project', 'author', 'components', 'title', 'width', 'height'];
        if (!written.has('project') && meta.project) {
            metaContent += this._serializeElement('project', meta.project, 2);
        }
        if (!written.has('author') && meta.author) {
            metaContent += this._serializeElement('author', meta.author, 2);
        }
        Object.keys(meta).forEach(key => {
            if (skipKeys.includes(key) || written.has(key)) {
                return;
            }
            const value = meta[key];
            if (value !== undefined && value !== null && value !== '') {
                metaContent += this._serializeElement(key, value, 2);
            }
        });

        metaContent += '    </meta>' + '\n';
        return metaContent;
    }

    /**
     * 序列化view对象
     * @param view view对象，包含components数组
     * @returns 序列化后的view XML字符串
     */
    private _serializeView(view: { components?: Component[]; rawChildren?: RawHmlChild[] }): string {
        let viewContent = '    <view>' + '\n';

        // 序列化组件树（从顶层组件开始）
        if (view && view.components && view.components.length > 0) {
            // 找到顶层组件（没有parent的组件）
            let topLevelComponents = view.components.filter(comp => !comp.parent);
            
            // 按 zIndex 排序（确保序列化顺序和显示层级一致）
            topLevelComponents.sort((a, b) => {
                const zIndexA = typeof a.zIndex === 'number' ? a.zIndex : 0;
                const zIndexB = typeof b.zIndex === 'number' ? b.zIndex : 0;
                return zIndexA - zIndexB;
            });
            
            topLevelComponents.forEach((component, index) => {
                viewContent += this._serializeComponent(component, 2, index);
            });
        }

        viewContent += this._serializeRawChildren(view.rawChildren, 2);

        viewContent += '    </view>' + '\n';
        return viewContent;
    }

    /**
     * 递归序列化组件对象 - 从新格式序列化
     * @param component 组件对象
     * @param indentLevel 缩进级别
     * @param siblingIndex 在同级兄弟中的索引（用于自动设置 zIndex）
     * @returns 序列化后的组件XML字符串
     */
    private _serializeComponent(component: Component, indentLevel: number, siblingIndex: number = 0): string {
        const indent = ' '.repeat(indentLevel * 4);
        let componentContent = '';

        // 构建组件的属性字符串
        let attributesStr = ' id="' + component.id + '"';

        // 共享样式引用（工程根目录 styles.json）；样式属性已在解析时合并，不写回
        if (component.styleName) {
            attributesStr += ' styleName="' + this._escapeXmlValue(component.styleName) + '"';
        }

        // 序列化位置属性（position.x/y/width/height）
        if (component.position) {
            attributesStr += ' x="' + component.position.x + '"';
            attributesStr += ' y="' + component.position.y + '"';
            attributesStr += ' width="' + component.position.width + '"';
            attributesStr += ' height="' + component.position.height + '"';
        }

        // 序列化样式属性（style对象）
        // 来自共享样式且未被组件覆盖的属性不写回：解析时它们是从 styles.json 展开的，
        // 写回会让 HML 里固化一份副本，之后改样式对这些组件不再生效。
        const sharedStyle = resolveSharedStyle(findSharedStyle(this.styleLibrary, component.styleName), component.type);
        if (component.style) {
            Object.keys(component.style).forEach(propName => {
                const value = component.style![propName];
                if (value === undefined || value === null || value === '') {
                    return;
                }
                if (matchesStyleValue(sharedStyle, propName, value)) {
                    return;
                }
                attributesStr += ' ' + propName + '="' + this._escapeXmlValue(this._convertToString(value)) + '"';
            });
        }

        // 序列化数据属性（data对象），排除特殊字段
        // 字体类样式属性在 data 里，同样跳过「来自样式且未覆盖」的值
        if (component.data) {
            Object.keys(component.data).forEach(propName => {
                // 跳过特殊字段，它们会作为子元素单独处理
                if (propName === 'interactions' || propName === 'view_switch' || propName === 'events') {
                    return;
                }
                // 跳过元属性（已在后面单独序列化，避免重复输出）
                if (['showOverflow', 'visible', 'enabled', 'locked', 'zIndex'].includes(propName)) {
                    return;
                }
                
                // 特殊处理：将 timerActions 数组序列化为 JSON 字符串（旧版兼容）
                if (propName === 'timerActions') {
                    const value = component.data![propName];
                    if (value && Array.isArray(value) && value.length > 0) {
                        attributesStr += ' ' + propName + '="' + this._escapeXmlValue(JSON.stringify(value)) + '"';
                    }
                    return;
                }
                
                // 特殊处理：将 timers 数组序列化为 JSON 字符串（新版）
                if (propName === 'timers') {
                    const value = component.data![propName];
                    if (value && Array.isArray(value) && value.length > 0) {
                        attributesStr += ' ' + propName + '="' + this._escapeXmlValue(JSON.stringify(value)) + '"';
                    }
                    return;
                }
                
                // 保留 list_item 的 index 属性（用于确保顺序正确）
                const value = component.data![propName];
                if (matchesStyleValue(sharedStyle, propName, value)) {
                    return;
                }
                if (value !== undefined && value !== null && value !== '') {
                    attributesStr += ' ' + propName + '="' + this._escapeXmlValue(this._convertToString(value)) + '"';
                }
            });
        }

        // 序列化元属性（visible, enabled, locked, zIndex, showOverflow）
        // 注意：name 不再单独输出，统一使用 id 作为标识
        if (component.visible === false) {
            attributesStr += ' visible="false"';
        }
        if (component.enabled === false) {
            attributesStr += ' enabled="false"';
        }
        if (component.locked === true) {
            attributesStr += ' locked="true"';
        }
        // 使用组件自身的 zIndex（如果没有则使用 siblingIndex）
        const zIndex = typeof component.zIndex === 'number' ? component.zIndex : siblingIndex;
        attributesStr += ' zIndex="' + zIndex + '"';
        if (component.showOverflow === true) {
            attributesStr += ' showOverflow="true"';
        }

        // 旧式 on* 事件处理器（onClick="func" 这类属性）：设计器不编辑但手写和
        // AI 生成的内容会用到，原样写回，不参与代码生成
        if (component.events) {
            Object.keys(component.events).forEach(eventName => {
                const handler = component.events![eventName];
                if (handler !== undefined && handler !== null && handler !== '') {
                    attributesStr += ' ' + eventName + '="' + this._escapeXmlValue(this._convertToString(handler)) + '"';
                }
            });
        }

        // 检查是否有子组件、事件配置或需要原样写回的内容
        const hasChildren = component.children && component.children.length > 0;
        const hasEventConfigs = component.eventConfigs && component.eventConfigs.length > 0;
        const hasRawChildren = component.rawChildren && component.rawChildren.length > 0;

        if (hasChildren || hasEventConfigs || hasRawChildren) {
            componentContent += indent + '<' + component.type + attributesStr + '>' + '\n';

            // 序列化事件配置 (Event-Action)
            if (hasEventConfigs) {
                componentContent += indent + '    <events>' + '\n';
                component.eventConfigs!.forEach(eventConfig => {
                    const eventIndent = indent + '        ';
                    let eventAttrs = 'type="' + eventConfig.type + '"';
                    if (eventConfig.type === 'onMessage' && eventConfig.message) {
                        eventAttrs += ' message="' + this._escapeXmlValue(eventConfig.message) + '"';
                    }
                    if (eventConfig.handler) {
                        eventAttrs += ' handler="' + this._escapeXmlValue(eventConfig.handler) + '"';
                    }
                    // 保存抬起区域检测标志
                    if (eventConfig.type === 'onTouchUp' && eventConfig.checkReleaseArea === true) {
                        eventAttrs += ' checkReleaseArea="true"';
                    }
                    // 保存按键名（按键事件专用）
                    if ((eventConfig.type === 'onKeyShortPress' || eventConfig.type === 'onKeyLongPress') && eventConfig.keyName) {
                        eventAttrs += ' keyName="' + this._escapeXmlValue(eventConfig.keyName) + '"';
                    }

                    if (eventConfig.actions && eventConfig.actions.length > 0) {
                        componentContent += eventIndent + '<event ' + eventAttrs + '>\n';
                        eventConfig.actions.forEach(action => {
                            const actionIndent = eventIndent + '    ';
                            let actionAttrs = 'type="' + action.type + '"';
                            if (action.target) actionAttrs += ' target="' + this._escapeXmlValue(action.target) + '"';
                            if (action.message) actionAttrs += ' message="' + this._escapeXmlValue(action.message) + '"';
                            if (action.functionName) actionAttrs += ' functionName="' + this._escapeXmlValue(action.functionName) + '"';
                            if (action.type === 'switchView') {
                                actionAttrs += ' switchOutStyle="' + (action.switchOutStyle || 'SWITCH_OUT_TO_LEFT_USE_TRANSLATION') + '"';
                                actionAttrs += ' switchInStyle="' + (action.switchInStyle || 'SWITCH_IN_FROM_RIGHT_USE_TRANSLATION') + '"';
                            }
                            // 序列化 controlTimer 的 timerTargets
                            if (action.type === 'controlTimer' && action.timerTargets && action.timerTargets.length > 0) {
                                actionAttrs += ' timerTargets="' + this._escapeXmlValue(JSON.stringify(action.timerTargets)) + '"';
                            }
                            componentContent += actionIndent + '<action ' + actionAttrs + ' />\n';
                        });
                        componentContent += eventIndent + '</event>\n';
                    } else {
                        componentContent += eventIndent + '<event ' + eventAttrs + ' />\n';
                    }
                });
                componentContent += indent + '    </events>' + '\n';
            }

            // 递归序列化子组件
            if (hasChildren) {
                // 对于 hg_list 组件，按 y/x 坐标排序子组件（hg_list_item）
                let childrenToSerialize = component.children!;
                if (component.type === 'hg_list') {
                    // 只对 hg_list_item 类型的子组件进行排序
                    const listItemComponents = component.children!
                        .map(childId => this.componentMap.get(childId))
                        .filter(child => child !== undefined && child.type === 'hg_list_item') as Component[];
                    
                    const otherChildren = component.children!
                        .filter(childId => {
                            const child = this.componentMap.get(childId);
                            return child && child.type !== 'hg_list_item';
                        });
                    
                    // 按 y 坐标排序（对于垂直列表）或 x 坐标排序（对于水平列表）
                    const direction = component.style?.direction || component.data?.direction || 'VERTICAL';
                    listItemComponents.sort((a, b) => {
                        if (direction === 'VERTICAL') {
                            return a.position.y - b.position.y;
                        } else {
                            return a.position.x - b.position.x;
                        }
                    });
                    
                    // 重新分配 index（按排序后的顺序）
                    listItemComponents.forEach((child, idx) => {
                        if (child.data) {
                            child.data.index = idx;
                        }
                    });
                    
                    // 先序列化 list_item，再序列化其他子组件
                    childrenToSerialize = [...listItemComponents.map(c => c.id), ...otherChildren];
                }
                
                childrenToSerialize.forEach((childId, index) => {
                    const child = this.componentMap.get(childId);
                    if (child) {
                        componentContent += this._serializeComponent(child, indentLevel + 1, index);
                    }
                });
            }

            // 注释 / 未知子标签原样写回
            componentContent += this._serializeRawChildren(component.rawChildren, indentLevel + 1);

            componentContent += indent + '</' + component.type + '>' + '\n';
        } else {
            componentContent += indent + '<' + component.type + attributesStr + ' />' + '\n';
        }

        return componentContent;
    }

    /**
     * 写回解析时保留下来的原始片段（注释 / 设计器不认识的标签）。
     * 按所在层级缩进，内容本身是解析器重建的原文，不再二次转义。
     */
    private _serializeRawChildren(children: RawHmlChild[] | undefined, indentLevel: number): string {
        if (!children || children.length === 0) {
            return '';
        }
        const indent = ' '.repeat(indentLevel * 4);
        return children.map(child => indent + child.xml + '\n').join('');
    }

    /**
     * 序列化单个元素
     * @param tagName 标签名
     * @param attributes 属性对象
     * @param indentLevel 缩进级别
     * @returns 序列化后的元素XML字符串
     */
    private _serializeElement(tagName: string, attributes: any, indentLevel: number): string {
        const indent = ' '.repeat(indentLevel * 4);

        if (!attributes || typeof attributes !== 'object') {
            // 简单值（字符串、数字等）
            const value = this._convertToString(attributes);
            if (value) {
                return indent + '<' + tagName + '>' + this._escapeXmlValue(value) + '</' + tagName + '>' + '\n';
            }
            return indent + '<' + tagName + ' />' + '\n';
        }

        // 对象类型，构建属性字符串
        let attributesStr = '';
        Object.keys(attributes).forEach(attrName => {
            const attrValue = attributes[attrName];
            if (attrValue !== undefined && attrValue !== null && attrValue !== '') {
                attributesStr += ' ' + attrName + '="' + this._escapeXmlValue(this._convertToString(attrValue)) + '"';
            }
        });

        return indent + '<' + tagName + attributesStr + ' />' + '\n';
    }

    /**
     * 将JavaScript值转换为字符串
     * @param value JavaScript值
     * @returns 转换后的字符串
     */
    private _convertToString(value: any): string {
        if (value === undefined || value === null) {
            return '';
        }

        if (typeof value === 'object') {
            // 对于对象和数组，使用JSON字符串表示
            return JSON.stringify(value);
        }

        return String(value);
    }

    /**
     * 转义XML特殊字符
     * @param value 需要转义的字符串
     * @returns 转义后的字符串
     */
    private _escapeXmlValue(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * 带重试机制的文件重命名
     * 解决 Windows 上文件被占用导致的 EPERM 错误
     * @param sourcePath 源文件路径
     * @param targetPath 目标文件路径
     * @param maxRetries 最大重试次数
     * @param delayMs 每次重试的延迟（毫秒）
     */
    private async _renameWithRetry(sourcePath: string, targetPath: string, maxRetries: number, delayMs: number): Promise<void> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // 尝试重命名
                fs.renameSync(sourcePath, targetPath);
                
                // 成功，记录日志并返回
                if (attempt > 1) {
                    console.log(`[HmlSerializer] 文件重命名成功（第 ${attempt} 次尝试）`);
                }
                return;
                
            } catch (error) {
                lastError = error as Error;
                
                // 如果不是 EPERM 或 EBUSY 错误，直接抛出
                if (error && typeof error === 'object' && 'code' in error) {
                    const code = (error as any).code;
                    if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
                        throw error;
                    }
                }
                
                // 如果是最后一次尝试，抛出错误
                if (attempt === maxRetries) {
                    console.error(`[HmlSerializer] 文件重命名失败，已重试 ${maxRetries} 次`);
                    break;
                }
                
                // 等待后重试
                console.warn(`[HmlSerializer] 文件重命名失败（第 ${attempt} 次尝试），${delayMs}ms 后重试...`);
                await this._sleep(delayMs);
                
                // 指数退避：每次重试延迟翻倍
                delayMs *= 2;
            }
        }
        
        // 所有重试都失败，尝试备用方案：先删除目标文件再重命名
        try {
            console.warn('[HmlSerializer] 尝试备用方案：先删除目标文件');
            if (fs.existsSync(targetPath)) {
                fs.unlinkSync(targetPath);
                await this._sleep(50); // 短暂等待文件系统释放
            }
            fs.renameSync(sourcePath, targetPath);
            console.log('[HmlSerializer] 备用方案成功');
            return;
        } catch (backupError) {
            console.error('[HmlSerializer] 备用方案也失败');
        }
        
        // 最终方案：直接复制+删除（不是原子操作，但至少能保存）
        try {
            console.warn('[HmlSerializer] 尝试最终方案：复制+删除');
            const content = fs.readFileSync(sourcePath, 'utf8');
            fs.writeFileSync(targetPath, content, 'utf8');
            fs.unlinkSync(sourcePath);
            console.log('[HmlSerializer] 最终方案成功');
            return;
        } catch (finalError) {
            console.error('[HmlSerializer] 所有保存方案都失败');
        }
        
        // 抛出原始错误
        throw new Error(`文件保存失败（已尝试多种方案）: ${lastError?.message || '未知错误'}\n\n可能原因：\n1. 文件被杀毒软件或备份软件占用\n2. 文件权限不足\n3. 磁盘空间不足\n\n建议：\n1. 暂时关闭杀毒软件的实时保护\n2. 检查文件权限\n3. 重启 VSCode`);
    }

    /**
     * 异步睡眠（非阻塞）
     * @param ms 睡眠时间（毫秒）
     */
    private _sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
