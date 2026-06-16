# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

- **Install Dependencies**: `npm install`
- **Build Extension**: `npm run compile` (Output: `out/`)
- **Build Webview**: `npm run build:webview` (Production) or `npm run build:webview:dev` (Development)
- **Watch Extension**: `npm run watch` (Compiles TS on change)
- **Watch Webview**: `npm run watch:webview` (Rebuilds Webpack on change)
- **Lint**: `npm run lint` (ESLint)
- **Run Tests**: `npm run test` (Template tests only)
- **Package Extension**: `npm run package` (Builds everything and creates .vsix)
- **Clean**: `npm run clean`
- **Full Rebuild**: After code changes, run `npm run compile && npm run build:webview`

## Architecture and Structure

This project is a VS Code extension ("HoneyGUI Visual Designer") for embedded GUI development.

### Core Components
- **Extension Host** (`src/`): Runs in VS Code's Node.js process.
  - **Entry Point**: `src/extension.ts` initializes `ExtensionManager`.
  - **Core Logic**: `src/core/` manages extension lifecycle and providers.
    - `ExtensionManager`: Coordinates all extension subsystems (commands, HML editor, environment checks, simulation).
    - `CommandManager`: Registers all VSCode commands for the extension.
  - **HML Handling**: `src/hml/` parses and processes the `.hml` (HoneyGUI Markup Language) files.
    - `HmlParser`: Converts HML (XML-like) to component objects.
    - `HmlSerializer`: Converts component objects back to HML.
    - `HmlEditorProvider`: Custom editor provider for `.hml` files.
  - **Code Generation**: `src/codegen/` generates C code from the design.
    - `honeygui/`: Main code generator with component-specific generators and event handlers.
    - Uses "protected areas" (`/* @protected start ... */`) to preserve user code across regeneration.
    - Generated files per HML: `{name}_ui.c`, `{name}_ui.h`, `{name}_callbacks.c/h` (protected), `{name}_user.c/h` (user code).
    - `EntryFileGenerator`: Creates project entry point that initializes all screens.
  - **Simulation**: `src/simulation/` handles the compile-run-debug cycle for embedded simulation.
    - `BuildCore`: Platform-independent build logic.
    - `BuildManager`: VSCode-integrated build with terminal output.
    - `SimulationRunner`: Executes compiled binaries in VSCode terminal.
    - `EnvironmentChecker`: Validates Python, SCons, and toolchain setup.
  - **Tools**: `src/tools/` contains resource converters (images, fonts, 3D models, videos).
  - **Services**: `src/services/` provides high-level services.
    - `CodeGenerationService`: Orchestrates C code generation from HML files.
    - Converter services: `ImageConverterService`, `FontConverterService`, `VideoConverterService`, `Model3DConverterService`, `GlassConverterService`.
    - `UartDownloadService`: Handles UART-based firmware downloads.
  - **Designer**: `src/designer/` manages the webview panel lifecycle.
    - `DesignerPanel`: Individual webview panel instance.
    - `DesignerPanelFactory`: Singleton pattern to create/reuse panels.
    - `MessageHandler`: Routes messages between extension and webview.
    - `SaveManager`: Manages save transactions and conflict resolution.
  - **Templates**: `src/template/` contains project scaffolding.
    - `ProjectTemplate`: Generates new projects from templates with `project.json` configuration.

### Webview Designer
- **Location**: `src/webview/`
- **Tech Stack**: React 19, TypeScript, Zustand (State Management), Fabric.js (Canvas), Three.js (3D).
- **Build**: Built with Webpack into `out/designer/webview`.
- **Entry**: `src/webview/index.tsx`.
- **Communication**: Uses `vscode.postMessage` and window event listeners to exchange data with the Extension Host.
- **State Management**: Zustand store in `store.ts` handles components, selection, undo/redo (50 steps), canvas state.
- **Key Features**:
  - Drag-and-drop component library.
  - Canvas with zoom/pan (using Fabric.js).
  - Component tree with hierarchy management.
  - Properties panel with component-specific editors.
  - Asset manager for images, fonts, videos, 3D models.
  - Undo/redo using command pattern.

### Key Directories
- `src/`: Source code for extension and webview.
- `out/`: Compiled output (JS files).
- `resources/`: Icons and static assets.
- `l10n/`: Localization files (i18n).
- `scripts/`: Build and utility scripts.
- `test/`: Test files (primarily template tests).
- `lib/sim/`: Simulation libraries for different platforms.
- `docs/`: Architecture and feature documentation (Chinese).

## Project Structure (User Projects)
HoneyGUI projects created by this extension have the following structure:
- **project.json**: Project configuration (name, resolution, main HML file, assets directory).
- **ui/**: Contains `.hml` design files.
- **src/**: Generated C code from HML files (organized by HML name).
- **assets/**: Images, fonts, videos, 3D models converted to binary format.
- **build/**: Compilation output (SCons build system).

## Important Constraints
- **Offline-Only**: This is an offline extension. Do not add features that require internet connectivity.
- **No PowerShell**: Build commands must work in CMD on Windows (avoid PowerShell-specific syntax).
- **Chinese Documentation**: Use Chinese for user-facing documentation and comments where appropriate.
- **Avoid Creating Documentation**: Do not create new .md files unless explicitly required.
- **HML Spec Sync**: When the HML spec changes (new components, new/modified attributes, new event types, nesting rule changes, etc.), you MUST update `vibe-designer/skills/honeygui-designer/references/hml-spec.md` accordingly. This file is the single source of truth for AI agents generating HML files.

## Style and Conventions
- **Language**: TypeScript is used for both the extension and the webview.
- **UI Framework**: React with Hooks for the designer interface.
- **State Management**: Zustand is used for global state in the React app.
- **Internationalization**: Uses `vscode.l10n` for the extension and a custom i18n solution (`src/webview/i18n.ts`) for the webview.
- **Formatting**: Adheres to standard Prettier/ESLint rules defined in the project.
- **Webpack Configuration**: Code splitting is disabled for webview (VS Code webview URI restrictions). All code is bundled into a single file.
