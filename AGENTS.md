# AGENTS.md - AI 助手指南

本文件为 AI 编程助手提供项目上下文和协作指南。

## 项目概述

**HoneyGUI Design** 是一个 VSCode 扩展，为嵌入式 GUI 应用程序开发提供可视化设计环境。

- **类型**：VSCode Extension + React Webview
- **语言**：TypeScript, React, CSS
- **目标**：拖拽式 GUI 设计 → HML 文件 → C 代码生成 → 编译仿真

## 核心架构

### 1. 扩展端 (Extension Host)
```
src/
├── extension.ts              # 入口
├── core/                     # 核心管理
├── hml/                      # HML 解析/序列化
├── codegen/                  # C 代码生成（双引擎）
│   ├── CodeGeneratorFactory.ts  # 工厂: 'honeygui' | 'lvgl'
│   ├── honeygui/             # HoneyGUI 引擎代码生成
│   └── lvgl/                 # LVGL 引擎代码生成
├── simulation/               # 编译仿真
└── designer/                 # Webview 管理
```

### 2. Webview 端 (React)
```
src/webview/
├── App.tsx                   # 主应用
├── store.ts                  # Zustand 状态管理
├── components/               # UI 组件
│   ├── DesignerCanvas.tsx    # 画布
│   ├── ComponentLibrary.tsx  # 组件库（Tab 1）
│   ├── AssetsPanel.tsx       # 资源（Tab 2）
│   ├── ComponentTree.tsx     # 组件树（Tab 3）
│   └── PropertiesPanel.tsx   # 属性面板
└── utils/                    # 工具函数
```

### 3. 通信机制
- **Extension → Webview**: `panel.webview.postMessage()`
- **Webview → Extension**: `vscodeAPI.postMessage()`
- **消息类型**: `loadHml`, `save`, `codegen`, `compile`, etc.

### 4. FileManager 加载流程
HML 文件通过 CustomTextEditorProvider 打开，加载流程：
```
HmlEditorProvider.resolveCustomTextEditor()
  └─► loadFromDocument(document) ─► 解析内容，等待前端 ready
  └─► [前端 ready] ─► reloadCurrentDocument() ─► sendLoadHmlMessage()
```

## 关键概念

### HML (HoneyGUI Markup Language)
类 XML 格式描述界面结构：
```xml
<hg_view id="main_view" x="0" y="0" w="480" h="272">
  <hg_button id="btn1" x="10" y="10" w="100" h="40" text="Click" />
</hg_view>
```

### 组件类型与层级规则
- 完整组件类型列表见 `src/webview/types.ts` 的 `ComponentType`
- **容器控件**（`hg_view`, `hg_window`, `hg_list`, `hg_list_item`）：可包含子组件
- **非容器控件**：必须作为容器的子组件，不能包含子组件

### 代码生成策略
- **双引擎支持**：通过 `CodeGeneratorFactory` 选择目标引擎（`'honeygui'` 或 `'lvgl'`），由 `project.json` 中的 `targetEngine` 字段决定
- **HoneyGUI 引擎**（`src/codegen/honeygui/`）：`HoneyGuiCCodeGenerator`，含组件生成器和事件生成器
- **LVGL 引擎**（`src/codegen/lvgl/`）：`LvglCCodeGenerator`，含组件生成、样式生成、资源管理等
- **UI 代码** (`*_ui.c/h`): 每次覆盖
- **回调代码** (`*_callbacks.c`): 保护区机制，保留用户代码
- **用户代码** (`user/*.c`): 只生成一次，永不覆盖

### Tab 切换布局
左侧面板使用 Tab 切换：
- Tab 1: 组件库
- Tab 2: 资源
- Tab 3: 组件树

## 开发规范

### 代码风格
- TypeScript 严格模式
- React Hooks (函数组件)
- CSS 模块化（每个组件独立 CSS）
- 使用 VSCode 主题变量 (`var(--vscode-*)`)

### 命名约定
- 组件: PascalCase (`DesignerCanvas`)
- 文件: PascalCase (`DesignerCanvas.tsx`)
- CSS 类: kebab-case (`.designer-canvas`)
- 函数: camelCase (`handleDrop`)

### 代码复用规则
- **分辨率解析**：统一使用 `ProjectUtils.parseResolution(resolution)`，不要重复实现
- **项目配置读取**：使用 `ProjectUtils.loadProjectConfig(projectRoot)`
- **路径获取**：使用 `ProjectUtils.getAssetsDir()` / `getUiDir()` / `getSrcDir()`
- **添加新功能前**：先搜索是否已有类似工具函数，避免重复造轮

## 常见任务

### 添加新组件类型
1. 在 `ComponentLibrary.tsx` 的 `componentDefinitions` 添加定义
2. 在 `HoneyGuiCCodeGenerator.ts` 添加代码生成逻辑
3. 更新 `ComponentType` 类型定义
4. **同步更新 HML 规范**：以 `vibe-designer/skills/honeygui-designer/references/hml-spec.md` 为英文唯一规范源，并同步维护中文镜像 `docs/HML-Spec-zh.md`

### 新增或修改控件属性
- 属性面板采用统一的分类层级体系（基本信息、布局、状态、内容、字体、样式、变换、渲染、交互、行为、高级），新增属性应优先归入已有分组，仅在用户明确要求且理由充分时才可新增分组
- 所有属性分组使用 `CollapsibleGroup` 组件（基本信息除外）

### 添加新项目模板
项目模板通过 Git 仓库管理，添加新模板：
1. 创建完整的项目模板仓库（包含 ui/, assets/, src/, project.json 等）
2. 推送到 Gitee
3. 在 `src/template/TemplateConfig.ts` 的 `AVAILABLE_TEMPLATES` 中添加配置：
   ```typescript
   {
       id: 'my-template',
       name: 'My Template',
       description: '模板描述',
       repo: 'https://gitee.com/realmcu/honeygui-template-my-template.git',
       size: '5 MB'
   }
   ```
4. 用户创建项目时会自动从 Gitee 下载并缓存到 `~/.honeygui/templates/`

### 添加新资源类型（如字体、音频等）
资源显示涉及前后端两处，必须同时修改：
1. **后端** `src/designer/AssetManager.ts`：在 `scanAssetsDirectory` 中添加扩展名识别
2. **前端** `src/webview/components/AssetsPanel.tsx`：
   - 添加扩展名常量（如 `FONT_EXTS`）
   - 添加到 `AssetCategory` 类型
   - 在 `categorizedAssets` 和 `counts` 中添加分类
   - 在 `renderAssetItem` 中添加渲染逻辑

### 修改 UI 布局
- 主布局: `src/webview/App.tsx` + `App.css`
- 面板样式: `src/webview/components/*.css`
- 全局样式: `src/webview/global.css`

## 重要约束

### 项目规则（必须遵守）
1. **编译规则**：
   - 修改代码后执行：`npm run compile && npm run build:webview`
   - 修改资源文件后执行：`npm run build:webview`
2. **语言规则**：使用中文回答问题
3. **离线优先**：这是离线版本的 VSCode 插件，不要添加依赖网络的功能
4. **文档管理**：
   - 不要随意创建 Markdown 文档
   - 不要删除 `CLAUDE.md` 文件
5. **代码质量**：
   - 考虑整理软件框架
   - Review 是否存在冗余代码
6. **HML 规范文档同步**：
   - 当 HML spec 发生变动（新增组件、新增/修改属性、新增事件类型、修改嵌套规则等）时，必须更新 `vibe-designer/skills/honeygui-designer/references/hml-spec.md`，并同步更新 `docs/HML-Spec-zh.md`
   - 英文 skill 规范是 AI agent 生成 HML 的唯一规范源；中文文件是面向中文开发者的同步镜像
7. **执行环境**：只在 CMD 环境下执行命令，不要在 PowerShell 环境下执行
8. **代码提交**：
   - 默认情况下，只修改代码，不执行 git 操作
   - 只有当用户明确说"提交"、"commit"、"push"、"提交到 gitee"等关键词时，才执行 git 操作
   - 如果不确定是否需要提交，先询问用户
   - 拉取代码后必须执行 `git submodule update --init --recursive`，提交前确保 submodule 指向正确版本
9. **打包安装包**：
   - 当用户说"打包"、"生成安装包"或"package"时，执行以下流程：
     1. 执行 `npm install` 安装依赖（干净仓库必需）
     2. 执行 `npm run compile` 编译代码
     3. 执行 `npm run build:webview` 构建前端
     4. 执行 `vsce package` 生成 `.vsix` 文件
10. **版本号规则**：
   - **格式**：`major.minor.patch`（如 1.6.30）
   - **patch 版本规则**：
     - **偶数**：正式版本（如 1.6.30, 1.6.32）
     - **奇数**：测试版本（如 1.6.31, 1.6.33）
   - **版本递增**：每次发布都递增 patch 版本，不管是正式版还是测试版
   - **Git Tag**：每次发布都创建 git tag（如 `v1.6.30`）
11. **发布正式版本**：
   - 当用户说"发布版本"、"发布正式版"或"publish"时，执行以下流程：
     1. 更新版本号到下一个偶数版本（如 1.6.30 → 1.6.32）, 根据 git 记录，总结更新 changelog
     2. 同步更新 `package.json` 与 `package-lock.json` 中的版本号
     3. 执行 `npm ci` 按锁文件安装依赖
     4. 执行 `npm run lint`、`npm test`、`npm run compile`、`npm run build:webview` 和 `npm run check:deps`
     5. Commit: `chore: bump version to x.x.x`
     6. Push master: `git push origin master`
     7. 等待并确认 GitHub Actions 的常规 `CI` 工作流全部通过
     8. 创建 Git Tag: `git tag -a vx.x.x -m "vx.x.x"`
     9. Push Tag: `git push origin vx.x.x`
     10. 观察 GitHub Actions 的 `Publish VS Code extension` 工作流，确认正式版发布步骤成功
     11. 在 VSCode Marketplace 公共页面确认新版本可见
   - 正常发布入口是推送版本 Tag；不要在本地直接执行 `vsce publish`
12. **发布测试版本**：
   - 当用户说"发布测试版"、"发布预览版"或"publish preview"时，执行以下流程：
     1. 更新版本号到下一个奇数版本（如 1.6.30 → 1.6.31）, 根据 git 记录，总结更新 changelog
     2. 同步更新 `package.json` 与 `package-lock.json` 中的版本号
     3. 执行 `npm ci` 按锁文件安装依赖
     4. 执行 `npm run lint`、`npm test`、`npm run compile`、`npm run build:webview` 和 `npm run check:deps`
     5. Commit: `chore: bump version to x.x.x (preview)`
     6. Push master: `git push origin master`
     7. 等待并确认 GitHub Actions 的常规 `CI` 工作流全部通过
     8. 创建 Git Tag: `git tag -a vx.x.x -m "vx.x.x preview"`
     9. Push Tag: `git push origin vx.x.x`
     10. 观察 GitHub Actions 的 `Publish VS Code extension` 工作流，确认预览版发布步骤成功
     11. 在 VSCode Marketplace 公共页面确认新版本可见且标记为 Pre-Release
   - `.github/workflows/publish.yml` 根据 patch 奇偶自动选择正式版或预览版，不要手动传递 `--pre-release`
   - **测试版特性**：
     - 测试版用户不会自动更新到正式版
     - 测试版之间可以自动更新（如 1.6.31 → 1.6.33）
     - 适合内部测试和公测，不影响正式版用户
13. **项目模板**：由 `src/template/TemplateConfig.ts` 的 `AVAILABLE_TEMPLATES` 管理，模板来源为 Gitee 远程仓库，本地缓存于 `~/.honeygui/templates/`
14. **国际化 (i18n)**：所有用户可见的文本必须支持多语言
    - **Extension 端**：使用 `vscode.l10n.t('key')` 进行翻译
      - 翻译文件：`l10n/bundle.l10n.json`（英文）、`l10n/bundle.l10n.zh-cn.json`（中文）
    - **Webview 端**：使用 `t('key')` 函数（从 `../i18n` 导入）
      - 翻译文件：`src/webview/i18n/locales/en.ts`（英文）、`src/webview/i18n/locales/zh-cn.ts`（中文）
    - **package.json**：命令标题使用 `%key%` 语法，配合 `package.nls.json` 和 `package.nls.zh-cn.json`

### 不要做的事
- ❌ 不要修改单元测试（除非用户明确要求）
- ❌ 不要在代码中硬编码密钥
- ❌ 不要自动添加测试（除非用户要求）
- ❌ 不要覆盖 `user/` 目录下的文件
- ❌ 不要修改 `*_ui.c/h` 的保护区标记
- ❌ 不要添加网络依赖功能
- ❌ 不要随意创建文档
- ❌ **不要未经用户明确允许推送发布 Tag**（推送 `vX.Y.Z` 会自动发布到插件市场）

## AI 助手协作建议

### 在修改代码前
1. 先分析现有实现
2. 提出方案供用户选择
3. 得到确认后再实施

### 代码改动原则
- 最小化改动，只修改必要部分
- 保持现有代码风格一致
- 添加必要的注释

### 提交规范
- 使用约定式提交: `feat:`, `fix:`, `refactor:`, `docs:`
- 提交信息清晰描述改动内容
- 一次提交只做一件事

### 沟通方式
- 直接回答问题，不过度客套
- 提供具体可执行的方案
- 遇到不确定的情况，明确说明并询问

## VSCode 插件市场发布

### 自动发布
- 正常发布由 `.github/workflows/publish.yml` 完成，入口是推送格式为 `vX.Y.Z` 的 Git Tag；`workflow_dispatch` 仅用于对已有 Tag 手动重跑
- 工作流会校验 Tag、`package.json` 和 `package-lock.json` 版本一致性，并依次执行 lint、完整单测、编译、Webview 构建、打包依赖审计、VSIX 打包和制品上传
- 偶数 patch 自动发布正式版；奇数 patch 自动使用 `--pre-release` 发布预览版
- Marketplace PAT 保存在 GitHub Actions Repository Secret `VSCE_PAT` 中，不要写入仓库、日志或命令行参数
- 发布后必须检查 GitHub Actions 结果，并等待 Marketplace 公共索引出现新版本

### 紧急手动兜底
仅当 GitHub Actions 不可用且用户明确授权时，才允许使用本地安全发布脚本：
```bash
# 正式版
npm run publish:safe

# 预览版
npm run publish:safe -- --pre-release
```
脚本通过环境变量 `VSCE_PAT` 读取凭据。手动发布完成后仍必须核验 Marketplace 版本。
