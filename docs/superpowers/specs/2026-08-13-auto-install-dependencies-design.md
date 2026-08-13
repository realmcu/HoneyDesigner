# 一键安装缺失依赖 — 设计文档

日期：2026-08-13
状态：已批准，待实现

## 背景与问题

新电脑安装本插件后，仿真/编译所需的外部工具（Python、SCons、GCC、FFmpeg，Linux 还需 SDL2）需要用户逐个手动安装，过程繁琐。现状：

- `src/simulation/EnvironmentChecker.ts` 已能检测各依赖是否安装。
- `src/ui/EnvironmentViewProvider.ts` 在侧栏展示每项状态，点击未安装项只弹出文本安装指引（复制命令 / 打开下载页）。

目标：在现有「环境检查」侧栏上增加**一键安装缺失依赖**能力。

## 目标与范围

用户**手动触发**安装。插件把对应平台的安装命令发送到 VS Code **集成终端**逐条执行，用户可见真实输出。安装完成后提示（必要时重启 VS Code）并重新检测刷新状态。

**offline-first 约束的处理**：自动安装被定位为用户主动点击的一次性环境就绪操作，**插件本身不发起网络请求**——所有下载由终端里的 `winget` / `curl` / `apt-get` 命令完成。日常设计/仿真仍全离线。

### 明确不做（YAGNI）

- 不做后台静默安装。
- 不做专用 Webview 安装向导。
- 插件不自己下载安装包（Windows GCC 的 .7z 由终端命令 `curl` 下载）。
- 不自动提权（sudo/UAC 由用户在终端应答）。

## 平台安装命令（最终）

| 工具 | Windows | Linux |
|------|---------|-------|
| Python | `winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements` | `sudo apt-get install -y python3 python3-pip` |
| SCons | `pip install scons` | `pip3 install scons` |
| GCC | 见下方 4 步序列 | `sudo apt-get install -y build-essential` |
| SDL2 | （Windows 已内置 `lib/sim/SDL2-2.26.0-STATIC/`，侧栏不显示此项） | `sudo apt-get install -y libsdl2-dev` |
| FFmpeg | `winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements` | `sudo apt-get install -y ffmpeg` |

### GCC（Windows）多步安装序列

在集成终端（PowerShell）依次执行：

```powershell
# 1. 确保有 7-Zip（winget 装，已有则跳过）
winget install -e --id 7zip.7zip --accept-source-agreements --accept-package-agreements
# 2. 下载 MinGW-w64 8.1.0 .7z（posix 线程 / sjlj 异常）
curl.exe -L -o "$env:TEMP\mingw64.7z" "https://sourceforge.net/projects/mingw-w64/files/Toolchains%20targetting%20Win64/Personal%20Builds/mingw-builds/8.1.0/threads-posix/sjlj/x86_64-8.1.0-release-posix-sjlj-rt_v6-rev0.7z/download"
# 3. 解压到 C:\（压缩包顶层目录为 mingw64\）
& "$env:ProgramFiles\7-Zip\7z.exe" x "$env:TEMP\mingw64.7z" -o"C:\" -y
# 4. 把 bin 永久加入用户 PATH
setx PATH "$env:PATH;C:\mingw64\bin"
```

- 解压目标固定为 `C:\mingw64`，与 `lib/sim/win32_sim/menu_config.py:19`（`EXEC_PATH = r'C:/mingw64/bin'`）一致。
- 装完提示：「GCC 已安装到 C:\mingw64，请重启 VS Code 后再检测」。

## 已知限制（务必在 UI 中提示用户）

1. **PATH 不立即生效**：winget 装完 Python / setx 改完 PATH 后，当前终端进程/VS Code 进程读取的 PATH 不会更新。检测能通过需要**重启 VS Code**（或至少新开终端）。安装完成后统一提示重启。
2. **winget 可用性**：Win10 1809+ 一般自带 winget；若不存在，终端命令会自然报错，输出对用户可见（不吞错）。
3. **.7z 解压依赖 7-Zip**：Windows 系统自带工具与 `tar` 均不支持 .7z，故先用 winget 装 7-Zip 再解压。

## 组件设计

### 新增 `src/simulation/DependencyInstaller.ts`

职责单一：把「工具 id → 平台安装命令」映射出来，并负责在终端执行。不涉及检测（检测归 `EnvironmentChecker`）。

```
DependencyInstaller
  static getInstallCommands(toolId: string, platform: NodeJS.Platform): string[]
    // 返回该工具在该平台的安装命令数组（GCC/Windows 返回多条；其余返回单条）
    // 无映射返回 []
  installInTerminal(toolIds: string[]): void
    // 复用或新建名为 "HoneyGUI 环境安装" 的集成终端，show()，逐条 sendText
  needsRestart(toolIds, platform): boolean
    // Windows 下含 python/gcc 时为 true，用于决定是否提示重启
  static readonly COMMANDS: Record<string, { win32: string[]; linux: string[] }>
```

设计要点：`getInstallCommands` 为纯函数，便于单测；`installInTerminal` 是唯一与 VS Code 终端 API 交互的地方。

### 修改 `src/ui/EnvironmentViewProvider.ts`

- 侧栏标题栏（package.json `view/title`）新增「一键安装缺失项」按钮 → 命令 `honeygui.environment.installAll`。
- 未安装项通过 `contextValue`（如 `installable`）在右键菜单（`view/item/context`）暴露「安装此项」→ 命令 `honeygui.environment.installOne`（参数为 toolId）。
- 保留现有 `showGuide`（文本指引）作为无命令映射时的回退。
- 提供方法暴露「当前未安装且可安装的 toolId 列表」，供 installAll 使用（SDL2 仅 Linux、FFmpeg 视为可选但也可安装）。

### 修改 `src/core/ExtensionManager.ts`

在 `registerViewProviders()` 中，与现有 `refresh` / `showGuide` 并列注册：

- `honeygui.environment.installAll`：取未安装项 → `DependencyInstaller.installInTerminal()` → 若 `needsRestart` 提示重启，否则提示装完可点刷新 → `envProvider.refresh()`。
- `honeygui.environment.installOne`：单项同上。

### 修改 `package.json`

- `commands` 增加两个命令（`installAll` / `installOne`，`category: HoneyGUI`）。
- `menus.view/title` 增加 `installAll`（`when: view == honeygui.environment`，带图标如 `$(cloud-download)`）。
- `menus.view/item/context` 增加 `installOne`（`when: view == honeygui.environment && viewItem == installable`）。
- 命令标题走 `%command.xxx%` 本地化键，补 `package.nls.json` / `package.nls.zh-cn.json`（若项目采用此机制，实现时对齐现有做法）。

## 数据流

```
用户点击「一键安装缺失项」/「安装此项」
  -> 命令 handler 从 EnvironmentViewProvider.checkResult 取未安装 toolId 列表
  -> DependencyInstaller.getInstallCommands(toolId, process.platform)
  -> installInTerminal(): 复用/新建终端, show(), 逐条 sendText
  -> 用户在终端观察输出（含 sudo/UAC 应答）
  -> 提示重启 VS Code 或点刷新
  -> envProvider.refresh() -> EnvironmentChecker.checkAll() -> 更新侧栏状态
```

## 错误处理

- `getInstallCommands` 返回 `[]`（无映射）时，回退到现有 `showInstallGuide` 文本指引。
- 命令执行失败（如 winget 不存在、下载失败、sudo 拒绝）由终端原样显示，不捕获、不吞错。
- 不阻塞：安装在终端异步进行，插件不等待其完成。

## i18n

- 所有新增用户可见文案（按钮标题、提示、重启提醒）：扩展宿主侧用 `vscode.l10n.t()`，并补齐两个 locale。
- 命令映射中的 shell 命令本身不翻译。

## 测试

- 单测：`DependencyInstaller.getInstallCommands()` 覆盖每个 toolId × {win32, linux}，断言命令数组内容（GCC/win32 为 4 条、含正确的 .7z URL 与 `C:\mingw64` 目标）。
- 手动验证：终端交互、侧栏按钮、右键菜单、装完刷新与重启提示（在真实 Windows/Linux 环境）。

## 涉及文件

- 新增：`src/simulation/DependencyInstaller.ts`、对应单测。
- 修改：`src/ui/EnvironmentViewProvider.ts`、`src/core/ExtensionManager.ts`、`package.json`、locale 文件。
