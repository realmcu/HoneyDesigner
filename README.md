# HoneyGUI Design

Visual Embedded GUI Designer | Drag & Drop → Auto-generate C Code → Compile & Simulate

---

## Features

| Category | Content |
|----------|---------|
| **Design** | Drag & drop visual designer with live preview |
| **Components** | Buttons, labels, images, inputs, progress bars, sliders, video, 3D models |
| **Code** | HML → C code generation with user code protection |
| **Simulation** | One-click compile & run, works offline |
| **Resources** | Image/font/video/3D model converters |

## Installation

Search VSCode Marketplace for **"HoneyGUI Visual Designer"** → Install

## Quick Start

| Step | Action |
|------|--------|
| 1 | New Project - Click HoneyGUI icon in sidebar |
| 2 | Design - Double-click .hml file, drag components to canvas |
| 3 | Run - Click ▶ Compile & Simulate in toolbar |

## Resource Conversion

`Ctrl+Shift+P → HoneyGUI: Resource Conversion Tools`

| Type | Input | Output |
|------|-------|--------|
| Image | PNG, JPG, BMP | BIN |
| Font | TTF, OTF | BIN |
| 3D | OBJ, GLTF, GLB | BIN |
| Video | MP4, AVI, MOV | MP4 (H.264) |

## Project Config

**project.json**
```json
{ "name": "my-project", "resolution": "480X272" }
```

## License

MIT

## Links

- [HoneyGUI SDK](https://github.com/realmcu/HoneyGUI)
- [Report Issues](https://github.com/realmcu/HoneyDesigner/issues)
