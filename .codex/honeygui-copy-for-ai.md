# HoneyGUI 设计器「复制给 AI」文本包解读

粘贴进来的文本包（英文）约定：
- 首行 `# HoneyGUI Designer selection — file: ui/Xxx.hml`：要修改的 HML 文件。
- `Screenshot:` 下一行是 PNG 绝对路径，读它即可看到界面；红框=选中控件，标签=组件 id。
- `Pointed controls:` 每行 `id (type) parent=.. x=.. y=.. w=.. h=.. 关键属性`；id 唯一，直接在该 HML 中定位。
- 空选中时改为 `Full component tree:`，代表整屏请求。

改对应 `ui/*.hml`，保持 id 不变；改完用 `curl.exe -X POST http://localhost:38912/api/validate-hml -H "Content-Type: application/json" -d "{\"filePath\":\"ui/Xxx.hml\"}"` 验证。用户的具体指令在文本包之后给出。
