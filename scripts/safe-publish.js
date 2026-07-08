#!/usr/bin/env node

/**
 * 安全发布：vsce publish 内部只会执行 package.json 的 vscode:prepublish 钩子
 * (compile + build:webview)，不会跑 check:deps 依赖审计，直接裸调 vsce publish
 * 有可能带着白名单残留的死依赖，或者缺了某个 require() 用到但没打包的模块发出去。
 * 这里补一层：先编译 + 构建 + 审计，全部通过才放行 vsce publish。
 *
 * 用法：
 *   node scripts/safe-publish.js -p <token>
 *   npm run publish:safe -- -p <token>
 */

const { spawnSync } = require('child_process');

function run(command) {
  console.log(`\n▶ ${command}`);
  const result = spawnSync(command, { stdio: 'inherit', shell: true });
  return result.status === null ? 1 : result.status;
}

function quoteArg(arg) {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

function main() {
  const steps = ['npm run compile', 'npm run build:webview', 'npm run check:deps'];
  for (const step of steps) {
    if (run(step) !== 0) {
      console.error(`\n❌ "${step}" 失败，已阻止发布。`);
      process.exit(1);
    }
  }

  const publishArgs = process.argv.slice(2).map(quoteArg).join(' ');
  console.log('\n✅ 依赖审计通过，开始发布...');
  process.exit(run(`npx vsce publish ${publishArgs}`.trim()));
}

main();
