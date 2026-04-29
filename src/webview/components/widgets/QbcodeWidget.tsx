import React from 'react';
import { WidgetProps } from './types';

// 21x21 finder pattern mask for QR code preview
function buildQrPattern(cells: number): number[][] {
  return Array.from({ length: cells }, (_, r) =>
    Array.from({ length: cells }, (_, c) => {
      const inFinder = (rr: number, cc: number) => {
        if (rr === 0 || rr === 6 || cc === 0 || cc === 6) return 1;
        if (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4) return 1;
        return 0;
      };

      // Top-left finder (rows 0-6, cols 0-6)
      if (r < 7 && c < 7) return inFinder(r, c);
      // Top-right finder (rows 0-6, cols 14-20)
      if (r < 7 && c >= cells - 7) return inFinder(r, c - (cells - 7));
      // Bottom-left finder (rows 14-20, cols 0-6)
      if (r >= cells - 7 && c < 7) return inFinder(r - (cells - 7), c);
      // Separator zones (row/col 7 adjacent to finders)
      if ((r === 7 || r === cells - 8) && c < 8) return 0;
      if (r < 8 && (c === 7 || c === cells - 8)) return 0;
      if (r >= cells - 8 && c === 7) return 0;
      // Timing patterns on row 6 and col 6
      if (r === 6 || c === 6) return (r + c) % 2 === 0 ? 1 : 0;
      // Dark module
      if (r === cells - 8 && c === 8) return 1;
      // Data cells: pseudo-random fill
      return ((r * 13 + c * 7) ^ (r ^ c)) % 3 === 0 ? 1 : 0;
    })
  );
}

const QR_CELLS = 21;
const QR_PATTERN = buildQrPattern(QR_CELLS);

// Barcode bar widths (alternating black/white in units)
const BARCODE_BARS = [3, 2, 1, 1, 1, 4, 1, 1, 1, 2, 3, 2, 1, 1, 1, 2, 1, 3, 1, 1, 2, 1, 1, 2, 3];

export const QbcodeWidget: React.FC<WidgetProps> = ({ component, style, handlers }) => {
  const width = component.position?.width ?? 200;
  const height = component.position?.height ?? 200;
  const codeType = component.data?.codeType ?? 'qrcode';
  const borderSize = component.data?.borderSize ?? 2;

  const borderPx = Math.max(4, borderSize * 4);
  const innerW = Math.max(8, width - borderPx * 2);
  const innerH = Math.max(8, height - borderPx * 2);

  const renderQrCode = () => {
    const cellW = innerW / QR_CELLS;
    const cellH = innerH / QR_CELLS;
    return (
      <>
        {QR_PATTERN.map((row, r) =>
          row.map((cell, c) =>
            cell ? (
              <rect
                key={`${r}-${c}`}
                x={borderPx + c * cellW}
                y={borderPx + r * cellH}
                width={Math.ceil(cellW)}
                height={Math.ceil(cellH)}
                fill="black"
              />
            ) : null
          )
        )}
      </>
    );
  };

  const renderBarcode = () => {
    const totalUnits = BARCODE_BARS.reduce((a, b) => a + b, 0);
    const unitW = innerW / totalUnits;
    let x = borderPx;
    return (
      <>
        {BARCODE_BARS.map((w, i) => {
          const barX = x;
          const barW = w * unitW;
          x += barW;
          return i % 2 === 0 ? (
            <rect key={i} x={barX} y={borderPx} width={barW} height={innerH} fill="black" />
          ) : null;
        })}
      </>
    );
  };

  return (
    <div style={{ ...style, overflow: 'hidden' }} {...handlers}>
      <svg width={width} height={height} style={{ display: 'block', background: 'white' }}>
        {codeType === 'barcode' ? renderBarcode() : renderQrCode()}
      </svg>
    </div>
  );
};
