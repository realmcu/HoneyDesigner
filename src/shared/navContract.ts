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

// ---------------- 导航图边数据模型（updateAllViews 消息内 ViewInfo.edges）----------------
// 评审 I6：控件边（可编辑）与只读定时器边曾共用一个全可选宽 interface，靠运行时手工
// null 检查兜底、可表示非法态。改判别联合（kind）：control 携带齐全 locator（编译期保证
// 非空，可无兜底构造 NavEditEdgeLocator），timer 只读。宿主 FileManager 与 webview 共用此单一定义。

/**
 * 边公共字段（不区分 kind）。target/event 恒有；定位/快照字段由扫描器填充，
 * targetViewKey/targetAmbiguous/isValid 由第二遍全局解析回填，故均可选。
 */
interface ViewNavEdgeBase {
    /** 目标 view 裸 id */
    target: string;
    /** 事件类型（旧字段，向后兼容；定时器边为 'timer'） */
    event: string;
    switchOutStyle?: string;
    switchInStyle?: string;
    /** 稳定标识：由定位字段 hash 生成（跨扫描稳定） */
    edgeId?: string;
    /** 源文件绝对路径 */
    sourceFilePath?: string;
    /** 源文件相对项目根路径（正斜杠） */
    sourceFileRelative?: string;
    /** 源 view 复合键：relPath#viewId */
    sourceViewKey?: string;
    sourceControlId?: string;
    sourceControlName?: string;
    sourceControlType?: string;
    /** 边配置在 hg_view 自身（屏手势） */
    sourceIsView?: boolean;
    /** 原始事件类型（控件/view 边 = eventConfig.type；定时器边 = 'timer'） */
    eventType?: string;
    /** 控件/view 边：eventConfigs 下标；定时器边：data.timers 下标 */
    eventConfigIndex?: number;
    /** action 在所属 actions 数组中的下标 */
    actionIndex?: number;
    /** target 唯一解析出的目标复合键（撞名/无效时缺省，第二遍回填） */
    targetViewKey?: string;
    /** target 在多个文件的 view id 中撞名 */
    targetAmbiguous?: boolean;
    /** target 能解析到至少一个已知 view */
    isValid?: boolean;
    /** 扫描时源文件 mtime（ms，写事务快照校验用） */
    sourceFileMtime?: number;
    /** 扫描时源文件内容 hash（sha1，写事务快照校验用） */
    sourceFileHash?: string;
}

/**
 * 控件 / view 手势边：可编辑、可删除。定位字段（sourceControlId / eventType /
 * eventConfigIndex / actionIndex / sourceIsView）齐全——编译期保证非空，可无兜底
 * 构造 NavEditEdgeLocator。
 */
export interface ControlNavEdge extends ViewNavEdgeBase {
    kind: 'control';
    sourceIsTimer?: false;
    sourceControlId: string;
    sourceControlName: string;
    sourceControlType: string;
    sourceIsView: boolean;
    eventType: string;
    eventConfigIndex: number;
    actionIndex: number;
}

/** 定时器触发的边：只读（不可编辑 / 删除）。额外带 timerId / segmentIndex。 */
export interface TimerNavEdge extends ViewNavEdgeBase {
    kind: 'timer';
    sourceIsTimer: true;
    /** 定时器 id */
    timerId?: string;
    /** segment 下标（-1 = 旧版单段 actions） */
    segmentIndex?: number;
}

/**
 * 导航图边（判别联合）：control 可编辑、timer 只读。
 * 当前扫描器（FileManager._buildNavEdge）只产出这两类，故不含推测性的 legacy 变体。
 */
export type ViewNavEdge = ControlNavEdge | TimerNavEdge;
