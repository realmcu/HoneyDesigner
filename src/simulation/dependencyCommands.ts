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
