# Changelog

All notable changes to HoneyGUI Visual Designer will be documented in this file.

## [1.7.1] - 2026-04-30

### Added
- 新增 QR 码/条形码（hg_qbcode）LVGL 代码生成器，支持 lv_qrcode 和 lv_barcode
- 设计器 QR 码/条形码预览支持根据内容实时生成真实图案

## [1.7.0] - 2026-04-28

### ⚠️ Breaking Changes
- **字体引擎升级至 V3**：采用标准字体度量渲染，相同字号下文字比旧版更大。旧项目中文本框可能显示不全，需手动调整控件尺寸（建议高度至少为字号的 1.5 倍）

### Added
- 新增进度条（Progress Bar）控件，支持 LVGL 引擎
- 新增滑块（Slider）和开关（Switch）的垂直方向支持
- 新增页面复杂度统计面板
- 新增多设计文件支持，共享资源管理
- 新增 project.json 分辨率和圆角改动实时监听
- LVGL：新增滑块、开关、进度条代码生成器
- LVGL：新增 List / ListItem 组件代码生成
- LVGL：支持无 action 的事件绑定及 clickable 标志
- LVGL：增量资源转换及字体 BPP 支持
- checkbox/radio 控件完善：文本属性、字体支持、LVGL 代码生成优化
- 属性面板折叠分组与分类整理
- 滑块属性值范围约束
- 组件库支持按目标引擎区分控件可用状态
- 新增调试仿真选项（可跳过代码生成）
- 新增 /api/validate-hml 端点

### Changed
- 字体转换器升级至 v3.1.1，移除字体度量预览功能
- LVGL UI 生成拆分为按 view 独立的 create 函数
- LVGL 事件处理整合为通用事件生成器
- HML 解析器属性类型转换改为基于组件定义
- HgList / HgVideo 属性面板分组布局调整
- 重命名 McpBridgeService 为 ExtensionApiService

### Fixed
- 修复 canvas 显示问题
- 修复 snprintf 缓冲区溢出警告
- 修复 HgViewProperties 复杂度计算中可选组件属性处理
- 修复 list 展开预览功能
- 修复 radio LVGL 代码生成器使用非标准 API
- 移除组件定义中冗余的 enabled 属性
