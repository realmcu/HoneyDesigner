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
