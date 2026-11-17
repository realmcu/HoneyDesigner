# AI 协作闭环（P0a）— 设计文档

日期：2026-11-16
状态：已定稿，待实现（P0a）；P0b 待立项

## 背景与问题

现状：AI（外部工具，经 [honeygui-designer skill](../../../vibe-designer/skills/honeygui-designer/SKILL.md)）只能生成 HML **文本**，再由用户手工导入。这带来四个已存在的具体缺陷：

1. **无闭环。** AI 看不到画布，也看不到自己改动后的渲染结果，只能盲改。
2. **静默覆盖。** AI 写 HML → 宿主重载 → 用户未保存的画布改动丢失。这是当前最严重的真实风险。
3. **"完成"可能是假的。** 扩展端保存有回执（[FileManager.ts:504-517](../../../src/designer/FileManager.ts#L504-L517)），网页端持久化是 400ms 去抖（[projectStore.ts:446](../../../src/web/host/projectStore.ts#L446)）。AI 若只等 store 更新就回执，必然出现"说好了但没写进存储"。
4. **分辨率存在两个互不一致的真相源。** 见下文 §6。这是与 AI 无关的既有缺陷。

目标不是"加一个聊天窗口"，而是让 AI 能完成：**表达需求 → AI 修改 → 查看结果 → 反馈调整 → 验证运行**。

## 产品原则

- AI 是主要生产入口，拖拽与属性面板保留为人工精修工具。
- HML 是唯一设计文档，不另建 AI 专用布局格式。
- 网页版与 VSCode 版共用协作语义；工程存储位置不影响 AI 读写。
- 不绑定单一模型，优先连接外部 AI 工具，设计器自身保持离线可用。
- 所有修改可确认、可撤销、有反馈，禁止静默覆盖人工修改。

## 目标与范围

### 交付拆分

| 项目 | 交付范围 | 独立验收 |
|------|----------|----------|
| **P0a：扩展版闭环** | 复用现有 HTTP 服务、校验、代码生成与仿真入口；新增认证、文档会话、候选编辑、截图回执 | 外部 AI 完成选区调整、确认应用、截图复核、撤销 |
| **P0b：网页桥接** | 浏览器会话配对、传输、断线恢复、IndexedDB 三段写入链的持久化回执 | AI 操作浏览器工程，无需导出到本地 |
| 后续阶段 | 页面生成、跨文件事务、样式/i18n 修改、仿真结果反馈 | 分别验收，不进入首版 |

P0a 不重建接入层，也不要求引入 MCP：[ExtensionApiService.ts:189](../../../src/services/ExtensionApiService.ts#L189) 已在 `127.0.0.1` 提供 HTTP 服务，`/api/validate-hml`、`/api/codegen`、`/api/simulation/*` 均已就绪，[http-api.md](../../../vibe-designer/skills/honeygui-designer/references/http-api.md) 已是面向 AI 的文档。P0b 不阻塞 P0a 交付。

### 首版能力边界

**只允许当前页面、现有组件的布局属性修改。** 按组件类型设置属性白名单。

禁止：新增/删除组件、改 ID、改层级、修改配置、样式、i18n、导航、用户代码。

因此首版**不能**演示"从自然语言生成设置页"——该场景在 P2。首版证明的是闭环能跑通、能回退。

### 明确不做（YAGNI）

- 不做内置聊天窗口、不接云端模型、不自动生成素材。
- 不做跨文档/长期回滚（撤销仅保证当前页面 `components` 恢复）。
- 不承诺跨进程重启的幂等（见 §3）。
- 不承诺视频、Lottie、3D 等动态内容的确定性截图。
- 不把认证当作抵御本机恶意进程的安全边界（见 §5）。

## 1. 术语：revision 的唯一含义

本文档中 `revision` **仅指设计内容版本**，与 [`StoredProject.sourceRevision`](../../../src/web/host/projectStore.ts#L32)（GitHub commit SHA）无关。

| 标识 | 含义 |
|------|------|
| `sessionId` | 文档会话。重开页面生成新会话，旧候选全部失效。 |
| `docRevision` | 当前有效内容的版本，单调递增。 |
| `persistedRevision` | 已完成持久化的版本。 |

## 2. 文档会话与版本规则

### 版本规则

- 人工编辑、撤销/重做、AI 事务应用、外部内容重载：**有效内容变化时**递增 `docRevision`。
- 宿主推送相同内容：不重复递增。前后端同步同一个编号，不各自计数。
- **保存成功：更新 `persistedRevision`，不递增 `docRevision`。**
- 保存回执绑定**实际写入的版本**；旧版本保存完成，不得把期间的新编辑标为已保存。

> 实证依据：[useHostMessages.ts:648-653](../../../src/webview/hooks/useHostMessages.ts#L648-L653) 中 `hmlSaved` 是空处理，注释明确写着"保存窗口内的新编辑已把 isDirty 置回 true……此时清零会让本地漏报后续 dirty"。这正是 `persistedRevision ≠ docRevision` 的现有证据。

### 版本递增收敛到唯一入口

新增统一内容提交函数 `commitDesignContent()`，由它完成**有效内容比较、版本更新、提交记录**。

- 人工编辑、撤销/重做、AI 事务、宿主加载均进入该函数。
- store 订阅（[store.ts:120](../../../src/webview/store.ts#L120)）只负责把普通编辑送入该入口，**不得自行维护另一套递增规则**。
- `suppressDirtyTracking`（[store.ts:101-114](../../../src/webview/store.ts#L101-L114)）**仅控制脏状态与历史行为，不能跳过内容版本跟踪**。
- 宿主加载中的临时清空、UI 状态恢复不算独立内容提交。

> **风险提示（最高）**：`store.ts:120` 的订阅同时管着撤销合并（`shouldStartHistoryStep`，[history.ts:61-73](../../../src/webview/store/history.ts#L61-L73)）。改动它会影响人工撤销，不只是 AI 功能。实施时先做不碰该订阅的部分（宿主回执、`persistedRevision` 状态），最后再改订阅。

### 上下文读取

必须返回一致的 `{ sessionId, docRevision, components }`。不得只读磁盘，不得依赖 `isDirty`——`isDirty` 只是布尔量（[store.ts:54](../../../src/webview/store.ts#L54)），无法表达版本。

## 3. propose / apply：候选 token

```
读取上下文 → proposeEdit → 返回候选 token 与变更摘要
                         ↓
                  用户确认 → applyEdit(token)
                         ↓
                  应用回执 → capturePreview(revision)
```

服务端持有候选副本、基础版本、所属会话、授权状态与过期时间。**`applyEdit` 不接受新的修改正文。**

状态机：`proposed → applying → applied`，另有 `expired` / `cancelled` / `conflict`。

- 应用时在**同一串行事务内**完成版本复核、状态转换与提交。不得校验后再异步放行写入。
- 重复应用已完成 token：返回原结果。正在应用：返回处理中。完成记录保留规定期限。
- 服务重启后旧会话失效。**幂等仅在服务进程内、执行记录保留期内成立。**

> token 与执行状态记录必须配对实现——只有 token 没有状态机，不构成幂等。

## 4. 候选校验

属性白名单只限制**修改范围**，不保证**布局正确**。同一批 `position` 调整就能把组件移出画布、视觉上打乱叠加顺序，或把宽高设成负值。

### 校验内容

- **属性类型与数值合法性**：拒绝非有限数、非法尺寸、超出组件类型约束的值。
- **绝对边界**：结合父容器计算，不能只检查组件自身 `x`/`y`。
- **越界拒绝**：首版拒绝造成越界的修改。滚动、裁剪等特殊容器没有明确规则时不开放 AI 编辑。
- **警告而非承诺**：遮挡、重叠列入变更警告与确认信息，**不宣称几何校验可判断视觉语义**。
- **硬校验失败时整个事务不应用。**

### 校验指纹

候选绑定校验所依赖的**配置版本或指纹**。提案后分辨率等约束发生变化，即使 `components` 未变，也必须重新提案。

### 事务与撤销

- 候选基于完整 `components` 副本构建，校验后一次应用。
- **每个 AI 事务强制独立历史步骤**，不与前后人工操作按 500ms 合并（[history.ts:13](../../../src/webview/store/history.ts#L13)）。
- 一次撤销只保证当前页面 `components` 恢复。仍受历史上限（`MAX_HISTORY = 50`）与切文件清空限制，**不宣称长期或跨文档回滚**。
- 现有 `store.ts:120` 订阅可复用，但必须增加**明确的事务边界**，不能直接连续调用若干组件更新函数。

## 5. 认证（P0a 门槛）

现状：[checkRequestSource](../../../src/services/ExtensionApiService.ts#L779-L789) 已拒绝带 `Origin` 的请求并校验 `Host`，但**没有会话认证**，任何本机进程都能读写工程。

### 新增机制

- 用户主动授权配对，发放短期高熵访问 token；**绑定允许的工程、页面与能力**，可撤销。
- 除最小健康检查外，**既有敏感接口也纳入认证**，避免旧接口绕过新权限。
- 扩展版保留 Origin 拒绝策略。P0b 单独设计精确 Origin 白名单，**不放宽为任意来源**。
- 新编辑接口使用服务端绑定的文档标识，**不接受任意写入路径**。
- 既有路径接口检查规范化路径、真实路径及符号链接/junction 逃逸。**不能用字符串前缀判定权限。**
- token 不放 URL、不进入日志。配对入口限制尝试次数；请求体限制大小（现有 `MAX_BODY_BYTES`，[ExtensionApiService.ts:792](../../../src/services/ExtensionApiService.ts#L792)）。

**边界声明**：这提供访问控制，**不承诺**抵御已取得用户凭据或调试权限的恶意本机进程。

## 6. 共享严格配置解析（新增第 6 项基础设施）

### 问题

| 侧 | 实现 | 缺省分辨率 |
|----|------|-----------|
| 扩展端 | [`ProjectUtils.parseResolution()`](../../../src/utils/ProjectUtils.ts#L199-L210) | **480×272** |
| webview | [`parseResolutionStr()`](../../../src/webview/store/utils.ts#L124-L131) | **800×480** |

两者对非法输入**均静默回退**：`split('X')` 只认大写 X，`parseInt` 失败即取默认值。

后果：同一工程在两侧得到不同画布尺寸；候选校验用不同边界校验同一份候选；**"非法值导致整批拒绝"在最关键的配置字段上根本不会触发**。

### 方案

提取**不依赖 `fs`** 的严格解析器为共享模块，两侧共用：

- 字段**缺失** → 使用唯一约定的默认值。
- 字段**存在但无法解析** → **报诊断并使候选失败**，不得回退。
- `ProjectUtils` 引入 `fs`/`path`/`os`（[ProjectUtils.ts:1-5](../../../src/utils/ProjectUtils.ts#L1-L5)），webview 不能直接引用，故解析器必须独立成模块。

## 7. 截图：版本绑定与就绪协调

`capturePreview` 由宿主转发，**实际截图仍在 Webview 执行** [`captureDesignPng`](../../../src/webview/utils/captureDesign.ts#L16)（html2canvas，扩展宿主做不了）。

### 版本绑定

- 请求携带会话、页面、目标 `docRevision` 与截图请求 ID。
- 截图前后检查版本；**期间发生编辑则拒绝结果**，不给旧图贴新版本。
- 回执携带相同版本及图片内容。页面关闭、超时、资源未就绪明确报错。

### 就绪协调器（新增）

现有 [`imageLoadTracker`](../../../src/webview/utils/imageLoadTracker.ts) **不能**直接作为截图保证：

- 模块级单例 `currentState`（[line 10](../../../src/webview/utils/imageLoadTracker.ts#L10)），一次只有一个跟踪上下文。
- 仅在带 `loadId` 的性能链路启用，预期集合只含部分 `hg_image`。
- 以组件 ID 回报完成，**未绑定资源版本**；未匹配跟踪状态时返回零项完成（[line 57-59](../../../src/webview/utils/imageLoadTracker.ts#L57-L59)）。
- 不覆盖字体、按钮图片、图片后处理及动态画布内容。

因此 P0a 新增**按会话、revision、资源身份绑定**的截图就绪协调器，复用现有图片/字体加载通知，但**不把性能探针当作截图保证**。

- 等待布局提交、所需资源与最终渲染完成。
- 失败、超时、不支持的渲染内容明确返回诊断。
- `waitForCanvas`（仿真画布）**不参与**设计画布就绪判定。
- `ImageWidget` 的 [`markImageReady`](../../../src/webview/components/widgets/ImageWidget.tsx#L4) 需同时通知两处，且**不改变**性能探针现有的"零项完成"语义。

## 8. 能力汇总服务

新增能力汇总点，由引擎、宿主、工具链与渲染适配器提供事实来源。**不从 `simulationFlow` 勾选状态推断支持能力**（那是用户选择，不是能力）。

返回信息区分四项：

| 字段 | 含义 |
|------|------|
| `supported` | 实现是否支持 |
| `available` | 当前工程与环境是否可运行 |
| `reason` | 不可用原因（固定枚举） |
| `selected` | 用户当前选择，**不能等同于能力** |

`reason` 建议固定枚举，避免三个宿主给出三种说辞：`engine-unsupported` / `toolchain-missing` / `web-host-limit`。

实例：网页版仿真仅支持 HoneyGUI，见 [simulationService.ts:133](../../../src/web/sim/simulationService.ts#L133)；扩展端还需汇总对应工具链状态。

## 9. P0b：网页版的存储事实

网页版**不是"无磁盘"**，而是两种模式并存（[`ProjectStorageMode`](../../../src/web/host/projectStore.ts#L14)）：

| 模式 | 写入目标 |
|------|----------|
| `browser` | IndexedDB（`files` store） |
| `directory` | `FileSystemDirectoryHandle`，真写磁盘 |

### 三段写入链（`browser` 模式）

1. **store** —— `components` 在内存，AI 事务应用到此，画布立刻更新。
2. **VFS** —— `flushPendingSave()` 把 store 序列化进内存文件系统。
3. **IndexedDB** —— `ProjectSync` 监听 `vfs.onChange`，**去抖 400ms** 后写入（[projectStore.ts:446](../../../src/web/host/projectStore.ts#L446)、[449-470](../../../src/web/host/projectStore.ts#L449-L470)）。

> "已应用""已序列化""已持久"是**三个**状态，方案其它部分只写了两个。

### 对方案的影响

- **`applyEdit` 必须能强制 flush**：网页版没有"用户按保存"这个动作。AI 应用路径要对受影响路径触发一次同步 `flush()`。回执区分 `applied` 与 `persisted`，`persisted` 只在 flush 成功后给出。
- **`ProjectSync` 不在设计器宿主手里**：它由 [Workbench.tsx:104-110](../../../src/web/ui/Workbench.tsx#L104-L110) 创建持有，设计器宿主只有 `vfs` + `flushPendingSave`。这是**新增接线点**，P0b 估时须包含。
- **失败是异步的、可能发生在回执之后**：`flushNow` 捕获错误、把路径塞回 dirty、置 `error`（[projectStore.ts:465-469](../../../src/web/host/projectStore.ts#L465-L469)）。配额超限、隐私模式、标签页关闭都会让"已应用未持久"真实发生。P0b 需要 IndexedDB 专属失败码：`quota-exceeded` / `write-aborted` / `persistence-pending`，**不复用** P0a 的文件系统失败码。
- **`persistedRevision` 定义为**"所有纳入本次事务的路径均已写入 IndexedDB 的那个 revision"，不是全局单调计数器（flush 按路径集合进行、可部分失败）。

### 网页版边界校验

- **目录 handle 边界**：独立实施，**不照抄 `fs.realpath` 方案**。只从已授权工程根 handle 出发；拒绝绝对路径、`.`、`..`、混合分隔符等非法路径段；不接受调用者提供的任意 handle。
- **IndexedDB 工程隔离**：`files` store 以 `entryKey(project.id, relPath)` 作键（[projectStore.ts:479](../../../src/web/host/projectStore.ts#L479)），**存储层天然按工程隔离**。要防的是把调用方传来的 `projectId` 当可信输入——校验点在 **API 入口**，不必改存储层。
- 两者**分别验收**，不统一写成"路径逃逸"。

### 现成基础

[`beforeunload`](../../../src/web/host/projectStore.ts#L427-L432) 已会在有未同步改动时拦截关闭，可作为"未保存布局读取"验收的基础。

## 新增基础设施汇总（P0a）

1. 认证会话
2. 统一内容版本提交（`commitDesignContent`）
3. 受限候选事务
4. 版本化截图就绪协调器
5. 能力汇总服务
6. 共享严格配置解析

## 验收

### P0a 必测项

| 场景 | 期望 |
|------|------|
| 未保存布局读取 | 返回内存内容与当前 `docRevision`，不读磁盘、不依赖 `isDirty` |
| 人工编辑冲突 | `applyEdit` 返回 `conflict`，不覆盖 |
| 重复/并发应用 token | 进程内幂等；并发返回处理中 |
| 截图期间编辑 | 截图被拒，不给旧图贴新版本 |
| 保存失败 | 分别报告 `applied` 与未 `persisted` |
| 撤销隔离 | AI 事务独立历史步骤，一次撤销恰好回退一个事务 |
| 旧会话失效 | 重开页面后旧 token 全部失效 |
| 未认证请求 | 除健康检查外一律拒绝 |
| 路径逃逸 | 规范化/真实路径/符号链接检查全部生效 |
| 宿主加载与人工编辑 | 不漏计、不重复计 `docRevision` |
| 旧 revision 保存回执 | 不把期间新编辑标为已保存 |
| 配置变化 | 使候选失效，要求重新提案 |
| 配置解析失败/分辨率异常 | 候选被拒（见 §6） |
| 非法值 | 整批拒绝，不留半完成布局 |
| 旧资源完成通知 | 不误判截图就绪 |

### 验收措辞

token 幂等明确写为：**服务进程内、执行记录保留期内幂等；进程重启后旧会话与 token 失效。**

### 指标

首次连接成功率、无需人工中转的任务完成率、请求到画布更新耗时、平均修正轮数、撤销恢复成功率。

## 实施顺序建议

按「收益 / 成本」排序：

1. `docRevision` + `applied`/`persisted` 分离 —— 最便宜，消除既有缺陷。先做不碰撤销热路径的部分。
2. P0a token 闭环 —— 唯一可演示成果，复用现有 HTTP API。
3. 认证 —— 在开放写接口**之前**，不是之后。
4. P0b —— 仅在网页版确有用户面时立项。

执行风险：六项基础设施全部排在第一个可见收益之前，空窗期长；`store.ts:120` 订阅改动回归风险最高（影响人工撤销）。
