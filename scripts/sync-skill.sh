#!/bin/bash
# 把 honeygui-designer skill 目录同步到独立镜像仓库 realmcu/skills（main 分支），
# 供公司 AI Plugin Hub 按仓库根目录扫描。
#
# 机制：git subtree split/push —— 把该子目录的历史「投影」成一条独立历史推到镜像，
# 保留子目录的完整逐笔 commit（作者、时间、message 都在）。
# split 是确定性的：重复运行产出相同 SHA，因此对镜像是 fast-forward，不会改写历史。
#
# 代价：split 每次都要遍历主仓库全部历史（当前约 1200+ 笔），耗时若干十秒~分钟级；
# 因此本脚本设计为在 CI 里跑，让 CI 吸收这段时间，开发者不必等待。
#
# 用法：
#   bash scripts/sync-skill.sh
#
# 可选环境变量：
#   MIRROR_REMOTE  镜像仓库地址，默认 git@github.com:realmcu/skills.git
#   MIRROR_BRANCH  镜像分支，默认 main
set -euo pipefail

PREFIX="vibe-designer/skills/honeygui-designer"
MIRROR_REMOTE="${MIRROR_REMOTE:-git@github.com:realmcu/skills.git}"
MIRROR_BRANCH="${MIRROR_BRANCH:-main}"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [ ! -d "$ROOT/$PREFIX" ]; then
  echo "错误：找不到 $PREFIX" >&2
  exit 1
fi

# subtree split 需要完整历史；浅克隆(如 CI 默认 checkout)会不完整。
# CI 里请用 actions/checkout 的 fetch-depth: 0；这里再兜底补全一次。
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "==> 检测到浅克隆，补全完整历史"
  git fetch --unshallow
fi

echo "==> git subtree push（split 子目录历史并推送，可能耗时若干分钟）"
git subtree push --prefix="$PREFIX" "$MIRROR_REMOTE" "$MIRROR_BRANCH"
echo "==> 完成"
