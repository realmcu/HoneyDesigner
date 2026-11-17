/**
 * 网页版 AI 助手的模型接口
 *
 * 浏览器直接调用配置的模型服务，两种协议：
 * - anthropic：Anthropic Messages API
 * - openai：OpenAI Chat Completions 兼容接口（OpenAI、DeepSeek、通义、Ollama、LM Studio 等）
 *
 * 连接配置可以有多套，来源有两种：
 * - 用户在面板里自己添加的；
 * - 部署方放在站点根目录的 ai-config.json（managed）：地址、协议、鉴权由管理员决定，
 *   用户只填 Key、选模型。企业内网模型通常不允许浏览器跨域，管理员在 Web 服务器上把
 *   同源路径（如 /ai/xxx）转发到内部服务，配置里的 baseUrl 写这个同源路径即可。
 * 配置（含 API Key）只保存在本浏览器的 localStorage。
 */
import { t } from '../../webview/i18n';

export type AiProviderKind = 'anthropic' | 'openai';

/** API Key 放在哪个请求头：x-api-key（Anthropic）、Authorization: Bearer、api-key（Azure），或不发送 */
export type AiAuthHeader = 'x-api-key' | 'authorization' | 'api-key' | 'none';

export interface AiSettings {
    id: string;
    name: string;
    provider: AiProviderKind;
    baseUrl: string;
    apiKey: string;
    model: string;
    auth: AiAuthHeader;
    /** 附加请求头，每行一个 `Name: value` */
    extraHeaders: string;
    /** 带上本站点的 Cookie（网关用 SSO 会话鉴权时） */
    credentials?: boolean;
    /** 可选模型：部署配置给出，或从服务端拉取 */
    models: string[];
    /** 来自部署配置 ai-config.json */
    managed?: boolean;
    /** 部署配置声明是否必须填 Key（默认鉴权方式不是 none 时必填） */
    keyRequired?: boolean;
}

export interface AiProfiles {
    activeId?: string;
    profiles: AiSettings[];
}

export type ChatImageType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ChatImage {
    mediaType: ChatImageType;
    base64: string;
}

export interface ChatTurn {
    role: 'user' | 'assistant';
    text: string;
    images?: ChatImage[];
}

const PROFILES_KEY = 'honeygui.web.ai.profiles';
/** 只有单套配置时的旧存储，读取时迁移 */
const LEGACY_SETTINGS_KEY = 'honeygui.web.ai.settings';
const DEPLOY_CONFIG_FILE = 'ai-config.json';
const MANAGED_ID_PREFIX = 'deploy:';

/** 回复上限：整份 HML 文件可能较长 */
const MAX_OUTPUT_TOKENS = 16000;

export const PROVIDER_DEFAULTS: Record<AiProviderKind, { baseUrl: string; model: string; auth: AiAuthHeader }> = {
    anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', auth: 'x-api-key' },
    openai: { baseUrl: 'https://api.openai.com/v1', model: '', auth: 'authorization' },
};

const AUTH_HEADERS: AiAuthHeader[] = ['x-api-key', 'authorization', 'api-key', 'none'];

function isProvider(value: unknown): value is AiProviderKind {
    return value === 'anthropic' || value === 'openai';
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

export function newAiProfile(): AiSettings {
    return {
        id: `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: '',
        provider: 'anthropic',
        ...PROVIDER_DEFAULTS.anthropic,
        apiKey: '',
        extraHeaders: '',
        models: [],
    };
}

export function profileLabel(settings: AiSettings): string {
    return settings.name.trim() || settings.baseUrl.trim() || t('Unnamed service');
}

function normalizeProfile(raw: unknown): AiSettings | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const value = raw as Record<string, unknown>;
    if (!isProvider(value.provider)) {
        return undefined;
    }
    const defaults = PROVIDER_DEFAULTS[value.provider];
    const text = (field: unknown, fallback: string) => typeof field === 'string' ? field : fallback;
    return {
        id: text(value.id, newAiProfile().id),
        name: text(value.name, ''),
        provider: value.provider,
        baseUrl: text(value.baseUrl, defaults.baseUrl),
        apiKey: text(value.apiKey, ''),
        model: text(value.model, defaults.model),
        auth: AUTH_HEADERS.includes(value.auth as AiAuthHeader) ? value.auth as AiAuthHeader : defaults.auth,
        extraHeaders: text(value.extraHeaders, ''),
        credentials: value.credentials === true || undefined,
        models: stringList(value.models),
        managed: value.managed === true || undefined,
        keyRequired: typeof value.keyRequired === 'boolean' ? value.keyRequired : undefined,
    };
}

export function loadAiProfiles(): AiProfiles {
    try {
        const raw = globalThis.localStorage.getItem(PROFILES_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as { activeId?: unknown; profiles?: unknown };
            const profiles = (Array.isArray(parsed.profiles) ? parsed.profiles : [])
                .map(normalizeProfile)
                .filter((profile): profile is AiSettings => !!profile);
            return { activeId: typeof parsed.activeId === 'string' ? parsed.activeId : undefined, profiles };
        }
        const legacy = normalizeProfile({ ...JSON.parse(globalThis.localStorage.getItem(LEGACY_SETTINGS_KEY) || 'null'), id: 'custom-default' });
        return legacy ? { activeId: legacy.id, profiles: [legacy] } : { profiles: [] };
    } catch {
        return { profiles: [] };
    }
}

export function saveAiProfiles(state: AiProfiles): void {
    try {
        globalThis.localStorage.setItem(PROFILES_KEY, JSON.stringify(state));
        globalThis.localStorage.removeItem(LEGACY_SETTINGS_KEY);
    } catch {
        // 存储配额不足时只影响下次打开是否要重新填写
    }
}

export function activeProfile(state: AiProfiles): AiSettings | undefined {
    return state.profiles.find(profile => profile.id === state.activeId) ?? state.profiles[0];
}

/**
 * 读取部署配置。文件不存在返回空配置（部署方撤掉了全部预置服务）；
 * 网络失败（离线等）返回 undefined，此时保留上次的预置服务不动。
 */
export async function loadDeployProfiles(): Promise<{ defaultId?: string; profiles: AiSettings[] } | undefined> {
    let response: Response;
    try {
        response = await fetch(new URL(DEPLOY_CONFIG_FILE, document.baseURI).toString(), { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    } catch {
        return undefined;
    }
    if (!response.ok) {
        return response.status === 404 ? { profiles: [] } : undefined;
    }
    try {
        const config = await response.json() as { default?: unknown; profiles?: unknown };
        const profiles: AiSettings[] = [];
        for (const raw of Array.isArray(config.profiles) ? config.profiles : []) {
            const item = raw as Record<string, unknown>;
            if (!item || typeof item.id !== 'string' || typeof item.baseUrl !== 'string' || !isProvider(item.provider)) {
                console.warn('[ai] ignoring invalid profile in ai-config.json', raw);
                continue;
            }
            const auth = AUTH_HEADERS.includes(item.auth as AiAuthHeader) ? item.auth as AiAuthHeader : PROVIDER_DEFAULTS[item.provider].auth;
            const headers = item.headers && typeof item.headers === 'object' ? item.headers as Record<string, unknown> : {};
            const models = stringList(item.models);
            profiles.push({
                id: `${MANAGED_ID_PREFIX}${item.id}`,
                name: typeof item.name === 'string' ? item.name : item.id,
                provider: item.provider,
                baseUrl: item.baseUrl,
                apiKey: '',
                model: typeof item.model === 'string' ? item.model : models[0] ?? '',
                auth,
                extraHeaders: Object.entries(headers)
                    .filter(([, value]) => typeof value === 'string')
                    .map(([name, value]) => `${name}: ${value as string}`)
                    .join('\n'),
                models,
                credentials: item.credentials === true ? true : undefined,
                managed: true,
                keyRequired: typeof item.keyRequired === 'boolean' ? item.keyRequired : auth !== 'none',
            });
        }
        return { defaultId: typeof config.default === 'string' ? `${MANAGED_ID_PREFIX}${config.default}` : undefined, profiles };
    } catch (error) {
        console.warn('[ai] failed to parse ai-config.json', error);
        return undefined;
    }
}

/** 用部署配置刷新预置服务：连接参数以部署配置为准，保留用户填的 Key 和选的模型 */
export function mergeDeployProfiles(state: AiProfiles, deployed: { defaultId?: string; profiles: AiSettings[] }): AiProfiles {
    const previous = new Map(state.profiles.filter(profile => profile.managed).map(profile => [profile.id, profile]));
    const managed = deployed.profiles.map(profile => {
        const old = previous.get(profile.id);
        if (!old) {
            return profile;
        }
        const keepModel = old.model.trim() && (profile.models.length === 0 || profile.models.includes(old.model));
        return { ...profile, apiKey: old.apiKey, model: keepModel ? old.model : profile.model };
    });
    const profiles = [...managed, ...state.profiles.filter(profile => !profile.managed)];
    const activeId = state.activeId && profiles.some(profile => profile.id === state.activeId)
        ? state.activeId
        : deployed.defaultId && profiles.some(profile => profile.id === deployed.defaultId) ? deployed.defaultId : profiles[0]?.id;
    return { activeId, profiles };
}

export function isKeyRequired(settings: AiSettings): boolean {
    if (settings.auth === 'none') {
        return false;
    }
    // 自定义的 OpenAI 兼容服务可能是不要 Key 的本地模型（Ollama 等）
    return settings.managed ? settings.keyRequired !== false : settings.provider === 'anthropic';
}

export function isAiConfigured(settings: AiSettings | undefined): settings is AiSettings {
    if (!settings || !settings.baseUrl.trim() || !settings.model.trim()) {
        return false;
    }
    return !isKeyRequired(settings) || !!settings.apiKey.trim();
}

function trimBase(url: string): string {
    return url.trim().replace(/\/+$/, '');
}

function endpoint(settings: AiSettings, kind: 'chat' | 'models'): string {
    if (settings.provider === 'anthropic') {
        const base = trimBase(settings.baseUrl).replace(/\/v1$/, '');
        return `${base}/v1/${kind === 'chat' ? 'messages' : 'models'}`;
    }
    return `${trimBase(settings.baseUrl)}/${kind === 'chat' ? 'chat/completions' : 'models'}`;
}

function requestHeaders(settings: AiSettings): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (settings.provider === 'anthropic') {
        headers['anthropic-version'] = '2023-06-01';
        headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    const key = settings.apiKey.trim();
    if (key) {
        if (settings.auth === 'x-api-key') {
            headers['x-api-key'] = key;
        } else if (settings.auth === 'authorization') {
            headers.authorization = `Bearer ${key}`;
        } else if (settings.auth === 'api-key') {
            headers['api-key'] = key;
        }
    }
    for (const line of settings.extraHeaders.split('\n')) {
        const colon = line.indexOf(':');
        const name = colon > 0 ? line.slice(0, colon).trim().toLowerCase() : '';
        if (name) {
            headers[name] = line.slice(colon + 1).trim();
        }
    }
    return headers;
}

export type AiErrorKind = 'network' | 'auth' | 'notFound' | 'http';

export class AiRequestError extends Error {
    constructor(message: string, readonly kind: AiErrorKind, readonly url: string, readonly status?: number) {
        super(message);
    }
}

/** fetch 的包装：区分「请求根本没发出去」（跨域被拦、地址不通）与服务端返回的错误 */
function credentialsOf(settings: AiSettings): RequestCredentials {
    return settings.credentials ? 'include' : 'same-origin';
}

async function aiFetch(url: string, init: RequestInit, settings?: AiSettings): Promise<Response> {
    let response: Response;
    try {
        response = await fetch(url, settings ? { ...init, credentials: credentialsOf(settings) } : init);
    } catch (error) {
        if (init.signal?.aborted) {
            throw error;
        }
        throw new AiRequestError(error instanceof Error ? error.message : String(error), 'network', url);
    }
    if (response.ok) {
        return response;
    }
    let detail = '';
    try {
        detail = (await response.text()).slice(0, 600);
    } catch {
        // 读不到响应体时只报状态码
    }
    const kind: AiErrorKind = response.status === 401 || response.status === 403 ? 'auth'
        : response.status === 404 || response.status === 405 ? 'notFound'
        : 'http';
    throw new AiRequestError(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`, kind, url, response.status);
}

/** 把请求错误翻译成用户能据此行动的说明 */
export function describeAiError(error: unknown): string {
    if (!(error instanceof AiRequestError)) {
        return error instanceof Error ? error.message : String(error);
    }
    if (error.kind === 'network') {
        const target = new URL(error.url, document.baseURI);
        return target.origin === location.origin
            ? t('Cannot reach {0}. The forwarding service configured for this site may be down.', target.pathname)
            : t('Cannot reach {0}. The address may be wrong, or the service does not accept requests from this page ({1}) because of browser cross-origin (CORS) rules. Ask your administrator to allow this origin, or to forward the service through this site (ai-config.json).', target.origin, location.origin);
    }
    if (error.kind === 'auth') {
        return t('Authentication failed ({0}). Check the API key and the authentication header.', error.message);
    }
    if (error.kind === 'notFound') {
        return t('Endpoint not found ({0}): {1}. Check the base URL and the protocol.', error.message, error.url);
    }
    return error.message;
}

/** 逐个产出 SSE 事件的 data 字段 */
async function* sseData(response: Response): AsyncGenerator<string> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = event.split('\n')
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart())
                .join('\n');
            if (data) {
                yield data;
            }
        }
    }
}

function anthropicMessages(turns: ChatTurn[]) {
    return turns.map(turn => ({
        role: turn.role,
        content: [
            ...(turn.images ?? []).map(image => ({
                type: 'image',
                source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
            })),
            { type: 'text', text: turn.text },
        ],
    }));
}

function openAiMessages(system: string | undefined, turns: ChatTurn[]) {
    return [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...turns.map(turn => turn.images?.length
            ? {
                role: turn.role,
                content: [
                    { type: 'text', text: turn.text },
                    ...turn.images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } })),
                ],
            }
            : { role: turn.role, content: turn.text }),
    ];
}

/** 服务端忽略 stream、直接返回整份 JSON 时的兜底 */
async function wholeJson(response: Response): Promise<unknown> {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
    }
}

function anthropicText(body: unknown): string {
    const content = (body as { content?: Array<{ type?: string; text?: string }> })?.content;
    return (content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('');
}

function openAiText(body: unknown): string {
    const choices = (body as { choices?: Array<{ message?: { content?: string } }> })?.choices;
    return choices?.[0]?.message?.content ?? '';
}

async function streamAnthropic(settings: AiSettings, system: string, turns: ChatTurn[], onText: (delta: string) => void, signal: AbortSignal): Promise<void> {
    const response = await aiFetch(endpoint(settings, 'chat'), {
        method: 'POST',
        signal,
        headers: requestHeaders(settings),
        body: JSON.stringify({
            model: settings.model.trim(),
            max_tokens: MAX_OUTPUT_TOKENS,
            stream: true,
            // 规范全文每轮都发，缓存后续轮次只按缓存读取计费
            system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
            messages: anthropicMessages(turns),
        }),
    }, settings);
    if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
        const body = await wholeJson(response);
        const text = anthropicText(body);
        if (!text) {
            throw new Error(`Unexpected response: ${JSON.stringify(body).slice(0, 200)}`);
        }
        onText(text);
        return;
    }
    for await (const data of sseData(response)) {
        const event = JSON.parse(data) as { type: string; delta?: { type: string; text?: string }; error?: { message?: string } };
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
            onText(event.delta.text);
        } else if (event.type === 'error') {
            throw new Error(event.error?.message || 'Stream error');
        }
    }
}

async function streamOpenAi(settings: AiSettings, system: string, turns: ChatTurn[], onText: (delta: string) => void, signal: AbortSignal): Promise<void> {
    const response = await aiFetch(endpoint(settings, 'chat'), {
        method: 'POST',
        signal,
        headers: requestHeaders(settings),
        body: JSON.stringify({
            model: settings.model.trim(),
            stream: true,
            messages: openAiMessages(system, turns),
        }),
    }, settings);
    if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
        const body = await wholeJson(response);
        const text = openAiText(body);
        if (!text) {
            throw new Error(`Unexpected response: ${JSON.stringify(body).slice(0, 200)}`);
        }
        onText(text);
        return;
    }
    for await (const data of sseData(response)) {
        if (data === '[DONE]') {
            break;
        }
        const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string } };
        if (event.error) {
            throw new Error(event.error.message || 'Stream error');
        }
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) {
            onText(delta);
        }
    }
}

/** 流式对话，返回完整回复文本 */
export async function streamChat(settings: AiSettings, system: string, turns: ChatTurn[], onText: (delta: string) => void, signal: AbortSignal): Promise<string> {
    let full = '';
    const collect = (delta: string) => {
        full += delta;
        onText(delta);
    };
    if (settings.provider === 'anthropic') {
        await streamAnthropic(settings, system, turns, collect, signal);
    } else {
        await streamOpenAi(settings, system, turns, collect, signal);
    }
    return full;
}

/** 发一条极短的消息验证地址、鉴权和模型都可用 */
export async function testAiConnection(settings: AiSettings, signal?: AbortSignal): Promise<void> {
    const turns: ChatTurn[] = [{ role: 'user', text: 'ping' }];
    await aiFetch(endpoint(settings, 'chat'), {
        method: 'POST',
        signal,
        headers: requestHeaders(settings),
        body: JSON.stringify(settings.provider === 'anthropic'
            ? { model: settings.model.trim(), max_tokens: 16, messages: anthropicMessages(turns) }
            : { model: settings.model.trim(), max_tokens: 16, messages: openAiMessages(undefined, turns) }),
    }, settings);
}

/** 从服务端拉取模型列表（两种协议都是 GET .../models，返回 { data: [{ id }] }） */
export async function fetchAiModels(settings: AiSettings, signal?: AbortSignal): Promise<string[]> {
    const headers = requestHeaders(settings);
    delete headers['content-type'];
    const response = await aiFetch(endpoint(settings, 'models'), { method: 'GET', signal, headers, cache: 'no-store' }, settings);
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    return [...new Set((body.data ?? []).map(item => item.id).filter((id): id is string => typeof id === 'string'))].sort();
}
