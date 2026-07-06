import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import {
    runTests,
    downloadAndUnzipVSCode,
    resolveCliArgsFromVSCodeExecutablePath,
} from '@vscode/test-electron';

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Use TEST_WORKSPACE env var if set (e.g., cloned smartwatch template),
    // otherwise fall back to the minimal fixture
    const testWorkspace = process.env.TEST_WORKSPACE
        ? path.resolve(process.env.TEST_WORKSPACE)
        : path.resolve(extensionDevelopmentPath, 'src/test/fixtures/minimal-project');

    console.log(`Test workspace: ${testWorkspace}`);

    try {
        if (process.env.TEST_VSIX) {
            // 装包模式（nightly）：测「打包安装后的 .vsix」而非开发目录源码，
            // 从而覆盖 vsce package / .vscodeignore 过滤 / webview 产物落地这些
            // 开发模式测不到的环节。simulation.test.ts 里对 lib/sim、libgui.a、
            // lvgl-pc 的存在性断言此时正好在验证「这些资源有没有进包」。
            const vsixPath = path.resolve(process.env.TEST_VSIX);
            console.log(`Installed-package mode, VSIX: ${vsixPath}`);

            const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
            const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

            // 装进这份下载版 VSCode 自己的默认 extensions 目录；下面用同一个
            // vscodeExecutablePath 启动 runTests，即可读到刚装的扩展。
            const install = spawnSync(
                cli,
                [...cliArgs, '--install-extension', vsixPath, '--force'],
                { encoding: 'utf-8', stdio: 'inherit' }
            );
            if (install.status !== 0) {
                throw new Error(`Failed to install VSIX (exit code ${install.status})`);
            }

            // extensionDevelopmentPath 是 runTests 的必填项，但装包模式下被测扩展
            // 来自已安装的 vsix。若指向仓库根目录，源码扩展会与 vsix 同 id 冲突并
            // 遮蔽 vsix，反而测不到打包物。故指向一个不含 package.json 的空临时目录：
            // VSCode dev host 会忽略它，真正加载的只有刚装上的 vsix。
            const emptyDevPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-empty-ext-'));

            await runTests({
                vscodeExecutablePath,
                extensionDevelopmentPath: emptyDevPath,
                extensionTestsPath,
                // 注意：装包模式下不能加 --disable-extensions，否则刚装的扩展也会被禁用。
                launchArgs: [testWorkspace],
            });
        } else {
            // 开发模式（push / pull_request CI）：直接加载仓库 out/ 里的扩展。
            await runTests({
                extensionDevelopmentPath,
                extensionTestsPath,
                launchArgs: [
                    testWorkspace,
                    '--disable-extensions',
                ],
            });
        }
    } catch (err) {
        console.error('Failed to run tests:', err);
        process.exit(1);
    }
}

main();
