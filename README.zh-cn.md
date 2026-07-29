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
