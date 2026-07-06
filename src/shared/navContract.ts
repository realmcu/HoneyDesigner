/**
 * 导航图 宿主 ↔ webview 消息契约（共享层 / Single Source of Truth）
 *
 * 这是导航写事务（applyNavEdit / navEditUndo / navEditResult）契约的唯一真相来源。
 * 宿主侧（src/designer/NavEditService.ts、MessageHandler.ts）与 webview 侧
 * （src/webview/types.ts、store.ts、ViewRelationModal.tsx）都从此文件导入/再导出，
 * 从此两端不再手抄字面量——命令/字段改名或漏字段，编译器立即报错（评审 I4/I5）。
 *
 * 约束：本文件仅含类型（无 vscode / node 依赖），可被扩展宿主与 webpack 打包的
 * webview 同时编译。运行时常量（提示 key、默认动画）留在 NavEditService 内。
 */

/** 编辑操作类型（retarget/delete/create 由 webview 发起；undo 走独立 navEditUndo 通道，回执 op 亦复用此集） */
export type NavEditOp = 'retarget' | 'delete' | 'create' | 'undo';

/** 稳定错误码（webview 侧映射 i18n 文案；新增码时 webview switch 会因缺 case 而暴露缺失翻译） */
export type NavEditErrorCode =
    | 'invalidRequest'
    | 'noProjectRoot'
    | 'fileNotFound'
    | 'fileDirty'
    | 'fileChanged'
    | 'timerEdgeReadonly'
    | 'locateFailed'
    | 'eventUnsupported'
    | 'eventOccupied'
    | 'writeFailed'
    | 'rollbackFailed';

/** round-trip 预检检测到的将丢失内容种类 */
export type NavEditConfirmReason = 'comments' | 'unknownTags' | 'nameAttributes';

/**
 * 边定位字段（retarget/delete 入参）——T2 边数据模型的定位子集全量。
 * sourceViewKey（relPath#viewId）是路径事实源；快照校验以 hash 为准，
 * hash 缺失时退化用 mtime。
 */
export interface NavEditEdgeLocator {
    sourceViewKey: string;
    sourceControlId: string;
    /** 原始事件类型（eventConfig.type；定时器边为 'timer'，一律拒绝编辑） */
    eventType: string;
    eventConfigIndex: number;
    actionIndex: number;
    /** 旧 target（定位一致性校验用） */
    target: string;
    sourceIsView?: boolean;
    sourceIsTimer?: boolean;
    sourceFileMtime?: number;
    sourceFileHash?: string;
}

/** 新建跳转入参（快照字段取自 ViewNavNode 的 fileMtime/fileHash） */
export interface NavEditCreateSpec {
    sourceViewKey: string;
    sourceControlId: string;
    eventType: string;
    /** 目标 view 裸 id */
    target: string;
    sourceFileMtime?: number;
    sourceFileHash?: string;
}

/** 服务入参（NavEditService.applyNavEdit）——扁平结构，op 决定哪些字段必填，由服务内部校验 */
export interface NavEditRequest {
    op: NavEditOp;
    /** retarget / delete 必填 */
    edge?: NavEditEdgeLocator;
    /** retarget 必填：新目标 view 裸 id */
    newTarget?: string;
    /** create 必填 */
    create?: NavEditCreateSpec;
    /** round-trip 预检差异经用户确认后重发时为 true */
    confirmed?: boolean;
}

/** 服务回执（NavEditService 返回；经 navEditResult 消息回推 webview） */
export interface NavEditResult {
    success: boolean;
    op?: NavEditOp;
    /** 需要用户确认规范化重写（webview 弹确认后带 confirmed=true 重发） */
    needsConfirm?: boolean;
    confirmReasons?: NavEditConfirmReason[];
    /** needsConfirm 补充信息（如未知标签名列表） */
    confirmDetail?: string;
    errorCode?: NavEditErrorCode;
    /** 错误补充信息（控件 id / 异常消息等，辅助定位） */
    errorDetail?: string;
    /** 目标文件无对应设计器面板：undo 不可用，请用 VS Code 文件历史撤销 */
    usedFileHistory?: boolean;
    /**
     * 写盘成功但面板重同步失败（评审 I1）：磁盘已是正确内容，但对应面板内存态
     * 仍停在旧内容，用户须手动关闭并重开该页面，否则在该面板下次保存会用旧态
     * 覆盖磁盘、丢失本次编辑。
     */
    panelResyncFailed?: boolean;
    /** 成功提示 key：代码将在下次代码生成时更新 */
    hintKey?: string;
    /** 当前可撤销的导航编辑条数（成功回执/撤销回执携带，webview 更新撤销按钮） */
    undoCount?: number;
}

// ---------------- 消息层（wire）----------------
// requestId 用于 webview 侧请求-回执匹配。

/**
 * applyNavEdit 请求体（不含 requestId）——判别联合：op 决定必填字段，
 * 从此无法构造「create 却带 edge」「retarget 缺 newTarget」等非法请求。
 * undo 不走此通道（webview 用独立 navEditUndo 命令），故此联合不含 'undo'。
 * 单列为「无 requestId」类型：`Omit` 不在联合上分配、会抹掉判别式，故用交叉而非 Omit 拼装 payload。
 */
export type NavEditRequestBody =
    | { op: 'retarget'; edge: NavEditEdgeLocator; newTarget: string; confirmed?: boolean }
    | { op: 'delete'; edge: NavEditEdgeLocator; confirmed?: boolean }
    | { op: 'create'; create: NavEditCreateSpec; confirmed?: boolean };

/** webview → 宿主 applyNavEdit 消息负载（请求体 + requestId 回执匹配键） */
export type NavEditRequestPayload = NavEditRequestBody & { requestId: string };

/**
 * 宿主 → webview navEditResult 回执 = 服务回执 + requestId（评审 I5：与服务端 NavEditResult
 * 单一联合脱钩问题的解法——回执类型直接派生自 NavEditResult，errorCode 不再退化为 string，
 * undoCount/panelResyncFailed 等字段无需手工同步）。
 */
export type NavEditResultMessage = NavEditResult & { requestId?: string };
