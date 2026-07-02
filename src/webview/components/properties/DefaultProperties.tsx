import React, { useState } from 'react';
import { PropertyPanelProps } from './types';
import { PropertyEditor } from './PropertyEditor';
import { BaseProperties } from './BaseProperties';
import { EventsPanel } from './EventsPanel';
import { CollapsibleGroup } from './CollapsibleGroup';
import { componentDefinitions } from '../ComponentLibrary';
import { useDesignerStore } from '../../store';
import { t, getLocale } from '../../i18n';
import { useFontGlyphStats } from '../../hooks/useFontGlyphStats';
import { PRESET_CHARSETS, PRESET_CODEPAGES, isPresetValue, getPresetLabel } from '../../../common/charsetPresets';
import { listI18nKeys, resolveLocalizedText, setTranslation } from '../../../project-i18n/catalog';
import { summarizeI18nAutoCharsetForKeys } from '../../../project-i18n/autoCharset';
import { detectScripts } from '../../../project-i18n/script';
import { estimateTextPixelWidth } from '../../../project-i18n/textMetrics';
import { HelpIcon } from './HelpIcon';

// 字体文件扩展名
const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2', 'bin'];

function parseRangeValue(value: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    const match = trimmed.match(/^(0x[0-9a-f]+|\d+)(?:\s*-\s*(0x[0-9a-f]+|\d+))?$/i);
    if (!match) {
      continue;
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      ranges.push([Math.min(start, end), Math.max(start, end)]);
    }
  }
  return ranges;
}

function presetCharsetCoversChar(value: string, char: string): boolean {
  const scripts = detectScripts(char);
  if (scripts.length === 0) {
    return false;
  }

  const upper = value.toUpperCase();
  if (upper.includes('GB') || upper === 'CP936' || upper === 'CP950') {
    return scripts.includes('CJK') || scripts.includes('Latin');
  }
  if (upper === 'CP932') {
    return scripts.includes('Kana') || scripts.includes('CJK') || scripts.includes('Latin');
  }
  if (upper.includes('KSX') || upper === 'CP949') {
    return scripts.includes('Hangul') || scripts.includes('Latin');
  }
  if (upper.includes('KOI8') || upper === 'CP1251') {
    return scripts.includes('Cyrillic') || scripts.includes('Latin');
  }
  if (upper === 'CP1253') {
    return scripts.includes('Greek') || scripts.includes('Latin');
  }
  if (upper === 'CP1255') {
    return scripts.includes('Hebrew') || scripts.includes('Latin');
  }
  if (upper === 'CP1256') {
    return scripts.includes('Arabic') || scripts.includes('Latin');
  }
  if (upper.includes('ISO8859') || upper === 'CP1252' || upper === 'CP1250' || upper === 'CP1254' || upper === 'CP1257' || upper === 'CP1258') {
    return scripts.includes('Latin');
  }
  if (upper.includes('ASCII') || upper === 'CP437') {
    const codePoint = char.codePointAt(0);
    return codePoint !== undefined && codePoint >= 0x20 && codePoint <= 0x7E;
  }
  return false;
}

function characterSetsCoverChar(characterSets: any[] | undefined, char: string): boolean {
  if (!characterSets || characterSets.length === 0) {
    return false;
  }

  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return false;
  }

  return characterSets.some((charset) => {
    const type = charset?.type;
    const value = String(charset?.value || '');
    if (!value) {
      return false;
    }
    if (type === 'string') {
      return Array.from(value).includes(char);
    }
    if (type === 'range') {
      return parseRangeValue(value).some(([start, end]) => codePoint >= start && codePoint <= end);
    }
    if (type === 'file' || type === 'codepage') {
      return presetCharsetCoversChar(value, char);
    }
    return false;
  });
}

// 模块级缓存：保留 activeTab 状态，防止组件重挂载时重置
const activeTabCache = new Map<string, 'properties' | 'events'>();

export const DefaultProperties: React.FC<PropertyPanelProps> = ({ component, onUpdate, components }) => {
  const [activeTab, setActiveTabState] = useState<'properties' | 'events'>(
    activeTabCache.get(component.id) ?? 'properties'
  );
  const setActiveTab = React.useCallback((tab: 'properties' | 'events') => {
    activeTabCache.set(component.id, tab);
    setActiveTabState(tab);
  }, [component.id]);
  const [showFontPicker, setShowFontPicker] = useState<string | null>(null);
  const [fontFiles, setFontFiles] = useState<string[]>([]);
  const [userFunctions, setUserFunctions] = useState<Array<{ name: string; type: 'event' | 'message' }>>([]);
  
  // 保存当前正在编辑的组件 ID（用于异步操作时确保操作应用到正确的组件）
  const componentIdRef = React.useRef(component.id);
  
  // 组件切换时更新 ref
  React.useEffect(() => {
    componentIdRef.current = component.id;
  }, [component.id]);
  
  const definition = componentDefinitions.find((d) => d.type === component.type);
  const syncListItems = useDesignerStore((state) => state.syncListItems);
  const projectI18nCatalog = useDesignerStore((state) => state.projectI18nCatalog);
  const previewLocale = useDesignerStore((state) => state.previewLocale);
  const updateProjectI18nCatalog = useDesignerStore((state) => state.updateProjectI18nCatalog);
  
  // 获取项目目标引擎，判断是否是 LVGL 项目
  const projectConfig = useDesignerStore((state) => state.projectConfig);
  const targetEngine = projectConfig?.targetEngine || 'honeygui';
  const isLvglProject = targetEngine === 'lvgl';
  const isLocalizableLabel = component.type === 'hg_label';
  const i18nKey = String((component.data as any)?.i18nKey || '').trim();
  const i18nAutoCharset = React.useMemo(
    () => summarizeI18nAutoCharsetForKeys(projectI18nCatalog, i18nKey ? [i18nKey] : []),
    [projectI18nCatalog, i18nKey]
  );
  const defaultLocale = projectI18nCatalog.defaultLocale;
  const i18nEntry = i18nKey ? projectI18nCatalog.strings[i18nKey] : undefined;
  const defaultLocaleText = i18nKey
    ? i18nEntry?.[defaultLocale] ?? (component.data as any)?.text ?? ''
    : '';
  const currentLocaleText = i18nKey ? i18nEntry?.[previewLocale] ?? '' : '';
  const i18nKeys = listI18nKeys(projectI18nCatalog);
  const manualCharacterSets = Array.isArray((component.data as any)?.characterSets)
    ? (component.data as any).characterSets
    : [];
  const manualCharacterSetsKey = JSON.stringify(manualCharacterSets);
  const effectiveCharacterSets = React.useMemo(
    () => i18nAutoCharset.source
      ? [...manualCharacterSets, i18nAutoCharset.source]
      : manualCharacterSets,
    [manualCharacterSetsKey, i18nAutoCharset.source]
  );
  const isPreviewLocaleMissing = Boolean(
    i18nKey &&
    previewLocale !== defaultLocale &&
    i18nEntry &&
    !i18nEntry[previewLocale]
  );
  const isI18nKeyMissing = Boolean(i18nKey && !i18nEntry);
  const resolvedPreviewTextResult = resolveLocalizedText(
    projectI18nCatalog,
    (component.data as any)?.i18nKey,
    previewLocale,
    (component.data as any)?.text,
    component.name
  );
  const resolvedPreviewText = (component.data as any)?.timeFormat === 'HH:mm-split' &&
    resolvedPreviewTextResult.source === 'componentName'
    ? '12:34'
    : resolvedPreviewTextResult.text;
  const fallbackTextChars = new Set(Array.from(String((component.data as any)?.text || '')));
  const previewCharsMissingFromFirmwareCharset = Array.from(new Set(Array.from(resolvedPreviewText)))
    .filter((char) => char.trim() !== '')
    .filter((char) => !fallbackTextChars.has(char))
    .filter((char) => !characterSetsCoverChar(effectiveCharacterSets, char));
  const labelFontSize = Number((component.data as any)?.fontSize) || 16;
  const labelLetterSpacing = Number((component.style as any)?.letterSpacing) || 0;
  const labelLineSpacing = Number((component.style as any)?.lineSpacing) || 0;
  const labelEstimatedWidth = estimateTextPixelWidth(resolvedPreviewText, labelFontSize, labelLetterSpacing);
  const labelWidth = Number(component.position?.width) || 0;
  const labelHeight = Number(component.position?.height) || 0;
  const labelEnableScroll = Boolean((component.data as any)?.enableScroll);
  const labelWordWrap = labelEnableScroll
    ? (component.data as any)?.scrollDirection === 'vertical'
    : Boolean((component.style as any)?.wordWrap);
  const labelLineHeight = labelFontSize + labelLineSpacing;
  const labelEstimatedHeight = labelWordWrap
    ? Math.ceil(labelEstimatedWidth / Math.max(labelWidth, 1)) * labelLineHeight
    : labelLineHeight;
  const hasLikelyTextOverflow = Boolean(
    resolvedPreviewText &&
    labelWidth > 0 &&
    labelEstimatedWidth > labelWidth &&
    !labelWordWrap &&
    !labelEnableScroll
  );
  const hasLikelyWrapHeightOverflow = Boolean(
    resolvedPreviewText &&
    labelWordWrap &&
    !labelEnableScroll &&
    labelHeight > 0 &&
    labelEstimatedHeight > labelHeight
  );

  // 字体字符统计 + 缺字检测（文本 + 附加字符集，与字体转换时的合并逻辑一致）
  const fontStats = useFontGlyphStats(
    (component.data as any)?.fontFile,
    resolvedPreviewText,
    effectiveCharacterSets,
    (component.data as any)?.fontSize ?? 16,
    Number((component.data as any)?.renderMode) || 4
  );

  // 生成时间标签的 placeholder 示例（当前系统时间 + 自动生成标注）
  const getTimePlaceholder = (format: string): string => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const hour = pad(now.getHours());
    const minute = pad(now.getMinutes());
    const second = pad(now.getSeconds());

    let timeStr: string;
    switch (format) {
      case 'HH:mm:ss': timeStr = `${hour}:${minute}:${second}`; break;
      case 'HH:mm': timeStr = `${hour}:${minute}`; break;
      case 'HH': timeStr = `${hour}`; break;
      case 'mm': timeStr = `${minute}`; break;
      case 'HH:mm-split': timeStr = `${hour}:${minute}`; break;
      case 'YYYY-MM-DD': timeStr = `${year}-${month}-${day}`; break;
      case 'YYYY-MM-DD HH:mm:ss': timeStr = `${year}-${month}-${day} ${hour}:${minute}:${second}`; break;
      case 'MM-DD HH:mm': timeStr = `${month}-${day} ${hour}:${minute}`; break;
      default: timeStr = `${hour}:${minute}:${second}`; break;
    }
    return `${timeStr} // ${t('auto generated')}`;
  };

  // 生成计时器标签的 placeholder 示例
  const getTimerPlaceholder = (format: string): string => {
    switch (format) {
      case 'HH:MM:SS': return `00:00:00 // ${t('auto generated')}`;
      case 'MM:SS': return `00:00 // ${t('auto generated')}`;
      case 'MM:SS:MS': return `00:00.00 // ${t('auto generated')}`;
      case 'SS': return `00 // ${t('auto generated')}`;
      default: return `00:00:00 // ${t('auto generated')}`;
    }
  };

  const handleStyleChange = (property: string, value: any) => {
    onUpdate({
      style: {
        ...component.style,
        [property]: value,
      },
    });
  };

  const handleDataChange = (property: string, value: any) => {
    let clampedValue = value;

    // slider/progressbar: value 不允许超过 min/max 范围
    if (component.type === 'hg_slider' || component.type === 'hg_progressbar') {
      const data = component.data || {};
      if (property === 'value') {
        const min = Number(data.min ?? 0);
        const max = Number(data.max ?? 100);
        clampedValue = Math.max(min, Math.min(max, Number(clampedValue)));
      } else if (property === 'min') {
        const max = Number(data.max ?? 100);
        const currentValue = Number(data.value ?? 0);
        clampedValue = Math.min(Number(clampedValue), max);
        // min 变大后，如果 value 小于新 min，自动调整 value
        if (currentValue < Number(clampedValue)) {
          onUpdate({
            data: { ...data, [property]: clampedValue, value: clampedValue },
          });
          return;
        }
      } else if (property === 'max') {
        const min = Number(data.min ?? 0);
        const currentValue = Number(data.value ?? 0);
        clampedValue = Math.max(Number(clampedValue), min);
        // max 变小后，如果 value 大于新 max，自动调整 value
        if (currentValue > Number(clampedValue)) {
          onUpdate({
            data: { ...data, [property]: clampedValue, value: clampedValue },
          });
          return;
        }
      }
    }

    onUpdate({
      data: {
        ...component.data,
        [property]: clampedValue,
      },
    });
    
    // 如果是 list 控件的 noteNum 属性被修改，触发 syncListItems
    if (component.type === 'hg_list' && property === 'noteNum') {
      // 使用 setTimeout 确保状态更新后再同步
      setTimeout(() => {
        syncListItems(componentIdRef.current);
      }, 0);
    }
  };

  const cloneProjectI18nCatalog = () => JSON.parse(JSON.stringify(projectI18nCatalog));

  const handleI18nKeyChange = (value: string, commit = false) => {
    const nextKey = value.trim();
    if (!commit) {
      handleDataChange('i18nKey', nextKey);
      return;
    }

    const existingDefaultText = nextKey ? projectI18nCatalog.strings[nextKey]?.[defaultLocale] : undefined;
    onUpdate({
      data: {
        ...component.data,
        i18nKey: nextKey,
        ...(existingDefaultText !== undefined ? { text: existingDefaultText } : {}),
      },
    });

    if (!nextKey || existingDefaultText !== undefined) {
      return;
    }

    const nextCatalog = cloneProjectI18nCatalog();
    setTranslation(nextCatalog, nextKey, defaultLocale, (component.data as any)?.text || '');
    updateProjectI18nCatalog(nextCatalog, { save: true });
  };

  const handleDefaultLocaleTextChange = (value: string) => {
    if (!i18nKey) {
      return;
    }

    const nextCatalog = cloneProjectI18nCatalog();
    setTranslation(nextCatalog, i18nKey, defaultLocale, value);
    updateProjectI18nCatalog(nextCatalog, { save: true });
    onUpdate({
      data: {
        ...component.data,
        text: value,
      },
    });
  };

  const handleCurrentLocaleTextChange = (value: string) => {
    if (!i18nKey) {
      return;
    }

    const nextCatalog = cloneProjectI18nCatalog();
    setTranslation(nextCatalog, i18nKey, previewLocale, value);
    updateProjectI18nCatalog(nextCatalog, { save: true });
  };

  const handleGeneralChange = (property: string, value: any) => {
    onUpdate({
      data: {
        ...component.data,
        [property]: value,
      },
    });
  };

  const handleSelectImagePath = (propertyName?: string) => {
    window.vscodeAPI?.postMessage({
      command: 'selectImagePath',
      componentId: componentIdRef.current,
      propertyName: propertyName || 'src'
    });
  };

  const handleSelectGlassPath = () => {
    window.vscodeAPI?.postMessage({
      command: 'selectGlassPath',
      componentId: componentIdRef.current
    });
  };

  // 请求字体文件列表（用于 label 下拉选择）
  const handleOpenFontPicker = (propertyName: string) => {
    window.vscodeAPI?.postMessage({ command: 'getFontFiles' });
    setShowFontPicker(propertyName);
  };

  const handleSelectFontPath = () => {
    window.vscodeAPI?.postMessage({
      command: 'selectFontPath',
      componentId: componentIdRef.current
    });
  };

  // 监听字体文件列表和字体度量信息响应
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.command === 'fontFilesLoaded') {
        setFontFiles(event.data.fonts || []);
      } else if (event.data.command === 'userFunctionsLoaded') {
        setUserFunctions(event.data.functions || []);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [component.data]);

  // 当 hg_button 被选中时，加载用户自定义函数列表
  React.useEffect(() => {
    if (component.type === 'hg_button') {
      window.vscodeAPI?.postMessage({ command: 'getUserFunctions' });
    }
  }, [component.id, component.type]);

  const renderCallbackSelector = (propertyName: 'onCallback' | 'offCallback' | 'clickCallback') => {
    const value = (component.data as any)?.[propertyName] || '';
    const eventFunctions = userFunctions.filter(f => f.type === 'event');
    return (
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px', alignItems: 'center' }}>
        {eventFunctions.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', flex: 1 }}>
            {t('No user functions found, declare in src/user/**_user.h')}
          </div>
        ) : (
          <select
            value={value}
            onChange={(e) => handleDataChange(propertyName, e.target.value)}
            style={{
              flex: 1,
              padding: '4px 6px',
              backgroundColor: 'var(--vscode-dropdown-background)',
              color: 'var(--vscode-dropdown-foreground)',
              border: '1px solid var(--vscode-dropdown-border)',
              borderRadius: '2px',
              fontSize: '12px',
            }}
          >
            <option value="">-- {t('None')} --</option>
            {eventFunctions.map(func => (
              <option key={func.name} value={func.name}>{func.name}</option>
            ))}
          </select>
        )}
        {value && (
          <button
            onClick={() => handleDataChange(propertyName, '')}
            style={{
              padding: '4px 6px',
              backgroundColor: 'var(--vscode-button-secondaryBackground)',
              color: 'var(--vscode-button-secondaryForeground)',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
            title={t('Clear')}
          >
            ✕
          </button>
        )}
      </div>
    );
  };

  const renderImageProperty = (value: any, onChange: (value: any) => void, propertyName?: string) => {
    return (
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="图片路径"
          style={{
            flex: 1,
            padding: '4px 6px',
            backgroundColor: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
            borderRadius: '2px',
          }}
        />
        <button
          onClick={() => handleSelectImagePath(propertyName)}
          style={{
            padding: '4px 8px',
            backgroundColor: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
          title="选择图片文件"
        >
          📁
        </button>
      </div>
    );
  };

  const renderGlassProperty = (value: any, onChange: (value: any) => void) => {
    return (
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="形状路径 (.glass)"
          style={{
            flex: 1,
            padding: '4px 6px',
            backgroundColor: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
            borderRadius: '2px',
          }}
        />
        <button
          onClick={handleSelectGlassPath}
          style={{
            padding: '4px 8px',
            backgroundColor: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
          title="选择玻璃形状文件"
        >
          📁
        </button>
      </div>
    );
  };

  const renderFontProperty = (value: any, onChange: (value: any) => void, propertyName: string = 'fontFile') => {
    return (
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
          <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="字体文件路径"
            style={{
              flex: 1,
              padding: '4px 6px',
              backgroundColor: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--vscode-input-border)',
              borderRadius: '2px',
            }}
          />
          <button
            onClick={() => handleOpenFontPicker(propertyName)}
            style={{
              padding: '4px 8px',
              backgroundColor: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
            title="选择字体文件"
          >
            🔤
          </button>
        </div>
        {showFontPicker === propertyName && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 100,
            backgroundColor: 'var(--vscode-dropdown-background)',
            border: '1px solid var(--vscode-dropdown-border)',
            borderRadius: '4px',
            maxHeight: '200px',
            overflowY: 'auto',
            marginTop: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
          }}>
            {fontFiles.length === 0 ? (
              <div style={{ padding: '8px', color: 'var(--vscode-descriptionForeground)', fontSize: '12px' }}>
                {t('No font files, please upload to assets directory')}
              </div>
            ) : (
              fontFiles.map((font) => (
                <div
                  key={font}
                  onClick={() => {
                    onChange(font);
                    setShowFontPicker(null);
                  }}
                  style={{
                    padding: '6px 8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    borderBottom: '1px solid var(--vscode-dropdown-border)',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vscode-list-hoverBackground)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  🔤 {font}
                </div>
              ))
            )}
            <div
              onClick={() => setShowFontPicker(null)}
              style={{
                padding: '6px 8px',
                cursor: 'pointer',
                fontSize: '12px',
                textAlign: 'center',
                color: 'var(--vscode-descriptionForeground)',
              }}
            >
              {t('Close')}
            </div>
          </div>
        )}
      </div>
    );
  };

  // 渲染字符集列表
  // 附加字符集的「各类型说明 + 示例」与「合并说明」集中到标题旁的 💡 悬停提示，
  // 不再散落在每项下方和底部（窄面板更省空间）。复用既有 i18n key，无需新增翻译。
  const charsetHelpText = [
    `${t('Unicode Range')}: ${t('Unicode character range')}  ${t('Example: 0x20-0x7E, 0x4E00-0x9FFF')}`,
    `${t('String')}: ${t('Extract characters from string')}  ${t('Example: ABC123你好')}`,
    `${t('CST File')}: ${t('Load characters from CST/TXT file')}  ${t('Example: charset.cst')}`,
    `${t('CodePage')}: ${t('Windows CodePage encoding')}  ${t('Example: CP936')}`,
    '',
    t('Additional character sets will be merged with text characters during font conversion'),
  ].join('\n');

  const renderCharacterSets = () => {
    const charsets = manualCharacterSets;
    
    // 处理文件浏览
    const handleBrowseCharsetFile = (index: number, type: 'file' | 'codepage') => {
      window.vscodeAPI?.postMessage({
        command: 'browseCharsetFile',
        componentId: componentIdRef.current,
        charsetIndex: index,
        fileType: type,
        filters: type === 'file' 
          ? { 'Charset文件': ['cst', 'txt'] }
          : {} // CodePage 文件没有后缀，显示所有文件
      });
    };

    // 获取显示值（文件类型显示文件名，其他显示完整值）
    const getDisplayValue = (cs: any) => {
      if ((cs.type === 'file' || cs.type === 'codepage') && cs.value) {
        // 提取文件名
        const parts = cs.value.split('/');
        return parts[parts.length - 1];
      }
      return cs.value || '';
    };
    
    return (
      <div>
        {i18nAutoCharset.charCount > 0 && (
          <div style={{
            marginBottom: '6px',
            padding: '6px 8px',
            border: '1px solid var(--vscode-panel-border)',
            borderRadius: '3px',
            background: 'var(--vscode-editor-background)',
            fontSize: '11px',
            color: 'var(--vscode-descriptionForeground)',
            lineHeight: 1.4,
          }}>
            <div style={{ color: 'var(--vscode-foreground)' }}>
              {t('Auto I18n Charset')}: {i18nAutoCharset.charCount.toLocaleString()} {t('characters')}
            </div>
            <div title={i18nAutoCharset.preview}>
              {t('From this label i18n key')}
            </div>
          </div>
        )}
        <div style={{
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '3px',
          maxHeight: '200px',
          overflowY: 'auto',
          overflowX: 'hidden',
          marginBottom: '6px'
        }}>
          {charsets.length === 0 ? (
            <div style={{
              padding: '12px',
              textAlign: 'center',
              fontSize: '11px',
              color: 'var(--vscode-descriptionForeground)'
            }}>
              {t('No manual additional character sets')}
            </div>
          ) : (
            charsets.map((cs: any, index: number) => (
              <div key={index} style={{
                padding: '6px',
                fontSize: '11px',
                borderBottom: index < charsets.length - 1 ? '1px solid var(--vscode-panel-border)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                {/* 第一行：类型选择 + 删除（删除按钮固定在右上角，任意宽度都可见） */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <select
                    value={cs.type || 'range'}
                    onChange={(e) => {
                      const newCharsets = [...charsets];
                      // 切换类型时重置为该类型的安全默认值，避免空 range 被保存后导致字体转换失败。
                      const nextType = e.target.value;
                      newCharsets[index] = { ...cs, type: nextType, value: nextType === 'range' ? '0x20-0x7E' : '' };
                      handleDataChange('characterSets', newCharsets);
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '3px 6px',
                      backgroundColor: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                      border: '1px solid var(--vscode-input-border)',
                      borderRadius: '2px',
                      fontSize: '11px'
                    }}
                  >
                    <option value="range">{t('Unicode Range')}</option>
                    <option value="string">{t('String')}</option>
                    <option value="file">{t('CST File')}</option>
                    <option value="codepage">{t('CodePage')}</option>
                  </select>
                  <button
                    onClick={() => {
                      const newCharsets = charsets.filter((_: any, i: number) => i !== index);
                      handleDataChange('characterSets', newCharsets);
                    }}
                    style={{
                      flexShrink: 0,
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--vscode-descriptionForeground)',
                      cursor: 'pointer',
                      padding: '2px 4px',
                      fontSize: '12px'
                    }}
                    title={t('Remove')}
                  >
                    ✕
                  </button>
                </div>
                {/* 第二行：字符集来源（值），占满整行，下拉箭头始终可见 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {(cs.type === 'file' || cs.type === 'codepage') ? (
                    (() => {
                      // 预置 charset/CodePage 已随插件分发，改为下拉直接选取（存稳定标识符）；
                      // 仅当用户需要自有文件时才走「自定义文件…」+ 浏览。
                      const presetList = cs.type === 'file' ? PRESET_CHARSETS : PRESET_CODEPAGES;
                      const lang = getLocale();
                      const isCustom = !!cs.value && !isPresetValue(cs.value);
                      const selected = isCustom ? '__custom__' : (cs.value || '');
                      return (
                        <>
                          <select
                            value={selected}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '__custom__') {
                                // 选择「自定义文件…」立即打开文件浏览
                                handleBrowseCharsetFile(index, cs.type);
                                return;
                              }
                              const newCharsets = [...charsets];
                              newCharsets[index] = { ...cs, value: v };
                              handleDataChange('characterSets', newCharsets);
                            }}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              padding: '3px 6px',
                              backgroundColor: 'var(--vscode-input-background)',
                              color: 'var(--vscode-input-foreground)',
                              border: '1px solid var(--vscode-input-border)',
                              borderRadius: '2px',
                              fontSize: '11px'
                            }}
                          >
                            <option value="">{t('Select preset...')}</option>
                            {presetList.map((p) => (
                              <option key={p.id} value={p.id}>{getPresetLabel(presetList, p.id, lang)}</option>
                            ))}
                            <option value="__custom__">{t('Custom file...')}</option>
                          </select>
                          {isCustom && (
                            <button
                              onClick={() => handleBrowseCharsetFile(index, cs.type)}
                              style={{
                                flexShrink: 0,
                                padding: '3px 6px',
                                backgroundColor: 'var(--vscode-button-background)',
                                color: 'var(--vscode-button-foreground)',
                                border: 'none',
                                borderRadius: '2px',
                                cursor: 'pointer',
                                fontSize: '11px',
                                whiteSpace: 'nowrap'
                              }}
                              title={getDisplayValue(cs) || t('Browse')}
                            >
                              📁
                            </button>
                          )}
                        </>
                      );
                    })()
                  ) : (
                    <input
                      type="text"
                      value={getDisplayValue(cs)}
                      onChange={(e) => {
                        const newCharsets = [...charsets];
                        newCharsets[index] = { ...cs, value: e.target.value };
                        handleDataChange('characterSets', newCharsets);
                      }}
                      placeholder={cs.type === 'range' ? '0x20-0x7E' : 'ABC123'}
                      title={cs.value || ''}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '3px 6px',
                        backgroundColor: 'var(--vscode-input-background)',
                        color: 'var(--vscode-input-foreground)',
                        border: '1px solid var(--vscode-input-border)',
                        borderRadius: '2px',
                        fontSize: '11px'
                      }}
                    />
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <button
          onClick={() => {
            const newCharsets = [...charsets, { type: 'range', value: '0x20-0x7E' }];
            handleDataChange('characterSets', newCharsets);
          }}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            backgroundColor: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            width: '100%'
          }}
        >
          + {t('Add Character Set')}
        </button>
        {fontStats.charCount > 0 && (
          <div style={{
            fontSize: '10px',
            color: 'var(--vscode-descriptionForeground)',
            marginTop: '6px'
          }}>
            将包含 {fontStats.charCount.toLocaleString()} 个字符，预计约 {fontStats.estimatedSizeKB} KB
          </div>
        )}
        {fontStats.missingChars.length > 0 && (
          <div style={{
            fontSize: '10px',
            color: 'var(--vscode-editorWarning-foreground)',
            marginTop: '4px',
            lineHeight: '1.4',
            whiteSpace: 'pre-wrap'
          }}>
            {(() => {
              const MAX_SHOW = 5;
              const shown = fontStats.missingChars
                .slice(0, MAX_SHOW)
                .map((c) => '「' + c + '」')
                .join('');
              const rest = fontStats.missingChars.length - MAX_SHOW;
              const charList = rest > 0 ? shown + '...等 ' + rest + ' 个' : shown;
              const advice =
                fontStats.missingChars.length > MAX_SHOW ? '\n建议缩小字符集范围或更换字体' : '';
              return (
                '⚠️ ' + fontStats.missingChars.length + ' 个字符在字体中不存在：' + charList + advice
              );
            })()}
          </div>
        )}
      </div>
    );
  };

  const renderI18nWarning = (message: string) => (
    <div className="property-warning property-warning-i18n">
      {message}
    </div>
  );

  const renderLabelI18nProperties = () => {
    if (!isLocalizableLabel) {
      return null;
    }

    return (
      <>
        <div className="property-item">
          <label>{t('Localized Key')}</label>
          <input
            type="text"
            value={i18nKey}
            onChange={(event) => handleI18nKeyChange(event.target.value)}
            onBlur={(event) => handleI18nKeyChange(event.target.value, true)}
            placeholder="pairing.scan_code"
            title={t('Localized Key Hint')}
            style={{
              width: '100%',
              padding: '4px 6px',
              marginTop: '4px',
              backgroundColor: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--vscode-input-border)',
              borderRadius: '2px',
            }}
          />
          {i18nKeys.length > 0 && (
            <select
              value={i18nKeys.includes(i18nKey) ? i18nKey : ''}
              onChange={(event) => {
                if (event.target.value) {
                  handleI18nKeyChange(event.target.value, true);
                }
              }}
              title={t('Pick an existing i18n key')}
              style={{
                width: '100%',
                padding: '4px 6px',
                marginTop: '4px',
                backgroundColor: 'var(--vscode-dropdown-background)',
                color: 'var(--vscode-dropdown-foreground)',
                border: '1px solid var(--vscode-dropdown-border)',
                borderRadius: '2px',
                fontSize: '12px',
              }}
            >
              <option value="">{t('Pick an existing i18n key')}</option>
              {i18nKeys.map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
          )}
        </div>

        <div className="property-item">
          <label>{`${t('Default Locale Text')} (${defaultLocale})`}</label>
          <PropertyEditor
            type="string"
            value={i18nKey ? defaultLocaleText : ''}
            onChange={handleDefaultLocaleTextChange}
            disabled={!i18nKey}
            title={!i18nKey ? t('Set a localized key before editing translations') : undefined}
          />
        </div>

        {previewLocale !== defaultLocale && (
          <div className="property-item">
            <label>{`${t('Current Locale Text')} (${previewLocale})`}</label>
            <PropertyEditor
              type="string"
              value={i18nKey ? currentLocaleText : ''}
              onChange={handleCurrentLocaleTextChange}
              disabled={!i18nKey}
              title={!i18nKey ? t('Set a localized key before editing translations') : undefined}
            />
          </div>
        )}

        {isI18nKeyMissing && renderI18nWarning(t('Localized key does not exist yet'))}
        {isPreviewLocaleMissing && renderI18nWarning(t('Current locale is missing and preview is falling back'))}
      </>
    );
  };

  const renderFontDiagnostics = () => {
    const warnings: string[] = [];
    const missingGlyphs = fontStats.missingChars.slice(0, 6).join(' ');
    const missingCharsetChars = previewCharsMissingFromFirmwareCharset.slice(0, 8).join(' ');
    const textComponent = component.type === 'hg_label' || component.type === 'hg_time_label' || component.type === 'hg_timer_label';

    if (fontStats.missingChars.length > 0) {
      warnings.push(t('Missing font glyphs', missingGlyphs || String(fontStats.missingChars.length)));
    }
    if (previewCharsMissingFromFirmwareCharset.length > 0) {
      warnings.push(t('Preview characters not included in firmware charset', missingCharsetChars));
    }
    if (textComponent && hasLikelyTextOverflow) {
      warnings.push(t('Likely text overflow'));
    }
    if (textComponent && hasLikelyWrapHeightOverflow) {
      warnings.push(t('Likely wrap height overflow'));
    }

    if (warnings.length === 0) {
      return null;
    }

    return (
      <div className="property-diagnostics">
        {warnings.map((warning, index) => (
          <div key={`${warning}-${index}`} className="property-warning property-warning-i18n">
            {warning}
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <div className="properties-tabs">
        <button
          className={activeTab === 'properties' ? 'active' : ''}
          onClick={() => setActiveTab('properties')}
        >
          {t('Properties')}
        </button>
        <button
          className={activeTab === 'events' ? 'active' : ''}
          onClick={() => setActiveTab('events')}
        >
          {t('Events')}
        </button>
      </div>

      <div className="properties-content">
        {activeTab === 'properties' && (
          <>
            <BaseProperties 
              component={component} 
              onUpdate={onUpdate} 
              components={components}
              disableSize={component.type === 'hg_list'}
              sizeTooltip={component.type === 'hg_list' ? t('List size is auto-calculated') : undefined}
            />

            {/* Canvas SVG 编辑按钮 */}
            {component.type === 'hg_canvas' && (
              <CollapsibleGroup title={t('Content')}>
                <div className="property-item">
                  <div style={{ 
                    fontSize: '12px', 
                    color: 'var(--vscode-descriptionForeground)',
                    marginBottom: '8px'
                  }}>
                    {(component.data as any)?.svgContent 
                      ? '✓ ' + t('canvasEditor.preview')
                      : '未配置 SVG 内容'
                    }
                  </div>
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('openCanvasEditor', {
                        detail: { componentId: componentIdRef.current }
                      }));
                    }}
                    style={{
                      width: '100%',
                      padding: '6px 12px',
                      backgroundColor: 'var(--vscode-button-background)',
                      color: 'var(--vscode-button-foreground)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    {t('canvasEditor.editSvg')}
                  </button>
                </div>
              </CollapsibleGroup>
            )}

            {/* Style Properties */}
            {definition && definition.properties.filter(p => p.group === 'style').length > 0 && (
              <CollapsibleGroup title={t('Style')}>
                {/* hg_list 特殊处理：项宽度和项高度在一行 */}
                {component.type === 'hg_list' ? (
                  <>
                    <div className="property-item">
                      <label>{t('Item Size')}</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                        <div>
                          <label style={{ fontSize: '12px' }}>{t('Width')}</label>
                          <PropertyEditor
                            type="number"
                            value={(component.style as any)?.itemWidth ?? 100}
                            onChange={(value) => handleStyleChange('itemWidth', value)}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '12px' }}>{t('Height')}</label>
                          <PropertyEditor
                            type="number"
                            value={(component.style as any)?.itemHeight ?? 100}
                            onChange={(value) => handleStyleChange('itemHeight', value)}
                          />
                        </div>
                      </div>
                    </div>
                    {definition.properties
                      .filter(p => p.group === 'style' && p.name !== 'itemWidth' && p.name !== 'itemHeight')
                      .map((property) => (
                        <div key={property.name} className="property-item">
                          <label>{t(property.label as any)}</label>
                          <PropertyEditor
                            type={property.type as any}
                            value={(component.style as any)?.[property.name]}
                            onChange={(value) => handleStyleChange(property.name, value)}
                            options={property.options as string[]}
                            hint={(property as any).hint ? t((property as any).hint) : undefined}
                          />
                        </div>
                      ))}
                  </>
                ) : component.type === 'hg_label' || component.type === 'hg_time_label' || component.type === 'hg_timer_label' ? (
                  <>
                    {/* hg_label / hg_time_label / hg_timer_label 特殊处理：对齐方式在一行 */}
                    <div className="property-item">
                      <label>{t('Alignment')}</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                        <div style={{ opacity: (component.data as any)?.enableScroll ? 0.5 : 1 }}>
                          <label style={{ fontSize: '12px' }}>{t('Horizontal')}</label>
                          <PropertyEditor
                            type="select"
                            value={(component.style as any)?.hAlign || 'LEFT'}
                            onChange={(value) => handleStyleChange('hAlign', value)}
                            options={['LEFT', 'CENTER', 'RIGHT']}
                            disabled={(component.data as any)?.enableScroll}
                          />
                          {(component.data as any)?.enableScroll && (
                            <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                              ({t('Disabled when scrolling')})
                            </span>
                          )}
                        </div>
                        <div style={{ opacity: (component.data as any)?.enableScroll && (component.data as any)?.scrollDirection === 'vertical' ? 0.5 : 1 }}>
                          <label style={{ fontSize: '12px' }}>{t('Vertical')}</label>
                          <PropertyEditor
                            type="select"
                            value={(component.style as any)?.vAlign || 'TOP'}
                            onChange={(value) => handleStyleChange('vAlign', value)}
                            options={['TOP', 'MID']}
                            disabled={(component.data as any)?.enableScroll && (component.data as any)?.scrollDirection === 'vertical'}
                          />
                          {(component.data as any)?.enableScroll && (component.data as any)?.scrollDirection === 'vertical' && (
                            <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                              ({t('Disabled for vertical scroll')})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* 其他样式属性（排除对齐、间距、换行相关） */}
                    {definition.properties
                      .filter(p => p.group === 'style' && !['hAlign', 'vAlign', 'letterSpacing', 'lineSpacing', 'wordWrap', 'wordBreak'].includes(p.name))
                      .map((property) => (
                        <div key={property.name} className="property-item">
                          <label>{t(property.label as any)}</label>
                          <PropertyEditor
                            type={property.type as any}
                            value={(component.style as any)?.[property.name]}
                            onChange={(value) => handleStyleChange(property.name, value)}
                            options={property.options as string[]}
                            hint={(property as any).hint ? t((property as any).hint) : undefined}
                          />
                        </div>
                      ))}
                    {/* Word wrap and word break - 滚动时根据方向自动处理 */}
                    <div className="property-item">
                      <label>{t('Line Break')}</label>
                      <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: (component.data as any)?.enableScroll ? 0.5 : 1 }}>
                          <PropertyEditor
                            type="boolean"
                            value={(component.data as any)?.enableScroll 
                              ? (component.data as any)?.scrollDirection === 'vertical'
                              : ((component.style as any)?.wordWrap ?? false)}
                            onChange={(value) => handleStyleChange('wordWrap', value)}
                            disabled={(component.data as any)?.enableScroll}
                          />
                          <span style={{ fontSize: '12px' }}>{t('Word Wrap')}</span>
                          {(component.data as any)?.enableScroll && (component.data as any)?.scrollDirection === 'vertical' && (
                            <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                              ({t('Auto enabled for vertical scroll')})
                            </span>
                          )}
                          {(component.data as any)?.enableScroll && (component.data as any)?.scrollDirection === 'horizontal' && (
                            <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                              ({t('Auto disabled for horizontal scroll')})
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={t('Break at word boundaries')}>
                          <PropertyEditor
                            type="boolean"
                            value={(component.style as any)?.wordBreak ?? false}
                            onChange={(value) => handleStyleChange('wordBreak', value)}
                          />
                          <span style={{ fontSize: '12px' }}>{t('Word Break')}</span>
                        </div>
                      </div>
                    </div>
                    {/* Letter and line spacing */}
                    <div className="property-item">
                      <label>{t('Spacing')}</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                        <div>
                          <label style={{ fontSize: '12px' }}>{t('Letter Spacing')}</label>
                          <PropertyEditor
                            type="number"
                            value={(component.style as any)?.letterSpacing ?? 0}
                            onChange={(value) => handleStyleChange('letterSpacing', value)}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '12px' }}>{t('Line Spacing')}</label>
                          <PropertyEditor
                            type="number"
                            value={(component.style as any)?.lineSpacing ?? 0}
                            onChange={(value) => handleStyleChange('lineSpacing', value)}
                          />
                        </div>
                      </div>
                    </div>
                    {/* 启用滚动 - 放在样式组最后 */}
                    <div className="property-item">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <PropertyEditor
                            type="boolean"
                            value={(component.data as any)?.enableScroll ?? false}
                            onChange={(value) => handleDataChange('enableScroll', value)}
                          />
                          <span style={{ fontSize: '12px' }}>{t('Enable Scroll')}</span>
                        </div>
                        {(component.data as any)?.enableScroll && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={t('Enable scroll animation preview')}>
                            <PropertyEditor
                              type="boolean"
                              value={(component.data as any)?.scrollPreview ?? false}
                              onChange={(value) => handleDataChange('scrollPreview', value)}
                            />
                            <span style={{ fontSize: '12px' }}>{t('Scroll Preview')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  definition.properties
                    .filter(p => p.group === 'style')
                    .map((property) => (
                      <div key={property.name} className="property-item">
                        <label>{t(property.label as any)}</label>
                        <PropertyEditor
                          type={property.type as any}
                          value={(component.style as any)?.[property.name]}
                          onChange={(value) => handleStyleChange(property.name, value)}
                          options={property.options as string[]}
                          min={property.name === 'opacity' ? 0 : (property as any).min}
                          max={property.name === 'opacity' ? 255 : (property as any).max}
                          hint={(property as any).hint ? t((property as any).hint) : undefined}
                        />
                      </div>
                    ))
                )}
              </CollapsibleGroup>
            )}

            {/* Scroll Properties - 仅对 hg_label / hg_time_label 且启用滚动时显示 */}
            {(component.type === 'hg_label' || component.type === 'hg_time_label') && (component.data as any)?.enableScroll && (
              <CollapsibleGroup title={t('Behavior')}>
                {/* 滚动方向 */}
                <div className="property-item">
                  <label>{t('Scroll Direction')}</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', marginTop: '4px' }}>
                    <select
                      value={(component.data as any)?.scrollDirection || 'horizontal'}
                      onChange={(e) => handleDataChange('scrollDirection', e.target.value)}
                      style={{
                        padding: '4px 6px',
                        backgroundColor: 'var(--vscode-input-background)',
                        color: 'var(--vscode-input-foreground)',
                        border: '1px solid var(--vscode-input-border)',
                        borderRadius: '2px',
                      }}
                    >
                      <option value="horizontal">{t('horizontal' as any)}</option>
                      <option value="vertical">{t('vertical' as any)}</option>
                    </select>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <PropertyEditor
                        type="boolean"
                        value={(component.data as any)?.scrollReverse ?? false}
                        onChange={(value) => handleDataChange('scrollReverse', value)}
                      />
                      <span style={{ fontSize: '12px' }}>{t('Reverse')}</span>
                    </div>
                  </div>
                </div>
                {/* 起始偏移 */}
                <div className="property-item">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{t('Start Offset (px)')} <HelpIcon title={t('Initial blank space before text')} /></label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.scrollStartOffset ?? 0}
                    onChange={(value) => handleDataChange('scrollStartOffset', value)}
                  />
                </div>
                {/* 结束偏移 */}
                <div className="property-item">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{t('End Offset (px)')} <HelpIcon title={t('Final blank space after text')} /></label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.scrollEndOffset ?? 0}
                    onChange={(value) => handleDataChange('scrollEndOffset', value)}
                  />
                </div>
                {/* 循环间隔 */}
                <div className="property-item">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{t('Loop Interval (ms)')} <HelpIcon title={t('Time for one complete scroll cycle')} /></label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.scrollInterval ?? 3000}
                    onChange={(value) => handleDataChange('scrollInterval', value)}
                  />
                </div>
                {/* 总持续时间 */}
                <div className="property-item">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{t('Total Duration (ms)')} <HelpIcon title={t('Total scrolling duration, 0 = infinite')} /></label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.scrollDuration ?? 0}
                    onChange={(value) => handleDataChange('scrollDuration', value)}
                  />
                </div>
              </CollapsibleGroup>
            )}

            {/* Data Properties */}
            {definition && definition.properties.filter(p => p.group === 'data').length > 0 && (
              <CollapsibleGroup title={t('Content')}>
                {renderLabelI18nProperties()}
                {definition.properties
                  .filter(p => p.group === 'data')
                  .filter(p => {
                    if (isLocalizableLabel && p.name === 'i18nKey') {
                      return false;
                    }
                    // Button: show/hide properties based on toggleMode
                    if (component.type === 'hg_button') {
                      const isToggle = component.data?.toggleMode === true;
                      if (isToggle) {
                        // Toggle mode: hide clickCallback, text
                        if (p.name === 'clickCallback' || p.name === 'text') return false;
                      } else {
                        // Normal mode: hide initialState, onCallback, offCallback
                        if (p.name === 'initialState' || p.name === 'onCallback' || p.name === 'offCallback') return false;
                      }
                    }
                    return true;
                  })
                  .map((property) => (
                    <div key={property.name} className="property-item">
                      <label>
                        {property.name === 'text' && isLocalizableLabel && i18nKey
                          ? t('Fallback Text (codegen)')
                          : t(property.label as any)}
                      </label>
                      {property.name === 'src' && component.type === 'hg_image' ? (
                        renderImageProperty(
                          (component.data as any)?.[property.name],
                          (value) => handleDataChange(property.name, value),
                          'src'
                        )
                      ) : (property.name === 'imageOn' || property.name === 'imageOff') && component.type === 'hg_button' ? (
                        // 按钮图片选择器（Normal 和 Toggle 共用）
                        renderImageProperty(
                          (component.data as any)?.[property.name],
                          (value) => handleDataChange(property.name, value),
                          property.name
                        )
                      ) : (property.name === 'onCallback' || property.name === 'offCallback' || property.name === 'clickCallback') && component.type === 'hg_button' ? (
                        // 按钮回调函数选择器
                        renderCallbackSelector(property.name as 'onCallback' | 'offCallback' | 'clickCallback')
                      ) : (property.name === 'buttonStateOnImage' || property.name === 'buttonStateOffImage') && component.type === 'hg_image' ? (
                        // Image 组件双态按键的图片选择器
                        renderImageProperty(
                          (component.data as any)?.[property.name],
                          (value) => handleDataChange(property.name, value),
                          property.name
                        )
                      ) : property.name === 'src' && component.type === 'hg_glass' ? (
                        renderGlassProperty(
                          (component.data as any)?.[property.name],
                          (value) => handleDataChange(property.name, value)
                        )
                      ) : property.name === 'fontFile' ? (
                        renderFontProperty(
                          (component.data as any)?.[property.name],
                          (value) => handleDataChange(property.name, value),
                          property.name
                        )
                      ) : property.name === 'text' && isLocalizableLabel && i18nKey ? (
                        <PropertyEditor
                          type="string"
                          value={(component.data as any)?.text || ''}
                          onChange={() => undefined}
                          disabled={true}
                          title={t('Fallback Text Hint')}
                        />
                      ) : property.name === 'text' && (component.type === 'hg_timer_label' || component.type === 'hg_time_label') ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <PropertyEditor
                              type="string"
                              value={(component.data as any)?.text || ''}
                              onChange={(value) => handleDataChange('text', value)}
                              placeholder={component.type === 'hg_time_label'
                                ? getTimePlaceholder((component.data as any)?.timeFormat || 'HH:mm:ss')
                                : getTimerPlaceholder((component.data as any)?.timerFormat || 'HH:MM:SS')}
                            />
                            <HelpIcon title={t('Text Preview Hint')} />
                          </div>
                        </>
                      ) : property.name === 'text' && (component.type === 'hg_label' || component.type === 'hg_time_label') && (component.style as any)?.wordWrap ? (
                        // 自动换行开启时，文本输入框变成多行
                        <textarea
                          value={(component.data as any)?.[property.name] || ''}
                          onChange={(e) => handleDataChange(property.name, e.target.value)}
                          rows={3}
                          style={{
                            width: '100%',
                            padding: '4px 6px',
                            backgroundColor: 'var(--vscode-input-background)',
                            color: 'var(--vscode-input-foreground)',
                            border: '1px solid var(--vscode-input-border)',
                            borderRadius: '2px',
                            resize: 'vertical',
                            fontFamily: 'inherit',
                            fontSize: '13px',
                          }}
                        />
                      ) : (
                        <PropertyEditor
                          type={property.type as any}
                          value={(component.data as any)?.[property.name]}
                          onChange={(value) => handleDataChange(property.name, value)}
                          options={property.options as string[]}
                          min={(property as any).min}
                          max={(property as any).max}
                        />
                      )}
                    </div>
                  ))}
              </CollapsibleGroup>
            )}

            {/* General Properties */}
            {definition && definition.properties.filter(p => p.group === 'general').length > 0 && (
              <CollapsibleGroup title={t('Advanced')} defaultCollapsed={true}>
                {definition.properties
                  .filter(p => p.group === 'general')
                  .map((property) => (
                    <div key={property.name} className="property-item">
                      <label>{t(property.label as any)}</label>
                      <PropertyEditor
                        type={property.type as any}
                        value={(component.data as any)?.[property.name]}
                        onChange={(value) => handleGeneralChange(property.name, value)}
                        options={property.options as string[]}
                        min={(property as any).min}
                        max={(property as any).max}
                      />
                    </div>
                  ))}
              </CollapsibleGroup>
            )}

            {/* Interaction Properties - 按键效果 */}
            {definition && definition.properties.filter(p => p.group === 'interaction').length > 0 && (
              <CollapsibleGroup title={t('Interaction')}>
                
                {/* 按键模式选择 */}
                <div className="property-item">
                  <label>{t('Button Mode')}</label>
                  <PropertyEditor
                    type="select"
                    value={(component.data as any)?.buttonMode || 'none'}
                    onChange={(value) => {
                      handleDataChange('buttonMode', value);
                      
                      // 如果启用按键效果，自动在 name 中添加 _button_ 标识（如果还没有）
                      if (value !== 'none' && !component.name.includes('_button_')) {
                        const newName = component.name.replace(component.type, `${component.type}_button`);
                        onUpdate({ name: newName });
                      }
                      // 如果禁用按键效果，移除 _button_ 标识
                      else if (value === 'none' && component.name.includes('_button_')) {
                        const newName = component.name.replace('_button_', '_').replace('_button', '');
                        onUpdate({ name: newName });
                      }
                    }}
                    options={['none', 'dual-state', 'opacity']}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                    {(component.data as any)?.buttonMode === 'dual-state' && t('Switch between two states on click')}
                    {(component.data as any)?.buttonMode === 'opacity' && t('Change opacity on press/release')}
                    {((component.data as any)?.buttonMode === 'none' || !(component.data as any)?.buttonMode) && t('No button effect')}
                  </span>
                </div>

                {/* 双态模式属性 */}
                {(component.data as any)?.buttonMode === 'dual-state' && (
                  <>
                    {/* 初始状态 */}
                    <div className="property-item">
                      <label>{t('Initial State')}</label>
                      <PropertyEditor
                        type="select"
                        value={(component.data as any)?.buttonInitialState || 'off'}
                        onChange={(value) => handleDataChange('buttonInitialState', value)}
                        options={['on', 'off']}
                      />
                    </div>

                    {/* 几何组件：双态颜色 */}
                    {(component.type === 'hg_rect' || component.type === 'hg_circle') && (
                      <div className="property-item">
                        <label>{t('State Colors')}</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                          <div>
                            <label style={{ fontSize: '12px' }}>{t('On State')}</label>
                            <PropertyEditor
                              type="color"
                              value={(component.data as any)?.buttonStateOnColor || '#00FF00'}
                              onChange={(value) => handleDataChange('buttonStateOnColor', value)}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '12px' }}>{t('Off State')}</label>
                            <PropertyEditor
                              type="color"
                              value={(component.data as any)?.buttonStateOffColor || '#FF0000'}
                              onChange={(value) => handleDataChange('buttonStateOffColor', value)}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* 透明度模式属性 */}
                {(component.data as any)?.buttonMode === 'opacity' && (
                  <div className="property-item">
                    <label>{t('Opacity States')}</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                      <div>
                        <label style={{ fontSize: '12px' }}>{t('Pressed')}</label>
                        <PropertyEditor
                          type="number"
                          value={(component.data as any)?.buttonPressedOpacity ?? 128}
                          onChange={(value) => handleDataChange('buttonPressedOpacity', value)}
                          min={0}
                          max={255}
                        />
                        <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                          (0-255)
                        </span>
                      </div>
                      <div>
                        <label style={{ fontSize: '12px' }}>{t('Released')}</label>
                        <PropertyEditor
                          type="number"
                          value={(component.data as any)?.buttonReleasedOpacity ?? 255}
                          onChange={(value) => handleDataChange('buttonReleasedOpacity', value)}
                          min={0}
                          max={255}
                        />
                        <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
                          (0-255)
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </CollapsibleGroup>
            )}

            {/* Font Properties - 对所有包含 font 组属性的控件显示 */}
            {definition && definition.properties.filter(p => p.group === 'font').length > 0 && (
              <CollapsibleGroup title={t('Font')}>
                {/* 字体文件 */}
                {definition.properties.some(p => p.name === 'fontFile') && (
                <div className="property-item">
                  <label>{t('Font File')}</label>
                  {renderFontProperty(
                    (component.data as any)?.fontFile,
                    (value) => handleDataChange('fontFile', value),
                    'fontFile'
                  )}
                </div>
                )}
                {renderFontDiagnostics()}
                {/* 字体大小 */}
                {definition.properties.some(p => p.name === 'fontSize') && (
                <div className="property-item">
                  <label>{t('Font Size')}</label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.fontSize ?? 16}
                    onChange={(value) => handleDataChange('fontSize', value)}
                    min={1}
                  />
                </div>
                )}
                {/* 字体类型 - 仅定义了 fontType 属性的控件显示 */}
                {definition.properties.some(p => p.name === 'fontType') && (
                <div className="property-item">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {t('Font Type')}
                    <HelpIcon title={`${t('Bitmap font')}: ${t('Bitmap font hint')}\n${t('Vector font')}: ${t('Vector font hint')}`} />
                  </label>
                  <PropertyEditor
                    type="select"
                    value={(component.data as any)?.fontType || 'bitmap'}
                    onChange={(value) => handleDataChange('fontType', value)}
                    options={[
                      { value: 'bitmap', label: t('Bitmap font') },
                      { value: 'vector', label: t('Vector font') },
                    ]}
                  />
                </div>
                )}
                {/* 渲染模式 - 仅定义了 renderMode 属性且点阵字体时显示 */}
                {definition.properties.some(p => p.name === 'renderMode') && ((component.data as any)?.fontType || 'bitmap') === 'bitmap' && (
                  <div className="property-item">
                    <label>{t('Render Mode')}</label>
                    <PropertyEditor
                      type="select"
                      value={(component.data as any)?.renderMode || '4'}
                      onChange={(value) => handleDataChange('renderMode', value)}
                      options={[
                        { value: '1', label: '1 (1 bpp)' },
                        { value: '2', label: '2 (2 bpp)' },
                        { value: '4', label: '4 (4 bpp)' },
                        { value: '8', label: '8 (8 bpp)' },
                      ]}
                    />
                  </div>
                )}
                {/* 像素序 - 仅 LVGL 项目且定义了 renderMode 属性且点阵字体时显示 */}
                {isLvglProject && definition.properties.some(p => p.name === 'renderMode') && ((component.data as any)?.fontType || 'bitmap') === 'bitmap' && (
                  <div className="property-item">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{t('Pixel Order')} <HelpIcon title={t('Bit order for glyph bitmap')} /></label>
                    <PropertyEditor
                      type="select"
                      value={(component.data as any)?.pixelOrder || 'LSB'}
                      onChange={(value) => handleDataChange('pixelOrder', value)}
                      options={[
                        { value: 'LSB', label: 'LSB (Least Significant Bit first)' },
                        { value: 'MSB', label: 'MSB (Most Significant Bit first)' },
                      ]}
                    />
                  </div>
                )}
                {/* 附加字符集 - 仅定义了 fontType 属性的控件显示（label 系列） */}
                {definition.properties.some(p => p.name === 'fontType') && (
                <div className="property-item">
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {t('Additional Character Sets')}
                    <HelpIcon title={charsetHelpText} />
                  </label>
                  <div style={{ marginTop: '4px' }}>
                    {renderCharacterSets()}
                  </div>
                </div>
                )}
              </CollapsibleGroup>
            )}

            {/* Timer Properties - 仅对 hg_timer_label 显示 */}
            {definition && component.type === 'hg_timer_label' && definition.properties.filter(p => p.group === 'timer').length > 0 && (
              <CollapsibleGroup title={t('Advanced')} defaultCollapsed={true}>
                {/* 计时器类型 */}
                <div className="property-item">
                  <label>{t('Timer Type')}</label>
                  <PropertyEditor
                    type="select"
                    value={(component.data as any)?.timerType || 'stopwatch'}
                    onChange={(value) => handleDataChange('timerType', value)}
                    options={[
                      { value: 'stopwatch', label: t('Stopwatch') },
                      { value: 'countdown', label: t('Countdown') },
                    ]}
                  />
                </div>
                {/* 显示格式 */}
                <div className="property-item">
                  <label>{t('Display Format')}</label>
                  <PropertyEditor
                    type="select"
                    value={(component.data as any)?.timerFormat || 'HH:MM:SS'}
                    onChange={(value) => handleDataChange('timerFormat', value)}
                    options={['HH:MM:SS', 'MM:SS', 'MM:SS:MS', 'SS']}
                  />
                </div>
                {/* 初始值 */}
                <div className="property-item">
                  <label>{t('Initial Value (ms)')}</label>
                  <PropertyEditor
                    type="number"
                    value={(component.data as any)?.timerInitialValue || 0}
                    onChange={(value) => handleDataChange('timerInitialValue', value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                    {t('Timer value in milliseconds')}
                  </span>
                </div>
                {/* 自动启动 */}
                <div className="property-item">
                  <label>{t('Auto Start')}</label>
                  <PropertyEditor
                    type="boolean"
                    value={(component.data as any)?.timerAutoStart !== false}
                    onChange={(value) => handleDataChange('timerAutoStart', value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                    {t('Start timer automatically on load')}
                  </span>
                </div>
              </CollapsibleGroup>
            )}

            {/* Time Properties - 对 hg_time_label 显示 */}
            {definition && component.type === 'hg_time_label' && definition.properties.filter(p => p.group === 'time').length > 0 && (
              <CollapsibleGroup title={t('Advanced')} defaultCollapsed={true}>
                {/* 显示格式 */}
                <div className="property-item">
                  <label>{t('Display Format')}</label>
                  <PropertyEditor
                    type="select"
                    value={(component.data as any)?.timeFormat || 'HH:mm:ss'}
                    onChange={(value) => handleDataChange('timeFormat', value)}
                    options={['HH:mm:ss', 'HH:mm', 'HH', 'mm', 'HH:mm-split', 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'MM-DD HH:mm']}
                  />
                </div>
              </CollapsibleGroup>
            )}
          </>
        )}

        {activeTab === 'events' && (
          <EventsPanel component={component} onUpdate={onUpdate} />
        )}
      </div>
    </>
  );
};
