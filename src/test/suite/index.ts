import * as path from 'path';
import * as fs from 'fs';
import Mocha from 'mocha';

export function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', timeout: 180000 });
    const testsRoot = __dirname;

    return new Promise((resolve, reject) => {
        const performanceOnly = process.env.HONEYGUI_PERF_TEST === '1';
        const files = fs.readdirSync(testsRoot).filter(f =>
            f.endsWith('.test.js') && (!performanceOnly || f === 'performance.test.js')
        );
        files.forEach(f => mocha.addFile(path.join(testsRoot, f)));

        mocha.run(failures => {
            if (failures > 0) {
                reject(new Error(`${failures} test(s) failed.`));
            } else {
                resolve();
            }
        });
    });
}
