/**
 * 渲染 hostUi 队列中的宿主交互：通知、模态消息、输入框、快速选择、进度、代码与日志查看
 */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as path from 'path';
import * as fs from '../shims/fs';
import {
    hostUi,
    HostUiRequest,
    ToastRequest,
    MessageDialogRequest,
    InputDialogRequest,
    QuickPickDialogRequest,
    ProgressRequest,
    CodeViewerRequest,
    LogViewerRequest,
} from '../host/hostUi';
import { getWorkspaceFolder } from '../host/webEnvironment';
import { t } from '../../webview/i18n';

const TOAST_TIMEOUT_MS = 6000;
const CODE_FILE_EXTENSIONS = new Set(['.c', '.h', '.txt', '.json', '.py', '.md', '.cmake', '.mk', '']);

function Toast({ request }: { request: ToastRequest }) {
    useEffect(() => {
        if (request.items.length > 0) {
            return;
        }
        const timer = setTimeout(() => hostUi.settle(request, undefined), request.severity === 'error' ? TOAST_TIMEOUT_MS * 2 : TOAST_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [request]);

    return (
        <div className={`web-toast web-toast-${request.severity}`} role={request.severity === 'error' ? 'alert' : 'status'}>
            <div className="web-toast-message">{request.message}</div>
            <div className="web-toast-actions">
                {request.items.map(item => (
                    <button key={item} className="web-button" onClick={() => hostUi.settle(request, item)}>{item}</button>
                ))}
                <button className="web-icon-button" aria-label={t('Close')} onClick={() => hostUi.settle(request, undefined)}>×</button>
            </div>
        </div>
    );
}

function Modal({ children, onCancel, wide }: { children: React.ReactNode; onCancel: () => void; wide?: boolean }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onCancel();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onCancel]);

    return (
        <div className="web-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
            <div className={`web-modal ${wide ? 'web-modal-wide' : ''}`} role="dialog" aria-modal="true">
                {children}
            </div>
        </div>
    );
}

function MessageDialog({ request }: { request: MessageDialogRequest }) {
    const cancel = () => hostUi.settle(request, undefined);
    return (
        <Modal onCancel={cancel}>
            <div className={`web-modal-body web-message-${request.severity}`}>
                <p className="web-message-text">{request.message}</p>
                {request.detail && <p className="web-message-detail">{request.detail}</p>}
            </div>
            <div className="web-modal-actions">
                {request.items.map((item, index) => (
                    <button key={item} className={`web-button ${index === 0 ? 'primary' : ''}`} autoFocus={index === 0} onClick={() => hostUi.settle(request, item)}>
                        {item}
                    </button>
                ))}
                <button className={`web-button ${request.items.length === 0 ? 'primary' : ''}`} autoFocus={request.items.length === 0} onClick={cancel}>
                    {request.items.length === 0 ? t('OK') : t('Cancel')}
                </button>
            </div>
        </Modal>
    );
}

function InputDialog({ request }: { request: InputDialogRequest }) {
    const [value, setValue] = useState(request.value || '');
    const [error, setError] = useState<string | undefined>();
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const input = inputRef.current;
        if (!input) {
            return;
        }
        input.focus();
        const [start, end] = request.valueSelection || [0, input.value.length];
        input.setSelectionRange(start, end);
    }, [request]);

    useEffect(() => {
        let cancelled = false;
        void Promise.resolve(request.validateInput?.(value)).then(result => {
            if (!cancelled) {
                setError(result || undefined);
            }
        });
        return () => { cancelled = true; };
    }, [request, value]);

    const accept = () => {
        if (!error) {
            hostUi.settle(request, value);
        }
    };
    const cancel = () => hostUi.settle(request, undefined);

    return (
        <Modal onCancel={cancel}>
            <div className="web-modal-body">
                {request.prompt && <label className="web-field-label" htmlFor="web-input-dialog">{request.prompt}</label>}
                <input
                    id="web-input-dialog"
                    ref={inputRef}
                    className="web-input"
                    value={value}
                    placeholder={request.placeHolder}
                    onChange={e => setValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') accept(); }}
                />
                {error && <div className="web-field-error">{error}</div>}
            </div>
            <div className="web-modal-actions">
                <button className="web-button primary" disabled={!!error} onClick={accept}>{t('OK')}</button>
                <button className="web-button" onClick={cancel}>{t('Cancel')}</button>
            </div>
        </Modal>
    );
}

function QuickPickDialog({ request }: { request: QuickPickDialogRequest }) {
    const [picked, setPicked] = useState<Set<number>>(() => new Set(
        request.items.map((item, index) => (item.picked ? index : -1)).filter(index => index >= 0)
    ));
    const cancel = () => hostUi.settle(request, undefined);

    const toggle = (index: number) => {
        if (!request.canPickMany) {
            hostUi.settle(request, [index]);
            return;
        }
        setPicked(current => {
            const next = new Set(current);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    };

    return (
        <Modal onCancel={cancel}>
            <div className="web-modal-body">
                {request.placeHolder && <p className="web-message-text">{request.placeHolder}</p>}
                <ul className="web-pick-list">
                    {request.items.map((item, index) => (
                        <li key={`${item.label}-${index}`}>
                            <button className="web-pick-item" onClick={() => toggle(index)}>
                                {request.canPickMany && <input type="checkbox" readOnly checked={picked.has(index)} tabIndex={-1} />}
                                <span className="web-pick-label">{item.label}</span>
                                {item.description && <span className="web-pick-description">{item.description}</span>}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
            <div className="web-modal-actions">
                {request.canPickMany && (
                    <button className="web-button primary" onClick={() => hostUi.settle(request, [...picked].sort((a, b) => a - b))}>{t('OK')}</button>
                )}
                <button className="web-button" onClick={cancel}>{t('Cancel')}</button>
            </div>
        </Modal>
    );
}

function ProgressBar({ request }: { request: ProgressRequest }) {
    return (
        <div className="web-progress" role="status">
            <div className="web-progress-bar" />
            <span>{request.title}{request.message ? ` — ${request.message}` : ''}</span>
        </div>
    );
}

function listCodeFiles(root: string): string[] {
    const srcDir = path.posix.join(root, 'src');
    if (!fs.existsSync(srcDir)) {
        return [];
    }
    return (fs.readdirSync(srcDir, { recursive: true }) as string[])
        .map(relative => path.posix.join(srcDir, relative))
        .filter(file => !fs.vfs.isDirectory(file) && CODE_FILE_EXTENSIONS.has(path.posix.extname(file).toLowerCase()))
        .sort();
}

function CodeViewer({ request }: { request: CodeViewerRequest }) {
    const root = getWorkspaceFolder() || '/';
    const files = useMemo(() => listCodeFiles(root), [root, request]);
    const [selected, setSelected] = useState(request.filePath || files[0]);
    const lineRef = useRef<HTMLDivElement>(null);
    const close = () => hostUi.settle(request);

    const content = useMemo(() => {
        if (!selected || !fs.existsSync(selected) || fs.vfs.isDirectory(selected)) {
            return undefined;
        }
        const bytes = fs.vfs.readBytes(selected);
        if (!bytes) {
            return undefined;
        }
        return bytes.includes(0) ? null : new TextDecoder().decode(bytes);
    }, [selected]);

    useEffect(() => {
        lineRef.current?.scrollIntoView({ block: 'center' });
    }, [content]);

    const highlightLine = selected === request.filePath ? request.line : undefined;

    return (
        <Modal onCancel={close} wide>
            <div className="web-modal-header">
                <span>{t('Generated Code')}</span>
                <button className="web-icon-button" aria-label={t('Close')} onClick={close}>×</button>
            </div>
            <div className="web-code-viewer">
                <ul className="web-code-files">
                    {files.length === 0 && <li className="web-muted">{t('No generated code yet. Save the design or click Generate Code.')}</li>}
                    {files.map(file => (
                        <li key={file}>
                            <button className={`web-code-file ${file === selected ? 'active' : ''}`} title={file} onClick={() => setSelected(file)}>
                                {path.posix.relative(path.posix.join(root, 'src'), file)}
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="web-code-content">
                    {content === null && <div className="web-muted">{t('Binary file')}</div>}
                    {typeof content === 'string' && content.split('\n').map((line, index) => (
                        <div key={index} ref={index === highlightLine ? lineRef : undefined} className={`web-code-line ${index === highlightLine ? 'highlight' : ''}`}>
                            <span className="web-code-line-number">{index + 1}</span>
                            <span className="web-code-line-text">{line || ' '}</span>
                        </div>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

function LogViewer({ request }: { request: LogViewerRequest }) {
    const lines = useMemo(() => hostUi.getLogLines(), [request]);
    const endRef = useRef<HTMLDivElement>(null);
    const close = () => hostUi.settle(request);

    useEffect(() => {
        endRef.current?.scrollIntoView();
    }, [lines]);

    return (
        <Modal onCancel={close} wide>
            <div className="web-modal-header">
                <span>{t('Output Log')}</span>
                <button className="web-icon-button" aria-label={t('Close')} onClick={close}>×</button>
            </div>
            <pre className="web-log">
                {lines.join('\n')}
                <div ref={endRef} />
            </pre>
        </Modal>
    );
}

function renderDialog(request: HostUiRequest): React.ReactNode {
    switch (request.kind) {
        case 'message': return <MessageDialog key={request.id} request={request} />;
        case 'input': return <InputDialog key={request.id} request={request} />;
        case 'quickPick': return <QuickPickDialog key={request.id} request={request} />;
        case 'codeViewer': return <CodeViewer key={request.id} request={request} />;
        case 'logViewer': return <LogViewer key={request.id} request={request} />;
        default: return null;
    }
}

export function HostOverlay() {
    const requests = useSyncExternalStore(hostUi.subscribe, hostUi.getSnapshot);
    const toasts = requests.filter((r): r is ToastRequest => r.kind === 'toast');
    const progress = requests.filter((r): r is ProgressRequest => r.kind === 'progress');
    // 模态请求按到达顺序逐个显示
    const dialog = requests.find(r => r.kind !== 'toast' && r.kind !== 'progress');

    return (
        <>
            {progress.map(request => <ProgressBar key={request.id} request={request} />)}
            <div className="web-toasts">
                {toasts.slice(-5).map(request => <Toast key={request.id} request={request} />)}
            </div>
            {dialog && renderDialog(dialog)}
        </>
    );
}
