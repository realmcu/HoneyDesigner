/**
 * 网页版内置 AI 助手面板
 *
 * 闭环：用户描述 → 带上当前 HML / 资源 / 选中组件（可附画布截图）请求模型 →
 * 取回完整 HML → 本地校验，不通过则把错误回喂模型重试 → 写入工程并刷新画布 → 可一键撤销。
 * 生成期间用户又改了设计（docRevision 变化）时，应用前先确认，不静默覆盖。
 */
import React, { useEffect, useRef, useState } from 'react';
import * as path from 'path';
import { Sparkles, Settings, Send, Square, RotateCcw, Plus, X, Trash2 } from 'lucide-react';
import { useDesignerStore } from '../../webview/store';
import { t } from '../../webview/i18n';
import type { DesignerPanel } from '../../designer/DesignerPanel';
import * as fs from '../shims/fs';
import {
    AiSettings,
    AiProfiles,
    AiProviderKind,
    AiAuthHeader,
    ChatTurn,
    ChatImage,
    PROVIDER_DEFAULTS,
    newAiProfile,
    profileLabel,
    loadAiProfiles,
    saveAiProfiles,
    activeProfile,
    loadDeployProfiles,
    mergeDeployProfiles,
    isKeyRequired,
    isAiConfigured,
    describeAiError,
    testAiConnection,
    fetchAiModels,
    streamChat,
} from './aiProvider';
import {
    TargetEngine,
    buildSystemPrompt,
    buildContextMessage,
    extractHml,
    summarizeReply,
    validateGeneratedHml,
} from './aiContext';

/** 校验失败后让模型自行修正的最多轮数 */
const MAX_REPAIR_ROUNDS = 2;

interface AppliedEdit {
    filePath: string;
    before: string;
    after: string;
}

interface ChatEntry {
    id: number;
    role: 'user' | 'assistant';
    text: string;
    state?: 'streaming' | 'applied' | 'reverted' | 'invalid' | 'error' | 'stopped';
    note?: string;
    errors?: string[];
    edit?: AppliedEdit;
}

interface AiPanelProps {
    designer: DesignerPanel;
    projectRoot: string;
    onClose(): void;
}

let nextEntryId = 1;

const codeLabel = (lines: number) => `⟨${t('HML ({0} lines)', lines)}⟩`;

/** 写入 HML 并让设计器按新内容刷新（与导航写事务同一条路径：丢弃排队保存、复位脏状态） */
async function writeHml(designer: DesignerPanel, filePath: string, content: string): Promise<void> {
    fs.writeFileSync(filePath, content, 'utf8');
    await designer.reloadAfterNavEdit(content);
}

async function captureCanvas(): Promise<ChatImage | undefined> {
    const el = document.querySelector('.designer-canvas') as HTMLElement | null;
    if (!el) {
        return undefined;
    }
    try {
        const { captureDesignPng } = await import('../../webview/utils/captureDesign');
        const state = useDesignerStore.getState();
        const dataUrl = await captureDesignPng(el, state.components, state.selectedComponents, {
            zoom: state.zoom,
            offset: state.canvasOffset,
        });
        return { mediaType: 'image/png', base64: dataUrl.replace(/^data:image\/png;base64,/, '') };
    } catch (error) {
        console.warn('[ai] canvas capture failed', error);
        return undefined;
    }
}

const AUTH_OPTIONS: Array<{ value: AiAuthHeader; label: () => string }> = [
    { value: 'x-api-key', label: () => 'x-api-key' },
    { value: 'authorization', label: () => 'Authorization: Bearer' },
    { value: 'api-key', label: () => 'api-key (Azure)' },
    { value: 'none', label: () => t('None') },
];

type CheckStatus = { kind: 'busy' | 'ok' | 'error'; text: string };

function SettingsForm({ initial, onSave, onCancel }: { initial: AiProfiles; onSave(next: AiProfiles): void; onCancel?: () => void }) {
    const [form, setForm] = useState(() => {
        const profiles = initial.profiles.length > 0 ? initial.profiles : [newAiProfile()];
        return { profiles, editingId: (activeProfile(initial) ?? profiles[0]).id };
    });
    const [status, setStatus] = useState<CheckStatus>();
    const checkRef = useRef<AbortController | undefined>(undefined);
    const draft = form.profiles.find(profile => profile.id === form.editingId) ?? form.profiles[0];

    useEffect(() => () => checkRef.current?.abort(), []);

    const update = (patch: Partial<AiSettings>) => {
        setForm(current => ({ ...current, profiles: current.profiles.map(profile => profile.id === draft.id ? { ...profile, ...patch } : profile) }));
        setStatus(undefined);
    };

    const select = (id: string) => {
        checkRef.current?.abort();
        setForm(current => ({ ...current, editingId: id }));
        setStatus(undefined);
    };

    const add = () => {
        const profile = newAiProfile();
        checkRef.current?.abort();
        setForm(current => ({ profiles: [...current.profiles, profile], editingId: profile.id }));
        setStatus(undefined);
    };

    const remove = () => {
        const rest = form.profiles.filter(profile => profile.id !== draft.id);
        const profiles = rest.length > 0 ? rest : [newAiProfile()];
        setForm({ profiles, editingId: profiles[0].id });
        setStatus(undefined);
    };

    const switchProvider = (next: AiProviderKind) => {
        // 地址 / 模型 / 鉴权还是上一个服务商的默认值时，跟着切换
        const old = PROVIDER_DEFAULTS[draft.provider];
        update({
            provider: next,
            baseUrl: draft.baseUrl === old.baseUrl ? PROVIDER_DEFAULTS[next].baseUrl : draft.baseUrl,
            model: draft.model === old.model ? PROVIDER_DEFAULTS[next].model : draft.model,
            auth: draft.auth === old.auth ? PROVIDER_DEFAULTS[next].auth : draft.auth,
        });
    };

    const runCheck = async (action: (signal: AbortSignal) => Promise<string>) => {
        checkRef.current?.abort();
        const controller = new AbortController();
        checkRef.current = controller;
        setStatus({ kind: 'busy', text: t('Connecting...') });
        try {
            const text = await action(controller.signal);
            if (!controller.signal.aborted) {
                setStatus({ kind: 'ok', text });
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                setStatus({ kind: 'error', text: describeAiError(error) });
            }
        }
    };

    const loadModels = () => runCheck(async signal => {
        const models = await fetchAiModels(draft, signal);
        if (models.length === 0) {
            throw new Error(t('The service returned no models. Enter the model ID manually.'));
        }
        update({ models, model: draft.model.trim() ? draft.model : models[0] });
        return t('Found {0} models', models.length);
    });

    const test = () => runCheck(async signal => {
        await testAiConnection(draft, signal);
        return t('Connection OK');
    });

    const keyRequired = isKeyRequired(draft);
    const modelListId = `web-ai-models-${draft.id}`;

    return (
        <div className="web-ai-settings">
            <div className="web-ai-profile-row">
                <select className="web-input" value={draft.id} onChange={event => select(event.target.value)} aria-label={t('AI service')}>
                    {form.profiles.map(profile => <option key={profile.id} value={profile.id}>{profileLabel(profile)}</option>)}
                </select>
                <button className="web-icon-button" title={t('Add service')} onClick={add}><Plus size={14} /></button>
                <button className="web-icon-button" title={t('Delete service')} onClick={remove} disabled={draft.managed}><Trash2 size={14} /></button>
            </div>

            {draft.managed ? (
                <p className="web-muted web-ai-hint">{t('Provided by this site\'s configuration ({0}).', draft.baseUrl)}</p>
            ) : (
                <>
                    <label className="web-field">
                        <span className="web-field-label">{t('Name')}</span>
                        <input className="web-input" value={draft.name} onChange={event => update({ name: event.target.value })} placeholder={t('e.g. Company model')} />
                    </label>
                    <label className="web-field">
                        <span className="web-field-label">{t('Protocol')}</span>
                        <select className="web-input" value={draft.provider} onChange={event => switchProvider(event.target.value as AiProviderKind)}>
                            <option value="anthropic">Anthropic Messages</option>
                            <option value="openai">{t('OpenAI-compatible API')}</option>
                        </select>
                    </label>
                    <label className="web-field">
                        <span className="web-field-label">{t('Base URL')}</span>
                        <input className="web-input" value={draft.baseUrl} onChange={event => update({ baseUrl: event.target.value })} spellCheck={false} />
                    </label>
                    <label className="web-field">
                        <span className="web-field-label">{t('Authentication header')}</span>
                        <select className="web-input" value={draft.auth} onChange={event => update({ auth: event.target.value as AiAuthHeader })}>
                            {AUTH_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label()}</option>)}
                        </select>
                    </label>
                </>
            )}

            {draft.auth !== 'none' && (
                <label className="web-field">
                    <span className="web-field-label">{t('API Key')}</span>
                    <input
                        className="web-input"
                        type="password"
                        value={draft.apiKey}
                        onChange={event => update({ apiKey: event.target.value })}
                        placeholder={keyRequired ? undefined : t('Optional for local models')}
                        autoComplete="off"
                    />
                </label>
            )}

            <label className="web-field">
                <span className="web-field-label">{t('Model')}</span>
                <div className="web-ai-profile-row">
                    {draft.managed && draft.models.length > 0 ? (
                        <select className="web-input" value={draft.model} onChange={event => update({ model: event.target.value })}>
                            {!draft.models.includes(draft.model) && <option value={draft.model}>{draft.model}</option>}
                            {draft.models.map(model => <option key={model} value={model}>{model}</option>)}
                        </select>
                    ) : (
                        <>
                            <input className="web-input" value={draft.model} onChange={event => update({ model: event.target.value })} list={modelListId} spellCheck={false} />
                            <datalist id={modelListId}>{draft.models.map(model => <option key={model} value={model} />)}</datalist>
                        </>
                    )}
                    <button className="web-button" onClick={() => void loadModels()} disabled={!draft.baseUrl.trim() || status?.kind === 'busy'}>{t('Fetch list')}</button>
                </div>
            </label>

            {!draft.managed && (
                <label className="web-field">
                    <span className="web-field-label">{t('Extra headers')}</span>
                    <textarea
                        className="web-input web-ai-headers"
                        value={draft.extraHeaders}
                        onChange={event => update({ extraHeaders: event.target.value })}
                        placeholder={'X-Tenant: my-team'}
                        rows={2}
                        spellCheck={false}
                    />
                </label>
            )}

            {status && <p className={`web-ai-hint web-ai-status-${status.kind}`}>{status.text}</p>}
            <p className="web-muted web-ai-hint">
                {t('The key is stored only in this browser. Requests go directly from this page to the service. A service that does not accept cross-origin requests from this page must be forwarded through this site by the administrator.')}
            </p>
            <div className="web-ai-settings-actions">
                <button className="web-button" onClick={() => void test()} disabled={!isAiConfigured(draft) || status?.kind === 'busy'}>{t('Test connection')}</button>
                <span className="web-topbar-spacer" />
                {onCancel && <button className="web-button" onClick={onCancel}>{t('Cancel')}</button>}
                <button
                    className="web-button primary"
                    disabled={!isAiConfigured(draft)}
                    onClick={() => onSave({ activeId: draft.id, profiles: form.profiles })}
                >
                    {t('Save')}
                </button>
            </div>
        </div>
    );
}

export function AiPanel({ designer, projectRoot, onClose }: AiPanelProps) {
    const [profiles, setProfiles] = useState<AiProfiles>(() => loadAiProfiles());
    const settings = activeProfile(profiles);
    const [editingSettings, setEditingSettings] = useState(() => !isAiConfigured(activeProfile(loadAiProfiles())));
    /** 部署配置晚于设置表单到达时，让表单按新的服务列表重建 */
    const [formVersion, setFormVersion] = useState(0);
    const [entries, setEntries] = useState<ChatEntry[]>([]);
    const [input, setInput] = useState('');
    const [attachScreenshot, setAttachScreenshot] = useState(false);
    const [busy, setBusy] = useState(false);
    const abortRef = useRef<AbortController | undefined>(undefined);
    /** 发给模型的历史：只有需求与回复摘要，不含旧版 HML */
    const historyRef = useRef<ChatTurn[]>([]);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => () => abortRef.current?.abort(), []);

    // 站点部署配置里的预置服务（ai-config.json）：每次打开面板刷新一次
    useEffect(() => {
        let cancelled = false;
        void loadDeployProfiles().then(deployed => {
            if (cancelled || !deployed) {
                return;
            }
            const merged = mergeDeployProfiles(loadAiProfiles(), deployed);
            saveAiProfiles(merged);
            setProfiles(merged);
            setFormVersion(version => version + 1);
            if (!isAiConfigured(activeProfile(merged))) {
                setEditingSettings(true);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, [entries]);

    const patchEntry = (id: number, patch: Partial<ChatEntry>) => {
        setEntries(list => list.map(entry => entry.id === id ? { ...entry, ...patch } : entry));
    };

    const saveSettings = (next: AiProfiles) => {
        saveAiProfiles(next);
        setProfiles(next);
        setEditingSettings(false);
    };

    const switchProfile = (id: string) => {
        const next = { ...profiles, activeId: id };
        saveAiProfiles(next);
        setProfiles(next);
        if (!isAiConfigured(activeProfile(next))) {
            setEditingSettings(true);
        }
    };

    const newConversation = () => {
        abortRef.current?.abort();
        historyRef.current = [];
        setEntries([]);
    };

    const send = async () => {
        const request = input.trim();
        const filePath = designer.currentFilePath;
        if (!request || busy || !isAiConfigured(settings) || !filePath) {
            return;
        }
        setInput('');
        setBusy(true);
        const controller = new AbortController();
        abortRef.current = controller;

        const userEntry: ChatEntry = { id: nextEntryId++, role: 'user', text: request };
        const reply: ChatEntry = { id: nextEntryId++, role: 'assistant', text: '', state: 'streaming' };
        setEntries(list => [...list, userEntry, reply]);

        try {
            // 先把排队的自动保存写出去，模型看到的就是画布上的内容
            await designer.flushPendingSave();
            const before = fs.readFileSync(filePath, 'utf8') as string;
            const startRevision = useDesignerStore.getState().docRevision;
            const state = useDesignerStore.getState();
            const engine: TargetEngine = state.projectConfig?.targetEngine === 'lvgl' ? 'lvgl' : 'honeygui';
            const image = attachScreenshot ? await captureCanvas() : undefined;

            const system = buildSystemPrompt(engine);
            const contextMessage = buildContextMessage({
                projectRoot,
                filePath,
                hml: before,
                resolution: state.projectConfig?.resolution,
                engine,
                selectedIds: state.selectedComponents,
            }, request);
            const turns: ChatTurn[] = [...historyRef.current, { role: 'user', text: contextMessage, images: image ? [image] : undefined }];

            let text = '';
            let hml: string | undefined;
            let errors: string[] = [];
            for (let round = 0; ; round++) {
                const prefix = text;
                const full = await streamChat(settings, system, turns, delta => {
                    text += delta;
                    patchEntry(reply.id, { text });
                }, controller.signal);
                hml = extractHml(full);
                errors = hml ? validateGeneratedHml(hml, projectRoot, filePath) : [];
                if (!hml || errors.length === 0 || round >= MAX_REPAIR_ROUNDS) {
                    break;
                }
                // 校验未通过：把错误回喂给模型，要求返回修正后的完整文件
                turns.push({ role: 'assistant', text: full });
                turns.push({
                    role: 'user',
                    text: `The HML you returned failed validation:\n${errors.map(error => `- ${error}`).join('\n')}\n\nFix these problems and return the complete corrected file.`,
                });
                text = `${prefix}${full}\n\n${t('Validation failed, asking the model to fix it ({0}/{1})...', round + 1, MAX_REPAIR_ROUNDS)}\n\n`;
                patchEntry(reply.id, { text });
            }

            historyRef.current = [
                ...historyRef.current,
                { role: 'user', text: request },
                { role: 'assistant', text: summarizeReply(text, () => '[HML]') || '(no text)' },
            ];

            if (!hml) {
                patchEntry(reply.id, { state: undefined });
                return;
            }
            if (errors.length > 0) {
                patchEntry(reply.id, { state: 'invalid', errors });
                return;
            }
            if (designer.currentFilePath !== filePath) {
                patchEntry(reply.id, { state: 'error', note: t('The file was switched while the AI was working. The result was not applied.') });
                return;
            }
            if (useDesignerStore.getState().docRevision !== startRevision
                && !globalThis.confirm(t('The design changed while the AI was working. Overwrite your changes with the AI result?'))) {
                patchEntry(reply.id, { state: 'stopped', note: t('Not applied') });
                return;
            }
            await writeHml(designer, filePath, hml);
            const edit: AppliedEdit = { filePath, before, after: hml };
            patchEntry(reply.id, { state: 'applied', edit, note: t('Applied to {0}', path.posix.relative(projectRoot, filePath)) });
        } catch (error) {
            if (controller.signal.aborted) {
                patchEntry(reply.id, { state: 'stopped', note: t('Stopped') });
            } else {
                patchEntry(reply.id, { state: 'error', note: t('Request failed: {0}', describeAiError(error)) });
            }
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = undefined;
            }
            setBusy(false);
        }
    };

    const revert = async (entry: ChatEntry) => {
        const edit = entry.edit;
        if (!edit) {
            return;
        }
        if (designer.currentFilePath === edit.filePath) {
            await designer.flushPendingSave();
        }
        // 设计器的编辑都会自动写回文件，文件内容不再是 AI 写入的那份就说明之后又改过
        const current = fs.existsSync(edit.filePath) ? fs.readFileSync(edit.filePath, 'utf8') as string : undefined;
        const changedSince = current !== edit.after
            || (designer.currentFilePath === edit.filePath && useDesignerStore.getState().isDirty);
        if (changedSince && !globalThis.confirm(t('The design changed after this AI edit. Revert anyway? Changes made since then will be lost.'))) {
            return;
        }
        if (designer.currentFilePath === edit.filePath) {
            await writeHml(designer, edit.filePath, edit.before);
        } else {
            fs.writeFileSync(edit.filePath, edit.before, 'utf8');
        }
        patchEntry(entry.id, { state: 'reverted', note: t('Reverted') });
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
        }
    };

    return (
        <aside className="web-ai-panel">
            <div className="web-ai-header">
                <Sparkles size={14} />
                <span className="web-ai-title">{t('AI Assistant')}</span>
                <span className="web-topbar-spacer" />
                <button className="web-icon-button" title={t('New conversation')} onClick={newConversation} disabled={entries.length === 0}><Plus size={14} /></button>
                <button className="web-icon-button" title={t('AI Settings')} onClick={() => setEditingSettings(value => !value)}><Settings size={14} /></button>
                <button className="web-icon-button" title={t('Close')} onClick={onClose}><X size={14} /></button>
            </div>

            {editingSettings ? (
                <SettingsForm
                    key={formVersion}
                    initial={profiles}
                    onSave={saveSettings}
                    onCancel={isAiConfigured(settings) ? () => setEditingSettings(false) : undefined}
                />
            ) : (
                <>
                    <div className="web-ai-messages" ref={listRef}>
                        {entries.length === 0 && (
                            <p className="web-muted web-ai-hint">{t('Describe the change you want. The assistant edits the open HML file, validates it and applies it to the canvas.')}</p>
                        )}
                        {entries.map(entry => (
                            <div key={entry.id} className={`web-ai-message web-ai-${entry.role}`}>
                                <div className="web-ai-text">
                                    {entry.role === 'assistant' ? summarizeReply(entry.text, codeLabel) : entry.text}
                                    {entry.state === 'streaming' && !entry.text && <span className="web-muted">{t('Thinking...')}</span>}
                                </div>
                                {entry.errors && (
                                    <div className="web-ai-errors">
                                        <div>{t('The generated HML still fails validation and was not applied:')}</div>
                                        <ul>{entry.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>
                                    </div>
                                )}
                                {entry.note && <div className={`web-ai-note web-ai-note-${entry.state}`}>{entry.note}</div>}
                                {entry.state === 'applied' && entry.edit && (
                                    <button className="web-button web-ai-revert" onClick={() => void revert(entry)} disabled={busy}>
                                        <RotateCcw size={12} /> {t('Revert')}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="web-ai-composer">
                        <textarea
                            className="web-input web-ai-input"
                            value={input}
                            onChange={event => setInput(event.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder={t('Describe the change, e.g. "add a back button at the top left"')}
                            rows={3}
                        />
                        <div className="web-ai-composer-row">
                            {profiles.profiles.length > 1 && (
                                <select
                                    className="web-input web-ai-profile-select"
                                    value={settings?.id}
                                    onChange={event => switchProfile(event.target.value)}
                                    disabled={busy}
                                    title={settings ? `${profileLabel(settings)} · ${settings.model}` : undefined}
                                    aria-label={t('AI service')}
                                >
                                    {profiles.profiles.map(profile => <option key={profile.id} value={profile.id}>{profileLabel(profile)}</option>)}
                                </select>
                            )}
                            <label className="web-ai-check">
                                <input type="checkbox" checked={attachScreenshot} onChange={event => setAttachScreenshot(event.target.checked)} />
                                {t('Attach canvas screenshot')}
                            </label>
                            <span className="web-topbar-spacer" />
                            {busy ? (
                                <button className="web-button" onClick={() => abortRef.current?.abort()}><Square size={12} /> {t('Stop')}</button>
                            ) : (
                                <button className="web-button primary" onClick={() => void send()} disabled={!input.trim()}><Send size={12} /> {t('Send')}</button>
                            )}
                        </div>
                    </div>
                </>
            )}
        </aside>
    );
}
