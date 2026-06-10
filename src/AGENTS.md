# VSCode Extension Source Knowledge Base

**Generated:** 2026-04-14 08:28 UTC | **Commit:** d0fca06  
**Parent:** [honeygui-design](../AGENTS.md)  
**Purpose:** Extension implementation and webview UI

## OVERVIEW

TypeScript source for VSCode extension providing visual GUI designer, code generation, and simulation.

## STRUCTURE

```
src/
├── extension.ts         # Entry point
├── core/                # ExtensionManager, commands
├── hml/                 # HML parser/serializer
├── codegen/honeygui/    # C code generator
├── designer/            # Webview panel management
├── simulation/          # Build + run system
├── tools/               # Image/font/3D/video converters
├── services/            # High-level services
└── webview/             # React designer UI
    ├── App.tsx          # Main application
    ├── store.ts         # Zustand state management
    └── components/      # UI components
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add command | `core/CommandManager.ts` | Register all commands |
| Parse HML | `hml/HmlParser.ts` | XML → component tree |
| Generate C code | `codegen/honeygui/` | Component generators |
| Webview UI | `webview/App.tsx` | React designer |
| Build system | `simulation/BuildManager.ts` | SCons integration |
| Add component | `webview/components/ComponentLibrary.tsx` | Widget definitions |

## CONVENTIONS

### Extension Entry
```typescript
export async function activate(context: vscode.ExtensionContext) {
    const manager = new ExtensionManager(context);
    await manager.initialize();
}
```

**Activation Flow:**
```
extension.ts
  └─► ExtensionManager.initialize()
      ├─► CommandManager.registerCommands() (11 commands)
      ├─► HmlEditorProvider (CustomTextEditorProvider for .hml)
      ├─► EnvironmentViewProvider (sidebar views)
      └─► SimulationService, UartDownloadService
```

### Build System (Dual-Stage)

**Stage 1: Extension** (TypeScript → CommonJS)
```bash
npm run compile  # tsc → out/src/**/*.js
```
- Tool: TypeScript compiler
- Config: `tsconfig.json`
- Target: Node.js CommonJS for extension host

**Stage 2: Webview** (React → Single Bundle)
```bash
npm run build:webview  # webpack → out/designer/webview/webview.js
```
- Tool: Webpack + ts-loader
- Config: `webpack.config.js`
- Target: Browser environment
- **Critical:** No code splitting (VSCode webview limitation)

### Development Workflow
```bash
# Standard iteration
npm run compile && npm run build:webview
F5  # Launch Extension Development Host

# Fast webview-only
npm run watch:webview  # Hot reload for UI changes
```

### Code Generation Pipeline

**Flow: HML → C Code**
```
HmlController.parse()
  └─► Component tree
      └─► HoneyGuiCCodeGenerator
          ├─► ComponentGeneratorFactory
          │   └─► ViewGenerator, ButtonGenerator, etc.
          ├─► EventGeneratorFactory
          │   └─► ButtonEventGenerator, etc.
          └─► File Generators
              ├─► UI files (*_ui.h/c) - Overwritten
              ├─► Callback files (*_callbacks.c) - Protected
              └─► User files (user/*.c) - One-time only
```

**Protected Region Strategy:**
```c
/* @protected start custom_function */
void custom_function() {
    // User code preserved across regeneration
}
/* @protected end custom_function */
```

### Simulation Integration

**BuildManager (VSCode Wrapper):**
1. Setup `.honeygui-build/` directory
2. Convert assets (images, fonts → binary)
3. Copy generated C code
4. Run SCons to compile
5. Execute `gui.exe` (Windows) or `gui` (Linux)

**SimulationRunner (Full Orchestration):**
```typescript
start() {
  checkEnvironment()      // Verify Python, SCons, GCC
  generateCode()          // All HML → C code
  setupBuildEnvironment() // Prepare build dir
  compile()               // SCons build
  run()                   // Launch in terminal
}
```

### Message Protocol
Extension ↔ Webview:
```typescript
// Extension → Webview
panel.webview.postMessage({ 
  command: 'loadHml', 
  components: [...],
  projectConfig: {...}
});

// Webview → Extension
vscodeAPI.postMessage({ 
  command: 'save', 
  components: [...] 
});
```

**Message Handlers:**
- `loadHml` - Populate component tree
- `save` - Persist to .hml file
- `updateImagePath` - Asset dropped on canvas

## ANTI-PATTERNS

- **DO NOT** add network dependencies (offline-only)
- **DO NOT** use PowerShell-specific syntax (CMD only)
- **NEVER** overwrite `user/` directory files
- **NEVER** modify protected region markers in generated code

## ARCHITECTURE PATTERNS

### Singleton Managers
```typescript
StatusBarManager.getInstance()
DesignerService.getInstance()
```

### Factory Pattern
```typescript
ComponentGeneratorFactory.getGenerator(type)
EventGeneratorFactory.getGenerator(type)
DesignerPanelFactory.createOrShow()
```

### Webview Structure (React)
```
<App>
  ├─► Toolbar (save, undo, redo, zoom, simulate)
  ├─► Left Panel (Tab-based)
  │   ├─► Tab 1: ComponentLibrary
  │   ├─► Tab 2: AssetsPanel
  │   └─► Tab 3: ComponentTree
  ├─► Center: DesignerCanvas (Fabric.js)
  └─► Right Panel: PropertiesPanel
```

### State Store (Zustand)
```typescript
useDesignerStore {
  components: Component[]
  selectedComponent: string | null
  zoom: number
  canvasOffset: { x, y }
  projectConfig: ProjectConfig
  // Actions with 50-step undo/redo
  addComponent, updateComponent, removeComponent
  undo, redo
}
```

## NOTES

- **Distributed architecture:** No centralized `commands/` or `providers/`
- **Chinese i18n required:** Use `vscode.l10n.t()` (extension) and `t()` (webview)
- **Webpack bundling:** Single-file output for webview (no code splitting)
- **State management:** Zustand with 50-step undo/redo
- **SCons integration:** Entry at `HoneyGUI-SDK/win32_sim/SConstruct`
- **Offline-first:** No network dependencies (except Git template cloning)
- **Dual code generators:** `honeygui/` (native) + `lvgl/` (compatibility layer)
