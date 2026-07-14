#!/bin/bash
# 把 honeygui-designer skill 源目录同步到多 skill 集合仓库 realmcu/skills（main 分支）的
# skills/honeygui-designer/ 子目录，供公司 AI Plugin Hub / Claude Code 等按 skill 目录扫描。
# 镜像仓库结构对齐 https://github.com/anthropics/skills：根目录放 .claude-plugin/、template/、
# spec/，实际 skill 都嵌在 skills/<name>/ 下。
#
# 机制：子目录内容拷贝（不是 subtree/历史投影）。
#   1. 克隆镜像仓库；
#   2. 只清空并重写镜像里 skills/honeygui-designer/ 这一个子目录（其他人的 skill 目录一律不动）；
#   3. 若有变化，做一次 squash 提交，提交信息沿用源仓库最近改动该 skill 的 commit 标题，
#      正文标注来源 commit SHA；
#   4. 推送到镜像 main。
#
# 为什么不再用 git subtree push：
#   subtree push 会把子目录内容投影成镜像的「根」，即镜像根 = 单个 skill。这与多 skill 布局
#   （skill 要待在 skills/honeygui-designer/ 子目录、与其他人的 skill 并列）从机制上冲突——它会用
#   「只含本 skill 的树」替换整个镜像根，冲掉别人的 skill，且要求 fast-forward，别人一提交就断。
#   内容拷贝到子目录则天然只影响本 skill 目录，可与其他 skill 共存。
#   代价：不再逐笔投影历史，改为每次同步一笔 squash 提交 + 来源 SHA 标注（provenance）。
#
# 用法：
#   bash scripts/sync-skill.sh
#
# 可选环境变量：
#   MIRROR_REMOTE      镜像仓库地址，默认 git@github.com:realmcu/skills.git
#   MIRROR_BRANCH      镜像分支，默认 main
#   MIRROR_SKILLS_DIR  镜像仓库里存放各 skill 的子目录，默认 skills
#   SKILL_NAME          镜像里本 skill 的子目录名，默认 honeygui-designer
#   SOURCE_REPO         来源仓库（用于 provenance），默认 realmcu/honeygui-design
#   BOT_NAME            同步提交作者名，默认 skill-sync-bot
#   BOT_EMAIL           同步提交作者邮箱，默认 skill-sync-bot@users.noreply.github.com
set -euo pipefail

PREFIX="vibe-designer/skills/honeygui-designer"
SKILL_NAME="${SKILL_NAME:-honeygui-designer}"
MIRROR_REMOTE="${MIRROR_REMOTE:-git@github.com:realmcu/skills.git}"
MIRROR_BRANCH="${MIRROR_BRANCH:-main}"
MIRROR_SKILLS_DIR="${MIRROR_SKILLS_DIR:-skills}"
SOURCE_REPO="${SOURCE_REPO:-realmcu/honeygui-design}"
BOT_NAME="${BOT_NAME:-skill-sync-bot}"
BOT_EMAIL="${BOT_EMAIL:-skill-sync-bot@users.noreply.github.com}"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [ ! -d "$ROOT/$PREFIX" ]; then
  echo "错误：找不到源 skill 目录 $PREFIX" >&2
  exit 1
fi

# 取源仓库中最近一笔改动该 skill 的 commit，用作同步提交信息（标题）与 provenance（SHA）。
# 浅克隆下 git log 仍能给出 HEAD 侧最近一笔，够用；拿不到就退化为 HEAD。
SRC_SHA="$(git log -1 --format=%H -- "$PREFIX" 2>/dev/null || true)"
if [ -z "$SRC_SHA" ]; then
  SRC_SHA="$(git rev-parse HEAD)"
fi
SRC_SHORT="$(git rev-parse --short "$SRC_SHA")"
SRC_SUBJECT="$(git log -1 --format=%s "$SRC_SHA" 2>/dev/null || echo "sync honeygui-designer skill")"

WORKDIR="$(mktemp -d)"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

echo "==> 克隆镜像仓库 $MIRROR_REMOTE ($MIRROR_BRANCH)"
if ! git clone --depth 1 --branch "$MIRROR_BRANCH" "$MIRROR_REMOTE" "$WORKDIR/mirror" 2>/dev/null; then
  # 分支还不存在（空仓库或首次建分支）：克隆默认分支后再切
  git clone --depth 1 "$MIRROR_REMOTE" "$WORKDIR/mirror"
  git -C "$WORKDIR/mirror" checkout -B "$MIRROR_BRANCH"
fi

REL_DEST="$MIRROR_SKILLS_DIR/$SKILL_NAME"
DEST="$WORKDIR/mirror/$REL_DEST"

echo "==> 用源内容覆盖镜像子目录 $REL_DEST/（只动这一个目录，其他 skill 不受影响）"
rm -rf "$DEST"
mkdir -p "$DEST"
# 拷贝源目录内容（尾部 /. 表示连同隐藏文件一起拷贝目录内容本身，不含 .git）
cp -a "$ROOT/$PREFIX/." "$DEST/"

cd "$WORKDIR/mirror"
# 只 stage 这个 skill 子目录，绝不 git add -A 全仓库
git add -A -- "$REL_DEST"

if git diff --cached --quiet; then
  echo "==> 镜像子目录已是最新，无需提交"
  exit 0
fi

git config user.name "$BOT_NAME"
git config user.email "$BOT_EMAIL"

COMMIT_MSG="$SRC_SUBJECT"
COMMIT_BODY="Synced ${SKILL_NAME} from ${SOURCE_REPO}@${SRC_SHORT}

Source of truth: ${SOURCE_REPO} (${PREFIX}).
Do not edit ${REL_DEST}/ here directly; changes are overwritten on next sync."

echo "==> 提交并推送到镜像 $MIRROR_BRANCH"
git commit -m "$COMMIT_MSG" -m "$COMMIT_BODY"
git push origin "HEAD:$MIRROR_BRANCH"
echo "==> 完成"
