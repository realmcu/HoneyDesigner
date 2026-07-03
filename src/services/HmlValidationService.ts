import { HmlParser } from '../hml/HmlParser';
import { scanOpenTags } from '../hml/tagScan';
import { validateComponentId } from '../webview/utils/validation';
import { Component } from '../hml/types';
import { findUnusedKeys } from '../project-i18n/catalog';
import type { I18nCatalog } from '../project-i18n/types';

/**
 * HML 验证服务
 *
 * 功能：验证 HML XML 内容是否符合 HML-Spec.md 规范
 * 用途：提供给 HTTP API (/api/validate-hml) 和内部模块使用
 *
 * 执行的验证规则（共 8 项）：
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 1. 内容非空检查         - 确保 HML 内容不为空                           │
 * │ 2. XML 语法验证         - 使用 fast-xml-parser 验证 XML 格式            │
 * │ 3. 文档结构验证         - 必须有 <meta> 和 <view> 元素                  │
 * │ 4. 组件 ID 验证         - 全局唯一性 + C 标识符格式                     │
 * │ 5. 组件嵌套规则验证     - 容器/非容器组件嵌套约束                       │
 * │ 6. hg_view 不嵌套验证   - hg_view 不能嵌套在另一个 hg_view 中          │
 * │ 7. 资源路径格式验证     - 图像 assets/ 开头、字体 fontFile / 开头      │
 * │ 8. Entry View 唯一性验证 - 必须有且只有一个 entry="true" 的 hg_view    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * 验证依据：/docs/HML-Spec.md
 *
 * 返回结果：
 * - valid: boolean           - 是否通过验证
 * - errors: ValidationError[] - 错误列表（如果有）
 * - warnings: ValidationWarning[] - 警告列表（如果有）
 * - validationRules: string[] - 执行的验证规则列表
 */
export class HmlValidationService {
    private parser: HmlParser;

    // 容器组件类型（可以包含子组件）
    private readonly containerTypes = new Set([
        'hg_view', 'hg_window', 'hg_list', 'hg_list_item', 'hg_menu_cellular'
    ]);

    constructor() {
        this.parser = new HmlParser();
    }

    /**
     * 验证 HML XML 内容
     * @param hmlContent HML XML 字符串
     * @returns 验证结果
     *
     * 执行的验证规则（按 HML-Spec.md 规范）：
     * 1. 基础检查：内容非空
     * 2. XML 语法验证：使用 HmlParser 解析，检查 XML 格式是否正确
     * 3. 文档结构验证：必须有 <meta> 和 <view> 元素
     * 4. 组件 ID 验证：全局唯一性 + 格式符合 C 标识符规范
     * 5. 组件嵌套规则验证：只有容器组件可以包含子组件
     * 6. hg_view 不嵌套验证：hg_view 不能嵌套在另一个 hg_view 中
     * 7. 资源路径格式验证：图像 src/imageOn/imageOff 以 'assets/' 开头、字体 fontFile 以 '/' 开头
     * 8. Entry View 唯一性验证：必须有且只有一个 hg_view 的 entry="true"
     */
    public validateHml(hmlContent: string, context: HmlValidationContext = {}): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];
        const validationRules: string[] = [];

        try {
            // ========================================
            // 规则 1: 基础检查 - 内容非空
            // ========================================
            validationRules.push('内容非空检查');
            if (!hmlContent || hmlContent.trim() === '') {
                return {
                    valid: false,
                    errors: [{
                        type: 'syntax',
                        message: 'HML content is empty'
                    }],
                    warnings: [],
                    validationRules
                };
            }

            // ========================================
            // 规则 2: XML 语法验证
            // 使用 HmlParser（基于 fast-xml-parser）解析
            // 会自动检查：标签闭合、属性格式、XML 声明等
            // ========================================
            validationRules.push('XML 语法验证');
            // 传入文件路径（若调用方提供）：无 id 组件的 fallback id 以 basename 为种子，
            // 保证校验解析出的组件 id 与设计器/scanAllViews/codegen 对同一文件一致
            const document = this.parser.parse(hmlContent, context.filePath);

            // ========================================
            // 规则 3: 文档结构验证
            // HML-Spec 要求：必须有 <meta> 和 <view>
            // ========================================
            validationRules.push('文档结构验证（<meta> 和 <view> 必须存在）');
            this.validateDocumentStructure(document, errors);

            // ========================================
            // 规则 4: 组件 ID 验证
            // - 全局唯一性：同一个 HML 文件中不能有重复 ID
            // - 格式验证：符合 C 标识符规范（lowercase_with_underscores）
            // - 不能使用 C 语言关键字（如 int, void 等）
            // ========================================
            validationRules.push('组件 ID 唯一性和格式验证（C 标识符规范）');
            const componentIds = new Set<string>();
            this.validateComponentIds(document.view.components || [], componentIds, errors);

            // ========================================
            // 规则 5: 组件嵌套规则验证（HML-Spec Section 5）
            // - 容器组件：hg_view, hg_window, hg_list, hg_list_item, hg_menu_cellular
            // - 只有容器组件可以包含子组件
            // - 非容器组件（如 hg_button, hg_label）不能有子组件
            // - 特殊规则：hg_list 的子组件应该是 hg_list_item
            // ========================================
            validationRules.push('组件嵌套规则验证（容器/非容器规则）');
            this.validateNestingRules(document.view.components || [], errors);

            // ========================================
            // 规则 6: hg_view 不嵌套验证（HML-Spec 特别说明）
            // - hg_view 不能嵌套在另一个 hg_view 中
            // - 这是 HML 的特殊设计约束
            // ========================================
            validationRules.push('hg_view 不嵌套规则验证');
            this.validateNoNestedViews(document.view.components || [], errors);

            // ========================================
            // 规则 7: 资源路径格式验证（按资源类型）
            // - 图像类 src/imageOn/imageOff：必须以 'assets/' 开头
            // - 字体 fontFile：必须以 '/' 开头
            // - 正确：src="assets/icon.png"、fontFile="/NotoSansSC-Medium.ttf"
            // - 错误：src="/icon.bin"、fontFile="NotoSansSC-Medium.ttf"
            // ========================================
            validationRules.push('资源路径格式验证（图像 assets/ 开头、字体 / 开头）');
            this.validateResourcePaths(document.view.components || [], errors, warnings);

            // ========================================
            // 规则 8: Entry View 唯一性验证（HML-Spec Section 6.1）
            // - 必须有且只有一个 hg_view 的 entry="true"
            // - 这是 HML 应用的入口点
            // ========================================
            validationRules.push('Entry View 唯一性验证（必须有且只有一个 entry="true"）');
            this.validateEntryView(document.view.components || [], errors);

            // ========================================
            // 规则 9: hg_view id 必填警告（HML-Spec Section 6.1）
            // - id 在 hg_view 上是 required（不同于其他组件的 auto-generated）
            // - switchView 的 target 依赖 view id 做导航引用，缺失 id 会导致无法被稳定引用
            // - 必须检测原始 XML：HmlParser 解析时已回填确定性 fallback id，
            //   解析后的组件上 !component.id 永远为假
            // ========================================
            validationRules.push('hg_view id 必填警告验证');
            this.validateViewIds(hmlContent, warnings);

            if (context.i18nCatalog) {
                validationRules.push('多语言文本预览警告验证');
                this.validateI18n(document.view.components || [], context, warnings);
            }

            // ========================================
            // 返回验证结果
            // ========================================
            if (errors.length > 0) {
                return {
                    valid: false,
                    errors,
                    warnings,
                    validationRules
                };
            }

            return {
                valid: true,
                errors: [],
                warnings,
                validationRules
            };

        } catch (error: any) {
            // 解析失败（XML 语法错误或结构错误）
            return {
                valid: false,
                errors: [{
                    type: 'syntax',
                    message: error.message || 'HML parsing failed'
                }],
                warnings: [],
                validationRules: validationRules.length > 0 ? validationRules : ['XML 语法验证（失败）']
            };
        }
    }

    /**
     * 验证文档结构（必须有 meta 和 view）
     *
     * 验证内容：
     * - 检查是否存在 <meta> 元素
     * - 检查是否存在 <view> 元素
     *
     * 依据：HML-Spec.md 规定 HML 文档必须包含这两个顶层元素
     */
    private validateDocumentStructure(document: any, errors: ValidationError[]): void {
        if (!document.meta) {
            errors.push({
                type: 'structure',
                message: 'Missing <meta> section'
            });
        }
        if (!document.view) {
            errors.push({
                type: 'structure',
                message: 'Missing <view> section'
            });
        }
    }

    /**
     * 验证组件 ID（唯一性和格式）
     *
     * 验证内容：
     * 1. ID 唯一性：同一个 HML 文件中不能有重复的组件 ID
     * 2. ID 格式验证：
     *    - 必须符合 C 语言标识符规范
     *    - 推荐使用 lowercase_with_underscores 命名约定
     *    - 不能使用 C 语言关键字（如 int, void, return 等）
     *    - 不能以数字开头
     *    - 只能包含字母、数字、下划线
     *
     * 依据：HML-Spec.md，因为 HML 生成的 C 代码中组件 ID 会作为变量名
     */
    private validateComponentIds(
        components: Component[],
        existingIds: Set<string>,
        errors: ValidationError[]
    ): void {
        // HmlParser 返回的是扁平化的组件数组，不需要递归
        for (const component of components) {
            // 检查 ID 是否已存在（唯一性）
            if (existingIds.has(component.id)) {
                errors.push({
                    type: 'reference',
                    message: `Duplicate component ID: ${component.id}`,
                    componentId: component.id
                });
            }

            existingIds.add(component.id);

            // 验证 ID 格式（使用现有的验证函数）
            const idValidation = validateComponentId(
                component.id,
                Array.from(existingIds),
                component.id
            );

            if (!idValidation.valid && idValidation.error) {
                errors.push({
                    type: 'attribute',
                    message: idValidation.error,
                    componentId: component.id,
                    attribute: 'id'
                });
            }
        }
    }

    /**
     * 验证组件嵌套规则（HML-Spec Section 5）
     *
     * 验证内容：
     * 1. 容器组件识别：
     *    - 容器：hg_view, hg_window, hg_list, hg_list_item, hg_menu_cellular
     *    - 非容器：hg_button, hg_label, hg_image 等其他组件
     *
     * 2. 嵌套规则：
     *    - 只有容器组件可以包含子组件
     *    - 非容器组件不能有子组件
     *    - 例如：hg_button 不能包含 hg_image
     *
     * 3. 特殊规则：
     *    - hg_list 的直接子组件应该是 hg_list_item
     *    - 这是为了保证列表结构的正确性
     *
     * 依据：HML-Spec.md Section 5（Component Hierarchy）
     */
    private validateNestingRules(components: Component[], errors: ValidationError[]): void {
        for (const component of components) {
            const isContainer = this.containerTypes.has(component.type);

            // 如果是非容器组件，但有子组件，报错
            if (!isContainer && component.children && component.children.length > 0) {
                errors.push({
                    type: 'structure',
                    message: `Non-container component '${component.type}' cannot have children`,
                    componentId: component.id
                });
            }

            // 特殊规则：hg_list 的子组件应该是 hg_list_item
            if (component.type === 'hg_list') {
                const childComponents = components.filter(c => component.children?.includes(c.id));
                for (const child of childComponents) {
                    if (child.type !== 'hg_list_item') {
                        errors.push({
                            type: 'structure',
                            message: `hg_list should only contain hg_list_item, found: ${child.type}`,
                            componentId: component.id
                        });
                    }
                }
            }
        }
    }

    /**
     * 验证 hg_view 不嵌套规则（HML-Spec 特别说明）
     *
     * 验证内容：
     * - hg_view 不能嵌套在另一个 hg_view 中
     * - 这是 HML 的设计约束，用于简化页面层级结构
     *
     * 正确示例：
     * <view>
     *   <hg_view id="page1" entry="true">
     *     <hg_button id="btn1" />
     *   </hg_view>
     * </view>
     *
     * 错误示例：
     * <view>
     *   <hg_view id="page1" entry="true">
     *     <hg_view id="page2">  <!-- 错误：嵌套 hg_view -->
     *       <hg_button id="btn1" />
     *     </hg_view>
     *   </hg_view>
     * </view>
     *
     * 依据：HML-Spec.md 开头特别说明
     */
    private validateNoNestedViews(components: Component[], errors: ValidationError[]): void {
        const viewComponents = components.filter(c => c.type === 'hg_view');

        for (const view of viewComponents) {
            if (view.parent) {
                const parentComp = components.find(c => c.id === view.parent);
                if (parentComp && parentComp.type === 'hg_view') {
                    errors.push({
                        type: 'structure',
                        message: 'hg_view cannot be nested inside another hg_view',
                        componentId: view.id
                    });
                }
            }
        }
    }

    /**
     * 验证资源路径格式（按资源类型分别校验）
     *
     * 两类资源在 HML 中的路径约定不同——这与设计器产物、画布预览、codegen
     * 的实际行为一致（详见各自预览代码），不是随意约定：
     *
     * 1) 图像类（src / imageOn / imageOff）：必须以 'assets/' 开头
     *    - 画布预览 path.join(projectRoot, src) 不补任何前缀，故 src 必须自带 assets/，
     *      否则预览找不到文件（见 ImageWidget / useWebviewUri / AssetManager）。
     *    - codegen 会先 strip 'assets/'、再做 png→bin 转换（见 ImageGenerator）。
     *    - 设计器拖拽创建图像时生成的就是 'assets/xxx.png'（见 App.tsx / messageHandler）。
     *    - 正确：src="assets/icon.png"   错误：src="/icon.bin"、src="icon.png"
     *
     * 2) 字体（fontFile）：必须以 '/' 开头
     *    - 预览侧 useFontLoader 会主动补 'assets' 前缀（"assets" + fontFile），
     *      故 fontFile 必须以 / 开头才能拼出 assets/xxx.ttf。
     *    - 正确：fontFile="/NotoSansSC-Medium.ttf"   错误：fontFile="NotoSansSC-Medium.ttf"
     *
     * 注：HmlParser 返回扁平化组件数组，这里遍历即覆盖所有嵌套组件。
     */
    private validateResourcePaths(
        components: Component[],
        errors: ValidationError[],
        warnings: ValidationWarning[]
    ): void {
        // 图像类资源：路径必须以 'assets/' 开头
        const imageAttrs = ['src', 'imageOn', 'imageOff'];
        // 字体资源：路径必须以 '/' 开头（预览侧会补 'assets' 前缀）
        const fontAttrs = ['fontFile'];

        for (const component of components) {
            for (const attr of imageAttrs) {
                const value = (component.data as any)?.[attr];
                if (value && typeof value === 'string' && value.trim() !== '') {
                    if (!value.startsWith('assets/')) {
                        errors.push({
                            type: 'attribute',
                            message: `Image resource path must start with 'assets/', got: '${value}'`,
                            componentId: component.id,
                            attribute: attr
                        });
                    }
                }
            }

            for (const attr of fontAttrs) {
                const value = (component.data as any)?.[attr];
                if (value && typeof value === 'string' && value.trim() !== '') {
                    if (!value.startsWith('/')) {
                        errors.push({
                            type: 'attribute',
                            message: `Font path must start with '/', got: '${value}'`,
                            componentId: component.id,
                            attribute: attr
                        });
                    }
                }
            }
        }
    }

    /**
     * 验证 hg_view 的 id 是否已填写（best-practice 警告）
     *
     * 验证内容：
     * - hg_view 的 id 是 required（HML-Spec Section 6.1），不同于其他组件的 auto-generated
     * - switchView 的 target 引用 view id 做导航跳转，缺失 id 的 view 无法被稳定引用
     *
     * 实现说明：必须对**原始 XML 内容**做检测。HmlParser 会为无 id 的组件回填
     * 确定性 fallback id，解析后的组件树上 id 恒为非空，基于组件树的检测是死代码。
     *
     * 依据：HML-Spec.md Section 6.1（hg_view — View Container）
     */
    private validateViewIds(hmlContent: string, warnings: ValidationWarning[]): void {
        // 先剔除 XML 注释（含未闭合的尾部注释），避免注释掉的 <hg_view> 触发误报
        const contentWithoutComments = hmlContent
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<!--[\s\S]*$/, '');
        // 逐个提取 <hg_view ...> 开标签（含自闭合），检查其属性里是否声明了 id。
        // 不能用 /<hg_view\b[^>]*>/ 一把梭：属性值里出现 '>'（如 name="a > b"）是
        // 合法 XML，正则会在首个 '>' 处截断标签导致误报缺 id——必须尊重引号扫描
        // （scanOpenTags，与 NavEditService round-trip 预检共用）
        for (const openTag of scanOpenTags(contentWithoutComments, 'hg_view')) {
            // 属性形如 ` id="..."` / ` id='...'`（\s 前缀避免误中 grid= / uid= 等属性名后缀）
            const idAttr = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(openTag.attrsText);
            const idValue = idAttr ? (idAttr[1] ?? idAttr[2] ?? '') : '';
            if (!idAttr || idValue.trim() === '') {
                warnings.push({
                    type: 'best-practice',
                    message: 'hg_view is missing an id — switchView targets and navigation edges reference views by id, so this view cannot be reliably targeted for navigation'
                });
            }
        }
    }

    /**
     * 验证 entry view 唯一性（只能有一个 entry="true"）
     *
     * 验证内容：
     * - 必须有且只有一个 hg_view 的 entry="true"
     * - entry view 是应用的入口点，定义了应用启动时显示的页面
     *
     * 正确示例：
     * <view>
     *   <hg_view id="page_main" entry="true">  <!-- 入口页面 -->
     *     <hg_button id="btn1" />
     *   </hg_view>
     *   <hg_view id="page_settings">            <!-- 其他页面 -->
     *     <hg_button id="btn2" />
     *   </hg_view>
     * </view>
     *
     * 错误示例 1（缺少 entry）：
     * <view>
     *   <hg_view id="page_main">               <!-- 错误：没有 entry="true" -->
     *     <hg_button id="btn1" />
     *   </hg_view>
     * </view>
     *
     * 错误示例 2（多个 entry）：
     * <view>
     *   <hg_view id="page1" entry="true">      <!-- 错误：多个 entry -->
     *   </hg_view>
     *   <hg_view id="page2" entry="true">      <!-- 错误：多个 entry -->
     *   </hg_view>
     * </view>
     *
     * 依据：HML-Spec.md Section 6.1（Entry View）
     */
    private validateEntryView(components: Component[], errors: ValidationError[]): void {
        const entryViews = components.filter(c => {
            if (c.type !== 'hg_view') {
                return false;
            }
            const entry = (c.data as any)?.entry;
            // XML 属性可能是字符串 "true" 或 boolean true
            return entry === true || entry === 'true';
        });

        if (entryViews.length === 0) {
            errors.push({
                type: 'structure',
                message: 'Exactly one hg_view must have entry="true"'
            });
        } else if (entryViews.length > 1) {
            errors.push({
                type: 'structure',
                message: `Multiple entry views found (${entryViews.length}), only one allowed: ${entryViews.map(v => v.id).join(', ')}`
            });
        }
    }

    private validateI18n(
        components: Component[],
        context: HmlValidationContext,
        warnings: ValidationWarning[]
    ): void {
        const catalog = context.i18nCatalog;
        if (!catalog) {
            return;
        }

        const previewLocale = context.previewLocale || catalog.defaultLocale;
        const referencedKeys = new Set<string>();

        for (const component of components) {
            const key = String((component.data as any)?.i18nKey || '').trim();
            if (!key) {
                continue;
            }

            referencedKeys.add(key);

            if (component.type !== 'hg_label') {
                continue;
            }

            const entry = catalog.strings[key];
            if (!entry) {
                warnings.push({
                    type: 'i18n',
                    message: `i18n key '${key}' is not found in i18n/strings.json`,
                    componentId: component.id,
                    attribute: 'i18nKey',
                    key,
                });
            } else {
                if (!entry[catalog.defaultLocale]) {
                    warnings.push({
                        type: 'i18n',
                        message: `i18n key '${key}' is missing default locale text (${catalog.defaultLocale})`,
                        componentId: component.id,
                        attribute: 'i18nKey',
                        locale: catalog.defaultLocale,
                        key,
                    });
                }

                if (previewLocale !== catalog.defaultLocale && !entry[previewLocale]) {
                    warnings.push({
                        type: 'i18n',
                        message: `i18n key '${key}' is missing preview locale text (${previewLocale})`,
                        componentId: component.id,
                        attribute: 'i18nKey',
                        locale: previewLocale,
                        key,
                    });
                }
            }

            if (!String((component.data as any)?.text || '').trim()) {
                warnings.push({
                    type: 'i18n',
                    message: `i18n key '${key}' is set but fallback text is empty`,
                    componentId: component.id,
                    attribute: 'text',
                    key,
                });
            }
        }

        for (const unusedKey of findUnusedKeys(catalog, referencedKeys)) {
            warnings.push({
                type: 'i18n',
                message: `i18n key '${unusedKey}' is not referenced by this HML file`,
                key: unusedKey,
            });
        }
    }
}

export interface HmlValidationContext {
    projectRoot?: string;
    previewLocale?: string;
    i18nCatalog?: I18nCatalog;
    /** 被校验 HML 的文件路径（可选）；用于派生 fallback id 种子，保持与设计器/扫描一致 */
    filePath?: string;
}

/**
 * 验证结果接口
 */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    validationRules: string[];  // 执行的验证规则列表
}

/**
 * 验证错误接口
 */
export interface ValidationError {
    type: 'syntax' | 'structure' | 'attribute' | 'reference';
    message: string;
    componentId?: string;   // 组件 ID
    attribute?: string;     // 属性名
    line?: number;          // 行号（如果可用）
    column?: number;        // 列号（如果可用）
}

/**
 * 验证警告接口
 */
export interface ValidationWarning {
    type: 'best-practice' | 'performance' | 'compatibility' | 'i18n';
    message: string;
    componentId?: string;
    attribute?: string;
    locale?: string;
    key?: string;
}
