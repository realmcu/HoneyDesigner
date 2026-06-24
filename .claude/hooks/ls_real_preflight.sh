#!/usr/bin/env bash
# ls_real_preflight — 環節 3：系統自述前查證
# 時機：UserPromptSubmit
# 行為：advisory
# 偵測「描述系統怎麼運作」→ 強制先看真實再開口

input=$(cat)
prompt=$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null || echo "")

# 觸發詞——改成你領域的字眼
TRIGGERS="怎麼運作|如何運作|這個(模組|系統|功能|檔案)|做什麼|是怎麼|how does|what does|how is|explain the|describe the|walk me through|這段(程式|code)在"

if printf '%s' "$prompt" | grep -qiE "$TRIGGERS"; then
cat <<'EOF'
🔎 系統自述偵測 — 描述前先看真實，別憑記憶或「設計上應該」：

1. ls 目標檔案真的存在嗎？最後修改是什麼時候？
2. grep 它的 caller——真的有人呼叫嗎？還是寫了沒接？
3. 能跑就跑一次，看真實輸出，不要描述你「以為」的行為
4. git log 看它最近改過什麼——你記憶中的版本可能已經過期

「設計意圖 ≠ 運行事實」「記憶會過期」是系統描述類幻覺的兩大來源。先驗再說。
EOF
fi
exit 0
