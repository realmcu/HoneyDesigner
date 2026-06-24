#!/usr/bin/env bash
# restart_reminder — 環節 4：commit 後重啟驗證提示
# 時機：PostToolUse[Bash]
# 行為：advisory
# 偵測 commit 成功且含 code 改動 → 提示重啟驗證生效

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")

# 只在 git commit 後提醒（PostToolUse 表示指令已執行）
if printf '%s' "$cmd" | grep -qE "git[[:space:]]+commit"; then
cat <<'EOF'
🔄 剛 commit 了 — 如果這次改的是「會被長駐 process 載入的 runtime code」
（server / daemon / 背景服務 / 被 import 的模組）：

  commit「成功」不代表 runtime 跑的是新 code——舊 process 還在跑舊版本。
  → 重啟對應服務 + tail log 30s，確認 0 啟動錯誤、改動真的生效。

純文檔 / 純測試 / 一次性 script → 忽略本提醒。
EOF
fi
exit 0
