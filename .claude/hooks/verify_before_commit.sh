#!/usr/bin/env bash
# verify_before_commit — 環節 4：commit 前驗證
# 時機：PreToolUse[Bash]
# 行為：advisory（不 block commit，只提醒）
# 偵測 git commit → 提示真實驗證

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")

stripped=$(printf '%s' "$cmd" | sed -E "s/\"[^\"]*\"|'[^']*'//g")
if printf '%s' "$stripped" | grep -qE '(^|[;&|][[:space:]]*)git[[:space:]]+commit[[:space:]]'; then
cat <<'EOF'
✅ commit 偵測 — 送出前過一遍：

• 跑過 test 了嗎？（不是「讀起來對」，是真的綠）
• 改了會被載入的 runtime code？→ 記得 commit 後重啟 + 看 log 確認生效
• 一個 commit 只做一件事嗎？（混了多件 → 拆開，方便日後 rollback）
• commit message 提到的檔案/改動，真的在這次 staged 裡嗎？
  （git diff --cached --name-only 對一下，避免 message 跟內容對不上）

「import 成功」≠「runtime 正確」。VBC：Verify Before Commit。
EOF
fi
exit 0
