# CLAUDE.md

This file supplements `AGENTS.md` for Claude Code. Read `AGENTS.md` first; it is the authoritative source for repository workflow, release rules, i18n requirements, and safety constraints.

## Build Commands

- Install: `npm install`
- Compile extension: `npm run compile`
- Build webview: `npm run build:webview`
- Watch extension: `npm run watch`
- Watch webview: `npm run watch:webview`
- Lint: `npm run lint`
- Unit tests: `npm run test`
- Extension E2E tests: `npm run test:e2e`
- Performance tests: `npm run test:perf`
- Template tests: `npm run test:templates`
- Full required build after code changes: `npm run compile && npm run build:webview`

Run project commands through CMD on Windows. Do not use PowerShell-specific command syntax.

## Current Architecture

HoneyGUI Design is an offline-first VS Code extension with a React webview. It edits HML files, converts assets, generates C for HoneyGUI or LVGL, and runs PC simulation builds.

### Extension Host

- `src/extension.ts`: activation and deactivation; starts `ExtensionManager` and the local extension HTTP API.
- `src/core/ExtensionManager.ts`: registers commands, views, the HML custom editor, simulation, UART download, and project assets.
- `src/hml/HmlEditorProvider.ts`: creates one `DesignerPanel` per open HML document and watches editor and disk changes.
- `src/designer/DesignerPanel.ts`: assembles the panel-scoped controllers and managers.
- `src/designer/FileManager.ts`: loads, serializes, saves, reloads, and snapshots HML content.
- `src/designer/MessageHandler.ts`: handles messages sent by the webview.
- `src/hml/HmlController.ts`: owns the parsed HML document and delegates parsing and serialization.

The initial load handshake is significant:

```text
HmlEditorProvider.resolveCustomTextEditor()
  -> FileManager.loadFromDocument() parses without posting
  -> webview posts ready
  -> MessageHandler calls FileManager.reloadCurrentDocument()
  -> FileManager posts loadHml
```

Do not send the initial `loadHml` before the webview is ready.

### Webview

- `src/webview/index.tsx`: React entry point.
- `src/webview/App.tsx`: application layout and host-message dispatch.
- `src/webview/store.ts`: Zustand state, component operations, dirty tracking, navigation state, and project i18n.
- `src/webview/components/DesignerCanvas.tsx`: DOM-based component canvas with zoom, pan, drag, resize, and selection.
- `src/webview/components/widgets/`: component previews.
- `src/webview/components/properties/`: component property editors.

The main canvas is not Fabric.js based. Three.js is used only where 3D content requires it. Undo and redo requests are sent to the extension host, where `FileManager` manages content snapshots.

### Code Generation And Simulation

- `src/services/CodeGenerator.ts`: parses project HML files and prepares generator options.
- `src/codegen/CodeGeneratorFactory.ts`: selects `HoneyGuiCCodeGenerator` or `LvglCCodeGenerator` from `project.json.targetEngine`.
- `src/codegen/honeygui/`: HoneyGUI generators and protected user-code handling.
- `src/codegen/lvgl/`: LVGL generators, styles, resources, and event generation.
- `src/simulation/SimulationRunner.ts`: orchestrates generation, conversion, compilation, and execution.

HoneyGUI simulation uses the bundled simulation libraries and SCons toolchain. LVGL simulation uses the `lvgl-pc` CMake project.

## Project Data

- `project.json`: resolution, target engine, main HML file, assets, AI asset distribution, and build options.
- `ui/`: HML design files.
- `assets/`: source images, fonts, videos, and 3D models.
- `src/`: generated C and user-owned source files in generated projects.
- `i18n/strings.json`: project text catalog when project i18n is enabled.

HML files are the persisted design source. The Zustand store is the in-memory editing state. Saving posts component data to the extension host, which serializes and applies the document edit inside a save transaction.

## Documentation Sources

- Repository rules: `AGENTS.md`
- Maintainer guide: `docs/开发指南.md`
- User guide: `docs/功能使用手册.md`
- AI HML source of truth: `vibe-designer/skills/honeygui-designer/references/hml-spec.md`
- Chinese HML mirror: `docs/HML-Spec-zh.md`

When the HML schema changes, update both HML specification files. Do not create additional architecture or integration Markdown files; fold durable information into the maintainer guide.

## Important Constraints

- Keep the extension offline-first; do not add runtime network dependencies.
- Never overwrite files under generated project `user/` directories.
- Preserve generated-code protection markers.
- Use `vscode.l10n.t()` for extension-host user text.
- Use `t()` and both locale files under `src/webview/i18n/locales/` for webview user text.
- Do not publish, push, commit, or modify credentials without explicit user approval.
