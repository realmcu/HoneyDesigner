# 移除协作开发功能

**日期**: 2026-06-10  
**状态**: 已确认，待实施

## 背景

HoneyGUI Visual Designer 扩展内含一套基于 WebSocket (`ws` 包) 的实时协作开发功能，允许多用户通过 Host/Guest 模式共同编辑 HML 文件。该功能目前未被使用，且在插件启动时无条件初始化（命令注册、状态监听、事件绑定），增加了不必要的启动开销和包体积。

## 目标

- 完全移除协作功能相关代码、UI 组件、npm 依赖与文档描述
- 不引入任何替代实现或"禁用开关"
- 保持所有非协作功能行为不变

## 删除范围

### 整体删除（7 个文件）

| 文件 | 说明 |
|------|------|
| `src/core/CollaborationService.ts` | WebSocket Host/Guest 服务 |
| `src/designer/CollaborationController.ts` | 协作消息路由控制器 |
| `src/webview/store/collaboration.ts` | 前端 Zustand 状态 slice |
| `src/webview/components/CollaborationModal.tsx` | 协作弹窗 |
| `src/webview/components/CollaborationModal.css` | 弹窗样式 |
| `src/webview/components/CollaborationPanel.tsx` | 协作悬浮面板 |
| `src/webview/components/CollaborationPanel.css` | 悬浮面板样式 |

### 外科手术清理（10 个文件）

**`src/extension.ts`**
- 删除 activation 时的 `pendingJoinSession` 状态读取与恢复逻辑（约 60 行）

**`src/core/CommandManager.ts`**
- 删除 `registerCollaborationCommands()` 方法（约 170 行）
- 删除 `registerCommands()` 中 `this.registerCollaborationCommands()` 调用
- 删除 `CollaborationService` import

**`src/designer/DesignerPanel.ts`**
- 删除 `_collaborationService`、`_collaborationController`、`_peerCountListener`、`_statusListener` 字段
- 删除构造函数中协作初始化块及事件监听（约 40 行）
- 删除 `setGuestWorkspacePath()` 公共方法
- 删除 `dispose()` 中协作 cleanup 代码
- 删除 `CollaborationService`、`CollaborationController` import

**`src/designer/MessageHandler.ts`**
- 删除 `_collaborationService`、`_collaborationController` 字段及初始化
- 删除构造函数中 `assetAdded` 事件监听里的协作广播逻辑
- 删除 `setCollaborationController()` 方法
- 删除 `handleMessage()` 中 `broadcastCommands` 广播分支
- 删除 `handleMessage()` 中 `collaborationStateChanged` 消息发送分支
- 删除 `save` 处理中 Guest 走 `REMOTE_UPDATE` 的分支
- 删除文件末尾 `// ============ Collaboration Methods ============` 区块
- 删除相关 import

**`src/designer/FileManager.ts`**
- 删除 `sendCollaborationUpdate()` 方法

**`src/services/ExtensionApiService.ts`**
- 删除协作相关 endpoint 注册条目（start-host、join、stop 共 3 项）

**`src/ui/StatusBarManager.ts`**
- 删除 `updateCollaborationStatus()` 方法

**`src/webview/store.ts`**
- 删除 `createCollaborationSlice` import
- 删除 Store 类型中协作字段声明（`collaborationRole`、`collaborationStatus`、`collaborationHostAddress`、`collaborationHostPort`、`collaborationPeerCount`、`collaborationError`、`setCollaborationState`、`resetCollaborationState`）
- 删除 `createStore` 中 `...createCollaborationSlice(...)` 展开

**`src/webview/App.tsx`**
- 删除 `CollaborationModal` import
- 删除 `showCollaborationPanel` state 及切换函数
- 删除 `collaborationStateChanged` message case
- 删除 `<CollaborationModal>` 渲染
- 删除传递给 Toolbar 的协作 props

**`src/webview/components/Toolbar.tsx`**
- 删除 `showCollaborationPanel`、`onToggleCollaboration` props 声明
- 删除协作按钮 JSX

### 配置与文档（5 处）

**`package.json`**
- 删除 `contributes.commands` 中 3 个协作命令（`startHost`、`joinSession`、`stop`）
- 删除 `contributes.menus` 中对应 3 个菜单项
- 删除 `dependencies.ws`
- 删除 `devDependencies.@types/ws`

**`src/webview/i18n/locales/zh-cn.ts`**
- 删除 `'Collaboration': '多人协作'` key

**`src/webview/i18n/locales/en.ts`**
- 删除 `Collaboration` key

**`docs/开发指南.md`**
- 删除目录中 `CollaborationService.ts` 行
- 删除说明中 `CollaborationService - 管理协同会话状态` 行
- 删除示例消息中协作命令示例行

**`CLAUDE.md`**
- 更新 Core Logic 说明，删除 `CollaborationService` 相关描述

## 依赖关系与安全性

- `FileManager.sendCollaborationUpdate()` 仅被 DesignerPanel 协作初始化 lambda 引用，协作初始化删除后调用链断裂，可安全删除
- `ws` 包仅在 `CollaborationService.ts` 中 import，文件整体删除后依赖可安全移除
- `StatusBarManager.updateCollaborationStatus()` 为空实现，调用方为 CommandManager（协作命令内），一并删除
- `pendingJoinSession` globalState key 在 extension.ts 激活时读取，删除读取逻辑后该 key 不再被写入（写入点在 CommandManager 协作命令内，也将删除）

## 不在范围内

- 不修改任何非协作功能逻辑
- 不引入新的功能或抽象
- 不保留任何协作接口签名供未来复用
