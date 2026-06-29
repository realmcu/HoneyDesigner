import React, { useEffect, useRef, useState } from 'react';

/**
 * 受控数字输入框。
 *
 * 解决 React 受控 `<input type="number">` 的经典问题：用松散相等判断是否回写 DOM，
 * 导致用户敲出的前导零（如 050、0100）即便底层值正确（50/100）也无法被刷新清除，
 * 同时也避免清空输入时跳回 0 / 报 "received NaN" 警告、以及中间态（"-"、"."）被打断。
 *
 * 实现要点：
 * - 用本地 string state 暂存用户原始输入，输入过程中不强制改写文本（打字顺滑）。
 * - 输入过程中只要能解析为有限数就实时回传 onChange（保持实时预览）。
 * - onBlur 时统一归一化：去前导零、夹到 [min, max]、空值/非法值回退到 emptyValue。
 * - 用 type="text" + inputMode 而非 type="number"，绕开浏览器对数字输入框的归一化怪癖。
 */
export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** 当前数值（undefined / null 显示为空） */
  value: number | undefined | null;
  /** 解析出有限数值时回调 */
  onChange: (value: number) => void;
  /** 清空或非法输入失焦时回退到的值，默认 0 */
  emptyValue?: number;
  /** 最小值（失焦时夹取） */
  min?: number;
  /** 最大值（失焦时夹取） */
  max?: number;
  /** 是否只允许整数（失焦时取整），默认 false */
  integer?: boolean;
}

const toDisplay = (value: number | undefined | null): string =>
  value === undefined || value === null || Number.isNaN(value) ? '' : String(value);

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  emptyValue = 0,
  min,
  max,
  integer = false,
  onFocus,
  onBlur,
  ...rest
}) => {
  const [text, setText] = useState<string>(() => toDisplay(value));
  const focused = useRef(false);

  // 外部 value 变化时同步显示（聚焦中不打断用户输入）
  useEffect(() => {
    if (!focused.current) {
      setText(toDisplay(value));
    }
  }, [value]);

  const clamp = (n: number): number => {
    let v = integer ? Math.trunc(n) : n;
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    return v;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    // 中间态：空、单独负号或小数点，先不回传，等用户继续输入或失焦
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
      return;
    }
    const num = Number(raw);
    if (Number.isFinite(num)) {
      onChange(clamp(num));
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    focused.current = false;
    const num = Number(text);
    const normalized = text.trim() === '' || !Number.isFinite(num) ? emptyValue : clamp(num);
    setText(toDisplay(normalized));
    if (normalized !== value) {
      onChange(normalized);
    }
    onBlur?.(e);
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
};

export default NumberInput;
