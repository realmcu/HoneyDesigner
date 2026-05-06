import React, { useRef, useState, useEffect } from 'react';
import { PropertyEditorProps } from './types';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  marginTop: '4px',
  backgroundColor: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-input-border)',
  borderRadius: '2px',
};

export const PropertyEditor: React.FC<PropertyEditorProps> = ({
  type,
  value,
  onChange,
  options,
  disabled,
  title,
  hint,
  min,
  max,
  step,
  placeholder
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const colorTextRef = useRef<HTMLInputElement>(null);
  const disabledStyle = disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {};

  // text 类型使用本地 state 缓冲，避免受控输入在 store 更新时丢失空格
  const [localText, setLocalText] = useState<string>(value ?? '');
  const isComposingRef = useRef(false); // 处理中文输入法

  // number 类型使用本地 state 缓冲：空值时不立即触发保存，失焦时才提交
  const [localNumber, setLocalNumber] = useState<string>(
    value !== undefined && value !== null && value !== '' ? String(value) : ''
  );

  // 外部 value 变化时同步本地 state（仅在非编辑状态下同步）
  const isFocusedRef = useRef(false);
  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalText(value ?? '');
      setLocalNumber(value !== undefined && value !== null && value !== '' ? String(value) : '');
    }
  }, [value]);

  // 辅助函数：标准化颜色值为 6 位 RGB 格式
  const normalizeColor = (color: string): string => {
    if (!color || !color.startsWith('#')) return color;
    const hex = color.slice(1).toUpperCase();
    
    // 8 位 RGBA -> 6 位 RGB（去掉 Alpha 通道）
    if (hex.length === 8) {
      return '#' + hex.slice(0, 6);
    }
    
    // 3 位 RGB -> 6 位 RGB
    if (hex.length === 3) {
      return '#' + hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    
    // 6 位 RGB 保持不变
    if (hex.length === 6) {
      return '#' + hex;
    }
    
    return color;
  };

  switch (type) {
    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          style={{ marginTop: '4px' }}
        />
      );

    case 'number':
      return (
        <input
          ref={inputRef}
          type="number"
          value={localNumber}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          onChange={(e) => {
            const val = e.target.value;
            setLocalNumber(val);
            // 空值或仅输入负号时，不触发保存，等待失焦时再提交
            if (val === '' || val === '-') {
              return;
            }
            let num = parseFloat(val);
            if (!isNaN(num)) {
              if (min !== undefined && num < min) num = min;
              if (max !== undefined && num > max) num = max;
              onChange(num);
            }
          }}
          onBlur={(e) => {
            isFocusedRef.current = false;
            let val = parseFloat(e.target.value);
            // 空值或无效值，使用 min（如有）或 0 作为默认值
            if (isNaN(val) || e.target.value === '') {
              val = min !== undefined ? min : 0;
            }
            if (min !== undefined && val < min) val = min;
            if (max !== undefined && val > max) val = max;
            setLocalNumber(String(val));
            onChange(val);
          }}
          onFocus={(e) => {
            isFocusedRef.current = true;
            e.target.select();
          }}
          disabled={disabled}
          title={title}
          style={{ ...inputStyle, ...disabledStyle }}
        />
      );

    case 'color':
      return (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="color"
              value={normalizeColor(value || '#000000')}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              style={{ width: '30px', height: '30px', padding: 0, border: 'none' }}
            />
            <input
              ref={colorTextRef}
              type="text"
              value={value || ''}
              onChange={(e) => {
                const input = e.target.value;
                // 允许空值或正在输入 # 开头
                if (input === '' || input === '#') {
                  onChange(input);
                  return;
                }
                // 验证格式：# + 最多6位十六进制字符
                if (/^#[0-9A-Fa-f]{0,6}$/.test(input)) {
                  onChange(input.toUpperCase());
                }
                // 如果输入超过7位（# + 6位），截断为7位
                else if (input.startsWith('#') && input.length > 7) {
                  onChange(input.slice(0, 7).toUpperCase());
                }
              }}
              onBlur={(e) => {
                // 失焦时自动标准化为 6 位 RGB 格式
                const normalized = normalizeColor(e.target.value);
                if (normalized !== e.target.value) {
                  onChange(normalized);
                }
              }}
              disabled={disabled}
              placeholder="#RRGGBB"
              maxLength={7}
              style={{ ...inputStyle, flex: 1, ...disabledStyle }}
            />
          </div>
          {hint && (
            <div style={{
              fontSize: '10px',
              color: 'var(--vscode-descriptionForeground)',
              marginTop: '4px',
              lineHeight: '1.4'
            }}>
              💡 {hint}
            </div>
          )}
        </div>
      );

    case 'select':
      return (
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={{ ...inputStyle, ...disabledStyle }}
        >
          {options?.map((option: string | { value: string; label: string }) => {
            const optionValue = typeof option === 'string' ? option : option.value;
            const optionLabel = typeof option === 'string' ? option : option.label;
            return (
              <option key={optionValue} value={optionValue}>
                {optionLabel}
              </option>
            );
          })}
        </select>
      );

    default:
      return (
        <input
          ref={inputRef}
          type="text"
          value={localText}
          placeholder={placeholder}
          onChange={(e) => {
            setLocalText(e.target.value);
            // 非输入法组合状态下实时提交（保证画布预览同步）
            if (!isComposingRef.current) {
              onChange(e.target.value);
            }
          }}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            onChange((e.target as HTMLInputElement).value);
          }}
          onFocus={() => { isFocusedRef.current = true; }}
          onBlur={(e) => {
            isFocusedRef.current = false;
            onChange(e.target.value);
          }}
          disabled={disabled}
          title={title}
          style={{ ...inputStyle, ...disabledStyle }}
        />
      );
  }
};
