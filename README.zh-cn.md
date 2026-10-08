# HoneyGUI Design

可视化嵌入式 GUI 设计工具 | 拖拽设计 → 自动生成 C 代码 → 编译仿真

---

## 功能

| 分类 | 内容 |
|------|------|
| **设计** | 拖拽式可视化设计，实时预览 |
| **组件** | 按钮、标签、图片、输入框、进度条、滑块、视频、3D 模型等 |
| **代码** | HML → C 代码生成，用户代码保护区 |
| **仿真** | 一键编译运行，离线可用 |
| **资源** | 图片/字体/视频/3D 模型转换工具 |

## 安装

VSCode 扩展市场搜索 **"HoneyGUI Visual Designer"** → 安装

## 网页版

无需安装，直接在浏览器中使用：**https://realmcu.github.io/HoneyDesigner/**

- 在 Chrome、Edge 或 Firefox 中设计 HML，生成 HoneyGUI / LVGL C 代码
- 工程保存在浏览器中，可导入、导出 ZIP；Chrome 和 Edge 还可以直接打开本地工程文件夹
- 首次访问后可离线使用，也可以从地址栏安装为应用
- 仿真、串口下载和资源转换需要使用 VS Code 插件：导出 ZIP 后用 VS Code 打开即可

## 快速开始

| 步骤 | 操作 |
|------|------|
| 1 | 新建项目 - 点击左侧 HoneyGUI 图标 |
| 2 | 设计界面 - 双击 .hml 文件，拖拽组件到画布 |
| 3 | 编译运行 - 点击工具栏 ▶ 编译仿真 |

## 资源转换

`Ctrl+Shift+P → HoneyGUI: Resource Conversion Tools`

| 类型 | 输入 | 输出 |
|------|------|------|
| 图片 | PNG, JPG, BMP | BIN |
| 字体 | TTF, OTF | BIN |
| 3D | OBJ, GLTF, GLB | BIN |
| 视频 | MP4, AVI, MOV | MP4 (H.264) |

## 项目配置

**project.json**
```json
{ "name": "my-project", "resolution": "480X272" }
```

## 许可证

MIT

## 链接

- [HoneyGUI SDK](https://github.com/realmcu/HoneyGUI)
- [问题反馈](https://github.com/realmcu/HoneyDesigner/issues)
