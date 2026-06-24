#!/usr/bin/env bash
# self_challenge_gate — 環節 2：發言前自我質疑（scaffold 核心）
# 時機：UserPromptSubmit
# 行為：advisory（只注入提示，不 block）
# 偵測到深度任務 → 強制「初稿不是結論，跑 Round 1→2→3 驗證」

input=$(cat)
prompt=$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null || echo "")

# 觸發詞——改成你領域的字眼
TRIGGERS="分析|設計|重構|排查|審計|除錯|為什麼|怎麼|architect|refactor|analy|investigat|design|debug|why|how does|root cause|optimi"

if printf '%s' "$prompt" | grep -qiE "$TRIGGERS"; then
cat <<'EOF'
🔬 深度任務偵測 — 初稿不是結論，跑 3 輪再交付：

Round 1（草稿·不要直接輸出）：產出第一版分析，內心標記「未驗證」。
Round 2（驗證·強制 grep/read）：對每個關鍵 claim 實證——
  • 「X 沒有 caller / 沒人用」→ grep 隱式呼叫路徑，別只看顯式 import
  • 「Y 沒實作 / 是死碼」→ 讀 Y 的定義 + 找 caller + 查是否被排程/事件觸發
  • 「Z 失敗 / 壞了」→ 讀真實 log 原文，不推論
  • 任何「有 N 個 / 已經 / 應該」→ 先 count/ls 確認真實值
Round 3（框架質疑）：如果 Round 2 推翻了 Round 1 的前提，承認並重做，不要找補第 N 版。

禁止：Round 1 草稿直接當最終答案輸出。
EOF
fi
exit 0
