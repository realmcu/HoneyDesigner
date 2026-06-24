#!/usr/bin/env bash
# session_retro — 環節 6：收尾結晶
# 時機：UserPromptSubmit（偵測收尾字眼）
# 行為：advisory
# 偵測收工字眼 → 提示記錄這次學到什麼

input=$(cat)
prompt=$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null || echo "")

# 觸發詞——改成你習慣的收尾說法
TRIGGERS="收工|先這樣|今天到這|done for|wrap up|that's all|結束|/clear|告一段落|先告一|復盤|回顧|retro"

if printf '%s' "$prompt" | grep -qiE "$TRIGGERS"; then
cat <<'EOF'
📓 收尾偵測 — 花 60 秒固化這次的學習（不然下次又從零開始）：

1. 這次踩到/解決了什麼非顯而易見的問題？根因是什麼？
2. 有沒有一個「下次遇到同類情況的判準」可以寫下來？
3. 把它寫進一個固定的筆記檔（如 docs/lessons.md 或你的記憶系統），
   一行標題 + 為什麼 + 怎麼應用，未來的你/模型 session 開始能讀到。

「做了什麼」是事件，「下次怎麼做」是模式。累積模式 = 不必重學。
EOF
fi
exit 0
