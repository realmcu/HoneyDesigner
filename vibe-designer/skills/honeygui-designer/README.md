# HoneyGUI Designer Skill

一个 [Claude Agent Skill](https://agentskills.io)，根据自然语言描述生成生产级的 HoneyGUI HML
（嵌入式设备 UI 描述语言）文件——设计智能手表、可穿戴设备、IoT 设备的界面。

## 这是什么

本 skill 是 [HoneyGUI Visual Designer](https://github.com/realmcu/honeygui-design)（一款嵌入式
GUI 可视化设计器 VS Code 扩展）的配套产物，随扩展一起分发到每个 HoneyGUI 项目的
`.claude/skills/honeygui-designer/`。这个仓库是它的独立镜像，方便在没有安装该扩展的场景下
单独获取、审查或提交到 skill 目录/市场。

**唯一真相源在主仓库**：`vibe-designer/skills/honeygui-designer/`。本仓库由
`git subtree split` 定期同步生成，请不要直接向本仓库提交改动——改动会在下次同步时被覆盖。
如需修改内容，请到 https://github.com/realmcu/honeygui-design 提交。

## 使用方式

把 `SKILL.md`、`references/`、`assets/` 放进任意支持 Agent Skills 的工具即可使用
（例如 Claude Code 的 `.claude/skills/honeygui-designer/`）。

⚠️ **单独使用的限制**：`SKILL.md` 中的 HML 结构校验步骤依赖
`POST http://localhost:38912/api/validate-hml` 这个本地 HTTP 服务，它由 HoneyGUI Visual
Designer 扩展启动。如果没有安装该扩展，这一步会连接失败——生成的 HML 文件仍然可用，但
跳过了结构校验，建议人工核对生成结果，或安装扩展后在实际项目里完成校验与仿真编译。

## License

MIT，见 [LICENSE](./LICENSE)。
