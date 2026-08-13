# 一键安装缺失依赖 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「环境检查」侧栏上增加一键安装缺失依赖能力，用户手动触发后由 VS Code 集成终端执行平台安装命令。

**Architecture:** 纯映射逻辑（工具 id → 平台命令）与 VS Code 终端交互严格分离：纯函数不 import vscode，可进 jest 单测；终端交互单独封装。新增代码全部惰性——只在用户点击时才执行，零激活开销。

**Tech Stack:** TypeScript、VS Code Extension API（Terminal、commands、TreeView）、jest（ts-jest，`src/test/jest/`）。

## Global Constraints

- **不影响启动效率**：新增逻辑严禁在扩展激活路径执行。`DependencyInstaller` 的终端交互只在命令 handler 内触发；纯映射模块不得 import vscode，不得在模块顶层做任何 I/O 或子进程调用。
- **offline-first**：插件本身不发起网络请求；所有下载由终端里的 `winget`/`curl`/`apt-get` 命令完成。
- **i18n**：扩展宿主侧用户可见文案用 `vscode.l10n.t()`；package.json 命令标题用 `%command.xxx%` 键并补 `package.nls.json` + `package.nls.zh-cn.json` 两个文件。
- **jest 约束**：`src/test/jest/` 下的测试不得 import 'vscode'（jest 配置 `roots: ['<rootDir>/src/test/jest']`，无 vscode host）。
- **解压目标固定** `C:\mingw64`，与 `lib/sim/win32_sim/menu_config.py:19`（`EXEC_PATH = r'C:/mingw64/bin'`）一致。

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/simulation/dependencyCommands.ts`（新增） | 纯映射：`getInstallCommands(toolId, platform): string[]`，`needsRestart(toolIds, platform): boolean`，`COMMANDS` 常量。**不 import vscode**。 |
| `src/test/jest/dependencyCommands.test.ts`（新增） | 上述纯函数的单测。 |
| `src/simulation/DependencyInstaller.ts`（新增） | `installInTerminal(toolIds)`：复用/新建终端并逐条 sendText。**唯一** import vscode 的新文件。 |
| `src/ui/EnvironmentViewProvider.ts`（修改） | 未安装项加 `contextValue='installable'`；暴露 `getMissingInstallableToolIds()`。 |
| `src/core/ExtensionManager.ts`（修改） | 注册 `installAll` / `installOne` 命令。 |
| `package.json`（修改） | 命令 + view/title 按钮 + view/item/context 菜单。 |
| `package.nls.json` / `package.nls.zh-cn.json`（修改） | 命令标题本地化。 |
| `src/webview/i18n/locales/*` 无关——本功能仅扩展宿主侧文案，用 `vscode.l10n.t()`（无独立 l10n bundle 时回退到默认字符串即可）。 |

---

### Task 1: 纯映射模块 dependencyCommands.ts

**Files:**
- Create: `src/simulation/dependencyCommands.ts`
- Test: `src/test/jest/dependencyCommands.test.ts`

**Interfaces:**
- Produces:
  - `getInstallCommands(toolId: string, platform: NodeJS.Platform): string[]` — 返回该工具在该平台的安装命令数组；无映射或该平台不适用返回 `[]`。
  - `needsRestart(toolIds: string[], platform: NodeJS.Platform): boolean` — Windows 下若含 `'python'` 或 `'gcc'` 返回 true（PATH 变更需重启）。
  - `SUPPORTED_TOOL_IDS: readonly string[]` — `['python','scons','gcc','sdl2','ffmpeg']`。

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/jest/dependencyCommands.test.ts
import {
  getInstallCommands,
  needsRestart,
  SUPPORTED_TOOL_IDS,
} from '../../simulation/dependencyCommands';

const GCC_7Z_URL =
  'https://sourceforge.net/projects/mingw-w64/files/Toolchains%20targetting%20Win64/Personal%20Builds/mingw-builds/8.1.0/threads-posix/sjlj/x86_64-8.1.0-release-posix-sjlj-rt_v6-rev0.7z/download';

describe('getInstallCommands', () => {
  it('Windows Python 用 winget 3.12', () => {
    const cmds = getInstallCommands('python', 'win32');
    expect(cmds).toEqual([
      'winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements',
    ]);
  });

  it('Linux Python 用 apt-get', () => {
    expect(getInstallCommands('python', 'linux')).toEqual([
      'sudo apt-get install -y python3 python3-pip',
    ]);
  });

  it('Windows SCons 用 pip', () => {
    expect(getInstallCommands('scons', 'win32')).toEqual(['pip install scons']);
  });

  it('Linux SCons 用 pip3', () => {
    expect(getInstallCommands('scons', 'linux')).toEqual(['pip3 install scons']);
  });

  it('Windows GCC 是 4 步序列，含 7-Zip、.7z URL、C:\\mingw64、setx PATH', () => {
    const cmds = getInstallCommands('gcc', 'win32');
    expect(cmds).toHaveLength(4);
    expect(cmds[0]).toContain('7zip.7zip');
    expect(cmds[1]).toContain(GCC_7Z_URL);
    expect(cmds[1]).toContain('mingw64.7z');
    expect(cmds[2]).toContain('7z.exe');
    expect(cmds[2]).toContain('-o"C:\\"');
    expect(cmds[3]).toContain('setx PATH');
    expect(cmds[3]).toContain('C:\\mingw64\\bin');
  });

  it('Linux GCC 用 build-essential', () => {
    expect(getInstallCommands('gcc', 'linux')).toEqual([
      'sudo apt-get install -y build-essential',
    ]);
  });

  it('SDL2 仅 Linux 有命令，Windows 返回空', () => {
    expect(getInstallCommands('sdl2', 'win32')).toEqual([]);
    expect(getInstallCommands('sdl2', 'linux')).toEqual([
      'sudo apt-get install -y libsdl2-dev',
    ]);
  });

  it('Windows FFmpeg 用 winget Gyan.FFmpeg', () => {
    expect(getInstallCommands('ffmpeg', 'win32')).toEqual([
      'winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements',
    ]);
  });

  it('Linux FFmpeg 用 apt-get', () => {
    expect(getInstallCommands('ffmpeg', 'linux')).toEqual([
      'sudo apt-get install -y ffmpeg',
    ]);
  });

  it('未知工具返回空数组', () => {
    expect(getInstallCommands('unknown', 'win32')).toEqual([]);
  });

  it('macOS（不支持）返回空数组', () => {
    expect(getInstallCommands('python', 'darwin')).toEqual([]);
  });
});

describe('needsRestart', () => {
  it('Windows 装 python 需重启', () => {
    expect(needsRestart(['python'], 'win32')).toBe(true);
  });
  it('Windows 装 gcc 需重启', () => {
    expect(needsRestart(['gcc'], 'win32')).toBe(true);
  });
  it('Windows 只装 ffmpeg 不需重启', () => {
    expect(needsRestart(['ffmpeg'], 'win32')).toBe(false);
  });
  it('Linux 不需重启', () => {
    expect(needsRestart(['python', 'gcc'], 'linux')).toBe(false);
  });
});

describe('SUPPORTED_TOOL_IDS', () => {
  it('包含五个工具', () => {
    expect(SUPPORTED_TOOL_IDS).toEqual(['python', 'scons', 'gcc', 'sdl2', 'ffmpeg']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config jest.config.js src/test/jest/dependencyCommands.test.ts`
Expected: FAIL —— Cannot find module '../../simulation/dependencyCommands'。

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/simulation/dependencyCommands.ts
/**
 * 依赖安装命令映射（纯逻辑，禁止 import 'vscode'，禁止顶层 I/O）。
 * 供 src/test/jest 单测直接驱动，也供 DependencyInstaller 在终端执行。
 */

export const SUPPORTED_TOOL_IDS = ['python', 'scons', 'gcc', 'sdl2', 'ffmpeg'] as const;

const GCC_7Z_URL =
  'https://sourceforge.net/projects/mingw-w64/files/Toolchains%20targetting%20Win64/Personal%20Builds/mingw-builds/8.1.0/threads-posix/sjlj/x86_64-8.1.0-release-posix-sjlj-rt_v6-rev0.7z/download';

// Windows GCC：装 7-Zip -> 下载 .7z -> 解压到 C:\（顶层为 mingw64\）-> 永久加 PATH
const GCC_WIN32: string[] = [
  'winget install -e --id 7zip.7zip --accept-source-agreements --accept-package-agreements',
  `curl.exe -L -o "$env:TEMP\\mingw64.7z" "${GCC_7Z_URL}"`,
  '& "$env:ProgramFiles\\7-Zip\\7z.exe" x "$env:TEMP\\mingw64.7z" -o"C:\\" -y',
  'setx PATH "$env:PATH;C:\\mingw64\\bin"',
];

interface PlatformCommands {
  win32: string[];
  linux: string[];
}

const COMMANDS: Record<string, PlatformCommands> = {
  python: {
    win32: ['winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements'],
    linux: ['sudo apt-get install -y python3 python3-pip'],
  },
  scons: {
    win32: ['pip install scons'],
    linux: ['pip3 install scons'],
  },
  gcc: {
    win32: GCC_WIN32,
    linux: ['sudo apt-get install -y build-essential'],
  },
  sdl2: {
    win32: [], // Windows 已内置 lib/sim/SDL2-2.26.0-STATIC/
    linux: ['sudo apt-get install -y libsdl2-dev'],
  },
  ffmpeg: {
    win32: ['winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements'],
    linux: ['sudo apt-get install -y ffmpeg'],
  },
};

/** 返回指定工具在指定平台的安装命令序列；无映射/平台不适用返回 []。 */
export function getInstallCommands(toolId: string, platform: NodeJS.Platform): string[] {
  const entry = COMMANDS[toolId];
  if (!entry) {
    return [];
  }
  if (platform === 'win32') {
    return [...entry.win32];
  }
  if (platform === 'linux') {
    return [...entry.linux];
  }
  return [];
}

/** Windows 下安装 python/gcc 会改 PATH，需重启 VS Code 才能被检测到。 */
export function needsRestart(toolIds: string[], platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') {
    return false;
  }
  return toolIds.some((id) => id === 'python' || id === 'gcc');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --config jest.config.js src/test/jest/dependencyCommands.test.ts`
Expected: PASS（全部用例通过）。

- [ ] **Step 5: Commit**

```bash
git add src/simulation/dependencyCommands.ts src/test/jest/dependencyCommands.test.ts
git commit -m "feat: add dependency install command mapping (pure, tested)"
```

---

### Task 2: 终端安装封装 DependencyInstaller.ts

**Files:**
- Create: `src/simulation/DependencyInstaller.ts`

**Interfaces:**
- Consumes: `getInstallCommands`, `needsRestart` from `./dependencyCommands`.
- Produces:
  - `class DependencyInstaller` 带静态方法 `installInTerminal(toolIds: string[]): void`。
  - `DependencyInstaller.willNeedRestart(toolIds: string[]): boolean`（转调 `needsRestart(toolIds, process.platform)`）。

**说明：** 本文件是唯一 import vscode 的新文件，因此不放进 jest 套件（手动验证）。逻辑极薄：把命令逐条 `sendText` 进一个复用的终端。

- [ ] **Step 1: Write implementation**

```typescript
// src/simulation/DependencyInstaller.ts
import * as vscode from 'vscode';
import { getInstallCommands, needsRestart } from './dependencyCommands';

const TERMINAL_NAME = 'HoneyGUI 环境安装';

/**
 * 依赖安装器：把平台安装命令发送到 VS Code 集成终端执行。
 * 插件本身不发起网络请求；所有下载由终端命令完成（offline-first）。
 * 全部惰性触发——仅在用户点击安装命令时调用，无激活开销。
 */
export class DependencyInstaller {
    private static findOrCreateTerminal(): vscode.Terminal {
        const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
        return existing ?? vscode.window.createTerminal(TERMINAL_NAME);
    }

    /**
     * 将给定工具的安装命令逐条发送到终端。无可用命令的工具会被跳过。
     */
    static installInTerminal(toolIds: string[]): void {
        const commands: string[] = [];
        for (const id of toolIds) {
            commands.push(...getInstallCommands(id, process.platform));
        }
        if (commands.length === 0) {
            return;
        }
        const terminal = this.findOrCreateTerminal();
        terminal.show();
        for (const cmd of commands) {
            terminal.sendText(cmd, true);
        }
    }

    static willNeedRestart(toolIds: string[]): boolean {
        return needsRestart(toolIds, process.platform);
    }
}
```

- [ ] **Step 2: Compile to verify it builds**

Run: `npm run compile`
Expected: 编译通过，无 TS 错误。

- [ ] **Step 3: Commit**

```bash
git add src/simulation/DependencyInstaller.ts
git commit -m "feat: add DependencyInstaller terminal executor"
```

---

### Task 3: EnvironmentViewProvider 暴露可安装项 + contextValue

**Files:**
- Modify: `src/ui/EnvironmentViewProvider.ts`

**Interfaces:**
- Consumes: 现有 `this.checkResult`（`EnvironmentCheckResult`）。
- Produces:
  - `EnvironmentViewProvider.prototype.getMissingInstallableToolIds(): string[]` —— 返回当前未安装且有安装命令映射的 toolId 列表（含可选的 ffmpeg；Windows 下 sdl2 天然不出现）。
  - 每个未安装 `EnvironmentItem` 的 `contextValue = 'installable'`。

- [ ] **Step 1: 给 EnvironmentItem 增加 contextValue（未安装且有 toolId 时）**

在 `EnvironmentItem` 构造函数内，现有 `if (!installed && toolId) { this.command = {...} }` 块之后追加：

```typescript
        // 未安装项标记为可安装，供右键菜单「安装此项」使用
        if (!installed && toolId) {
            this.contextValue = 'installable';
        }
```

- [ ] **Step 2: 增加 getMissingInstallableToolIds 方法**

在 `EnvironmentViewProvider` 类内（`getChildren` 之后）新增：

```typescript
    /**
     * 返回当前未安装、且存在安装命令映射的工具 id 列表。
     * 供「一键安装缺失项」命令使用。
     */
    getMissingInstallableToolIds(): string[] {
        const r = this.checkResult;
        if (!r) {
            return [];
        }
        const ids: string[] = [];
        if (!r.pythonInstalled) { ids.push('python'); }
        if (!r.sconsInstalled) { ids.push('scons'); }
        if (!r.compilerInstalled) { ids.push('gcc'); }
        if (r.sdlInstalled === false) { ids.push('sdl2'); }
        if (!r.ffmpegInstalled) { ids.push('ffmpeg'); }
        return ids;
    }
```

- [ ] **Step 3: Compile**

Run: `npm run compile`
Expected: 编译通过。

- [ ] **Step 4: Commit**

```bash
git add src/ui/EnvironmentViewProvider.ts
git commit -m "feat: expose missing installable tool ids and contextValue"
```

---

### Task 4: 注册 installAll / installOne 命令

**Files:**
- Modify: `src/core/ExtensionManager.ts:569-588`（`registerViewProviders` 内，现有 `guideCommand` 注册之后）

**Interfaces:**
- Consumes: `envProvider`（局部变量，已存在于 `registerViewProviders`）、`DependencyInstaller`、`EnvironmentViewProvider.getMissingInstallableToolIds`。
- Produces: 命令 `honeygui.environment.installAll`、`honeygui.environment.installOne`。

**说明：** `DependencyInstaller` 用**动态 import** 引入，确保不进激活期静态依赖图、不影响启动。

- [ ] **Step 1: 在 registerViewProviders 内 guideCommand 注册之后插入命令**

在 `src/core/ExtensionManager.ts` 中 `guideCommand` 的 `this.context.subscriptions.push(guideCommand);` 之后插入：

```typescript
        // 安装缺失项的共享处理逻辑（惰性加载 DependencyInstaller，避免激活开销）
        const runInstall = async (toolIds: string[]) => {
            if (toolIds.length === 0) {
                vscode.window.showInformationMessage(
                    vscode.l10n.t('All dependencies are installed.')
                );
                return;
            }
            const { DependencyInstaller } = await import('../simulation/DependencyInstaller');
            DependencyInstaller.installInTerminal(toolIds);
            if (DependencyInstaller.willNeedRestart(toolIds)) {
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Installation started in terminal. Please restart VS Code after it completes, then re-check.')
                );
            } else {
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Installation started in terminal. Click refresh to re-check after it completes.')
                );
            }
        };

        // 一键安装所有缺失项
        const installAllCommand = vscode.commands.registerCommand('honeygui.environment.installAll', async () => {
            await runInstall(envProvider.getMissingInstallableToolIds());
        });
        this.disposables.push(installAllCommand);
        this.context.subscriptions.push(installAllCommand);

        // 安装单个工具（右键菜单，参数为 EnvironmentItem 或 toolId）
        const installOneCommand = vscode.commands.registerCommand('honeygui.environment.installOne', async (arg: unknown) => {
            const toolId = typeof arg === 'string' ? arg : (arg as { toolId?: string })?.toolId;
            if (toolId) {
                await runInstall([toolId]);
            }
        });
        this.disposables.push(installOneCommand);
        this.context.subscriptions.push(installOneCommand);
```

- [ ] **Step 2: Compile**

Run: `npm run compile`
Expected: 编译通过。

- [ ] **Step 3: Commit**

```bash
git add src/core/ExtensionManager.ts
git commit -m "feat: register installAll/installOne commands (lazy-loaded)"
```

---

### Task 5: package.json 贡献点 + 本地化

**Files:**
- Modify: `package.json`（`contributes.commands`、`contributes.menus.view/title`、`contributes.menus.view/item/context`）
- Modify: `package.nls.json`、`package.nls.zh-cn.json`

**Interfaces:**
- Consumes: 命令 id `honeygui.environment.installAll` / `honeygui.environment.installOne`（Task 4 已注册）。

- [ ] **Step 1: 在 contributes.commands 增加两条命令**

在 `package.json` 的 `contributes.commands` 数组中追加：

```json
      {
        "command": "honeygui.environment.installAll",
        "title": "%command.environment.installAll%",
        "category": "HoneyGUI",
        "icon": "$(cloud-download)"
      },
      {
        "command": "honeygui.environment.installOne",
        "title": "%command.environment.installOne%",
        "category": "HoneyGUI",
        "icon": "$(cloud-download)"
      }
```

- [ ] **Step 2: 在 menus.view/title 增加一键安装按钮**

在 `contributes.menus.view/title` 数组中（现有 refresh 之后）追加：

```json
        {
          "command": "honeygui.environment.installAll",
          "when": "view == honeygui.environment",
          "group": "navigation@0"
        }
```

- [ ] **Step 3: 增加 menus.view/item/context（若 menus 下无此键则新建该键）**

在 `contributes.menus` 对象中增加/追加：

```json
      "view/item/context": [
        {
          "command": "honeygui.environment.installOne",
          "when": "view == honeygui.environment && viewItem == installable",
          "group": "inline"
        }
      ]
```

- [ ] **Step 4: 补本地化字符串**

`package.nls.json` 增加：

```json
  "command.environment.installAll": "Install Missing Dependencies",
  "command.environment.installOne": "Install This Dependency"
```

`package.nls.zh-cn.json` 增加：

```json
  "command.environment.installAll": "安装缺失依赖",
  "command.environment.installOne": "安装此依赖"
```

- [ ] **Step 5: 校验 package.json 合法 + 编译**

Run: `node -e "require('./package.json')" && npm run compile`
Expected: 无 JSON 解析错误，编译通过。

- [ ] **Step 6: Commit**

```bash
git add package.json package.nls.json package.nls.zh-cn.json
git commit -m "feat: contribute install buttons in environment view"
```

---

### Task 6: 全量校验

**Files:** 无（验证任务）

- [ ] **Step 1: 全量单测**

Run: `npx jest --config jest.config.js src/test/jest/dependencyCommands.test.ts`
Expected: 全部 PASS。

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 无新增错误。

- [ ] **Step 3: 完整构建**

Run: `npm run compile && npm run build:webview`
Expected: 均成功。

- [ ] **Step 4: 手动验证清单（记录结果，不通过则回退对应任务）**

  - Linux：打开侧栏「环境检查」→ 标题栏出现「安装缺失依赖」按钮；未安装项 hover 出现 inline 安装图标。
  - 点「安装缺失依赖」→ 弹出名为「HoneyGUI 环境安装」的终端，逐条出现 apt-get/pip 命令；提示信息为「点刷新重新检测」（Linux 不提示重启）。
  - 全部已安装时点按钮 → 弹「All dependencies are installed.」。
  - 激活效率：确认新增代码未在 `initialize()` 路径引入 `DependencyInstaller` 的静态 import（应为动态 import）。
