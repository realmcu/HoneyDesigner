# HoneyGUI Design 发布指南

本指南面向维护者，说明 VS Code Marketplace 的实际发布流程。自动化规则以
[`.github/workflows/publish.yml`](.github/workflows/publish.yml) 为准，AI 协作约束见
[`AGENTS.md`](AGENTS.md)。

## 版本规则

- 版本格式为 `major.minor.patch`，Git tag 格式为 `vX.Y.Z`。
- patch 为偶数时发布正式版，例如 `2.2.2`。
- patch 为奇数时发布预览版，例如 `2.2.1`。
- 每次发布都必须递增 patch，并创建新的 tag；不要覆盖、移动或复用已发布 tag。
- tag、`package.json` 和 `package-lock.json` 的版本必须完全一致。
- 预览版用户不会自动升级到正式版；预览版之间可以自动升级。

## 发布前检查

1. 确认工作区干净，且 `master` 已同步到最新远端。
2. 根据最新 tag 决定下一个版本和发布通道。
3. 同步更新 `package.json` 与 `package-lock.json` 的版本。
4. 在 [`CHANGELOG.md`](CHANGELOG.md) 中增加同版本条目，按 Added、Changed、Fixed、Internal 等分类总结自上一 tag 以来的变更。
5. 确认 GitHub Actions 仓库 Secret `VSCE_PAT` 可用。不要把 PAT 写入仓库、日志或命令行参数。
6. 确认 `master` 上最新一次 `CI` workflow 成功。

本地质量门禁：

```bash
npm ci
npm run lint
npm test
npm run compile
npm run build:webview
npm run check:deps
```

## 发布正式版

```bash
# 示例：正式版 v2.2.2
git switch master
git pull --ff-only origin master

# 更新 package.json、package-lock.json 和 CHANGELOG.md 后执行
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: bump version to 2.2.2"
git push origin master
```

等待 `CI` 成功后创建并推送 tag：

```bash
git tag -a v2.2.2 -m "v2.2.2"
git push origin v2.2.2
```

## 发布预览版

流程与正式版相同，但版本 patch 必须为奇数，tag 说明注明 `preview`：

```bash
git commit -m "chore: bump version to 2.2.1 (preview)"
git tag -a v2.2.1 -m "v2.2.1 preview"
git push origin master
git push origin v2.2.1
```

发布通道由 workflow 根据 patch 奇偶自动决定。不要手动给 `vsce publish` 添加 `--pre-release`。

## 观察发布结果

推送 tag 会自动触发 `Publish VS Code extension`：

```bash
gh run list --workflow publish.yml --limit 5
gh run watch <run-id> --exit-status
```

发布 workflow 会依次执行版本一致性检查、lint、完整测试、TypeScript 编译、Webview 构建、依赖审计、VSIX 打包、制品上传和 Marketplace 发布。

发布完成后必须：

1. 确认 `Publish VS Code extension` workflow 成功。
2. 下载并保留 workflow 中的 VSIX artifact。
3. 确认 Marketplace 公共索引已经出现对应版本。
4. 确认预览版在 Marketplace 标记为 Pre-Release。

Marketplace 页面：
<https://marketplace.visualstudio.com/items?itemName=honeygui-visual-designer.honeygui-visual-designer>

## 手动重跑

只有 tag 已存在时才使用 `workflow_dispatch`。它用于重跑该 tag 的发布，不会创建新版本：

```bash
gh workflow run publish.yml --ref master -f tag=v2.2.1
```

## 本地兜底

正常发布必须走 tag 触发的 GitHub Actions。只有 Actions 不可用且维护者明确授权时，才允许本地发布：

```bash
# 在当前 shell 中安全设置 VSCE_PAT；不要写入文件、日志或命令参数。

# 正式版
npm run publish:safe

# 预览版
npm run publish:safe -- --pre-release
```

本地发布后仍必须核验 GitHub tag、VSIX 和 Marketplace 版本。

## 失败与回滚

- tag 与版本不一致时，修复版本文件后用新 tag 发布，不要移动旧 tag。
- 已推送到 Marketplace 的版本不可覆盖，修复后递增 patch 发布新版本。
- 发布 workflow 失败时先修复根因，再对同一 tag 使用 `workflow_dispatch` 重跑。
- 不要为了回滚而删除已发布 tag；保留发布记录并在下一 patch 修复。
