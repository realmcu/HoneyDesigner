#!/usr/bin/env bash
# asset_inventory_gate — 環節 3：動手前盤點（防造輪子）
# 時機：UserPromptSubmit
# 行為：advisory
# 偵測「建新東西」→ 強制先盤點現有資產

input=$(cat)
prompt=$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null || echo "")

# 觸發詞——改成你領域的字眼
TRIGGERS="建一個|新增|寫一個|做一個|建立|新建|create a|build a|add a new|write a new|implement a|新的 (script|module|hook|工具|功能)"

if printf '%s' "$prompt" | grep -qiE "$TRIGGERS"; then
cat <<'EOF'
🧰 建新東西偵測 — 動手前先盤點，多數「我需要新 X」其實是「我沒找到已有的 X」：

1. ls/glob 相關目錄，看有沒有同名/同功能的東西
2. grep 關鍵詞，看這個功能是不是已經有人實作過
3. 問：能不能「擴既有的」而不是「建新的」？
   能擴 → 擴它（少一份要維護的東西）
   真的沒有 → 再建，並在 commit 說明為什麼既有的不夠用

「先盤點再決定建不建」是減法紀律的第一道關。
EOF
fi
exit 0
