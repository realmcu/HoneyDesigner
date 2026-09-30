/**
 * Allow wheel to change focused number input values while preventing page scroll.
 * Shared by the VS Code webview entry and the browser build entry.
 */
export function installNumberInputWheel(): void {
  document.addEventListener('wheel', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.tagName === 'INPUT' && target.type === 'number' && document.activeElement === target) {
      e.preventDefault();
      const step = parseFloat(target.step) || 1;
      const currentVal = parseFloat(target.value) || 0;
      const delta = e.deltaY < 0 ? step : -step;
      let newVal = currentVal + delta;
      if (target.min !== '') newVal = Math.max(newVal, parseFloat(target.min));
      if (target.max !== '') newVal = Math.min(newVal, parseFloat(target.max));
      const decimals = (target.step && target.step.includes('.'))
        ? target.step.split('.')[1].length : 0;
      // Use native setter to bypass React's value tracker, then dispatch input event
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(target, newVal.toFixed(decimals));
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, { passive: false });
}
