# Changelog

All notable changes to HoneyGUI Visual Designer will be documented in this file.

## [1.8.1] - 2026-06-25

### Added

- 动画支持（LVGL）：可对组件属性配置补间动画，自动生成 `lv_anim` / `lv_anim_timeline`，离散动作生成 `lv_timer` 回调；switch 定时器按需升级
- hg_progressbar / hg_slider 新增「调整数值」（value）动作，支持对控件数值做补间动画

### Changed

- 升级字体转换器（font-converter v3.2.1）：字形头字段拓宽至 16-bit，支持更大字号 / 更多字形的字体转换
- 移除 gui_vector_map / gui_openclaw 库及相关组件（hg_map、hg_openclaw、hg_claw_face）和属性面板项
- AI 协作资产改用根 AGENTS.md 作中性门面分发（追加而非覆盖用户文件），新建项目可勾选是否启用，新增旧项目残留清理

### Fixed

- 修复大字号文本纵向排版错位，以及单行文本垂直居中（MID）时位置偏低的问题
- 修复资源转换面板因脚本语法错误整页失效、点击选择目录无反应的问题（#7）
- 重新生成代码时保留 `*_lvgl_ui.c` 中用户自定义函数（新增 `USER CODE` 保护区），保护区丢失时改为告警而非静默丢弃（#12）

### Internal

- 同步 font-converter 至 v3.2.1（字形头字段拓宽至 16-bit），新增同步脚本
- 延迟 AI 资产同步至插件初始化后执行，避免阻塞激活；hml-spec 更新检查改用 mtime + 头部比对
- 同步中文 HML 规范至英文 2.0；CI 与仿真库构建流程修复

## [1.8.0] - 2026-06-16

### Added

- 启用 codegen / simulation 的 HTTP API 端点，支持外部工具远程触发代码生成与仿真
- 新增 AI 协作资产：对齐 honeygui-designer skill 与 HML-Spec，分发 references / examples 供 AI 代理生成 HML
- entry 入口文件新增保护区（`@protected`），重新生成时保留用户自定义代码

### Removed

- 彻底移除协同开发（Collaboration）功能的所有残留代码与引用

### Internal

- 清理死代码、提取 ColorUtils 工具类、修复 `_sleep` 忙等待
- 移除未使用的 vite 与 @vitejs/plugin-react 依赖
- CI：新增 Windows e2e job（MinGW 8.1.0，覆盖全部模板）；将 update-libs 抽为独立 nightly workflow，定时改为 UTC 20:00（北京 04:00）；优化 LVGL clone 重试与仿真库自动更新流程

## [1.7.17] - 2026-06-11

### Added

- 字体属性面板新增字符统计与缺字检测：显示当前字符集的字符数、预估 bin 大小，并标注 cmap 中缺失的字符
- hg_time_label / hg_timer_label 支持在属性面板自定义 text 内容，设计态画布实时预览

### Changed

- 移除协作（Collaboration）功能：删除 CollaborationService、CollaborationPanel 及全部相关命令和 UI 组件

### Fixed

- 修复 hg_view 高级栏「常驻内存」checkbox 另起一行的布局问题

### Internal

- CI 新增 Win32 仿真库自动构建 job：自动编译并提交 `lib/sim/win32/libgui.a` 和 `lvgl-pc/lvgl-lib-win32/`
- CI `update-libs` job 补充 Linux LVGL 库自动构建，输出至 `lvgl-pc/lvgl-lib-linux/`
- 修复 `update-libs` job 因 `GITHUB_TOKEN` 缺少写权限导致 push 403 的问题
- 优化 CI LVGL clone 策略：改用 `git ls-remote` 获取 hash，cache hit 时跳过 clone

## [1.7.15] - 2026-06-09

### Fixed

- 修复 arc 组件参数改变后画布不立即刷新的问题（widgetMemo 比较器改为按引用比较 style/data 对象，覆盖 radius、color、strokeWidth、渐变等所有字段）
- 修复 progressbar/slider 等控件属性变更后画布不更新、与仿真器显示不一致的问题
- 修复进度条底层背景（轨道色）默认无圆角、四角露出直角色块的问题
- 修复市场版打包遗漏 lv-font-conv 工具及运行时依赖，导致 LVGL 字体转换静默失败的问题

### Changed

- 更新仿真器 GUI 库（libgui.a）
- 修正 quick_slide 中文翻译

## [1.7.13] - 2026-06-04

### Added

- 新增「转换资源」（Convert Resource）独立按钮：可单独执行资源转换，无需触发完整仿真流程
- 新增仿真流程（Simulation Flow）配置菜单：支持自由勾选「转换资源 / 生成代码 / 启动仿真」三个阶段，点击仿真时按所配置的流程执行，默认全部启用
- 工具栏显性展示已配置使能的仿真流程，便于直观确认当前将执行哪些阶段
- LVGL 位图字体新增逐组件 MSB/LSB 像素顺序（pixel order）配置

### Changed

- 移除仿真下拉中的「调试仿真」（Debug Simulation），其行为由可配置的仿真流程统一覆盖
- 仿真启动后流程示意区保持显示且不变灰，仅置为不可点击
- 更新 LVGL 仿真库（liblvgl.a）

## [1.7.11] - 2026-06-03

### Added

- hg_video 新增 MSV1 格式视频支持，新增 GIF 视频支持
- hg_video 新增 Cinepak 编码支持
- hg_view 事件类型新增「快速滑动」（SWITCH_FAST_SWIPE）
- hg_view 事件面板优化：事件类型分组展示，新增可视化事件添加交互逻辑
- 资源管理器新增「用户资源目录」（user resource dir），支持自定义外部资源路径

### Fixed

- 修复 hg_img 同时设置变换中心与缩放比例时变换不生效的问题
- 修复 hg_img 修改变换属性后画布预览不刷新的问题
- 修复工具栏撤销/重做（Undo/Redo）按钮状态异常
- 补全 hg_view 定时器（timer）相关事件功能
- 修复 hg_view 滑动模式下可错误选择 `SWITCH_OUT_NONE_ANIMATION` 动画的问题
- 修复 GIF 静帧预览不显示的问题

### Changed

- 更新仿真器 GUI 库（libgui.a）：同步最新 `gui_view`/`gui_view_instance` 头文件
- 更新 HML Spec（增加 view 快速滑动事件类型定义）
- 性能优化：引入 RAF 防抖减少 zoom/pan 时 localStorage 写入；全部 Widget 组件包裹 `React.memo` 避免无关重渲染
- 代码质量：统一 `createXComponent` 消息处理器；抽取公共 `removeComponentsImpl` 逻辑；协作状态切片迁移至独立 Zustand slice

### Internal

- 升级 ESLint v8 → v10，迁移至 Flat Config 格式
- 替换 `eslint-plugin-import` 为 `eslint-plugin-import-x` 以兼容 ESLint v10

## [1.7.9] - 2026-05-19

### Added

- hg_video 新增画布预览（Canvas Preview）：设计器中直接渲染视频首帧，支持裁剪（crop）和缩放（scale）效果的实时预览，精确反映最终输出画面
- hg_video 代码生成：变量类型由 `gui_obj_t` 更正为 `gui_video_t`；自动播放关闭时生成 `GUI_VIDEO_STATE_INIT`，开启时生成 `GUI_VIDEO_STATE_PLAYING`

### Fixed

- hg_video：移除 crop 配置后，控件尺寸正确恢复为视频自然分辨率
- hg_video：修复从 HML 文件重新加载时 autoPlay 属性类型转换错误，导致始终生成 PLAYING 状态的问题
- hg_video：默认启用自动播放（autoPlay 默认值由 false 改为 true）
- LVGL：无事件绑定时也始终生成回调文件，避免编译缺失符号错误

### Changed

- 更新仿真器 GUI 库（libgui.a）至最新构建（feca4953f，2026-05-18）

## [1.7.7] - 2026-05-15

### Added

- hg_video 新增视频缩放配置：支持 pixel（绝对像素）和 percentage（百分比）两种模式，可在转换配置面板中为单个视频或目录统一设置输出尺寸

## [1.7.5] - 2026-05-14

### Added

- hg_view 新增「快照缓存」属性（snapShot），启用后页面切换更流畅，代价是增加内存消耗，默认不开启
- 代码生成：`GUI_VIEW_INSTANCE` 统一使用 5 参数形式，第 5 个参数为 `snap_shot` 开关
- LVGL：新增 external-bin 部署模式（romfs 资源），支持 `LvglBinImageConverter` + `LvglRomfsPackager`，图像可打包为 romfs.bin 在仿真器中加载
- LVGL：新增 RLE 压缩支持（external-bin 模式），支持 RGB565/RGB888/ARGB8565/ARGB8888，自动剔除不兼容格式（Index 系列）
- LVGL：集成 lv-font-conv 字体转换工具，完善 LVGL 字体二进制生成流程

### Fixed

- 修正 HoneyGUI 多个组件生成器（Button/Image/Input/Map 等）函数传参错误
- 修正 `isInherited` 语义，避免 deployment 字段误触发继承标记

## [1.7.3] - 2026-05-07

### Added

- LVGL：新增 GIF 动图（hg_gif）代码生成器，使用 lv_gif_create/lv_gif_set_src
- LVGL：新增 SVG 图像（hg_svg）代码生成器，启用 LV_USE_SVG 支持

### Fixed

- 修复数字输入框（width/height/x/y 等）清空后出现自动填充数值的问题：空值时不再立即触发保存，改为失焦时才提交默认值
- 修复输入数值后切换选中控件，导致新控件属性被意外覆盖的问题
- 修复 list note 无法绑定 timer 的问题

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
