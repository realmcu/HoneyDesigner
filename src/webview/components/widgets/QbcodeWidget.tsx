import React, { useMemo } from 'react';
import { WidgetProps } from './types';
import qrcode from 'qrcode-generator';

/**
 * Generate QR code module matrix from content string
 */
function generateQrMatrix(content: string): boolean[][] {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(content || 'Hello, World!');
    qr.make();
    const count = qr.getModuleCount();
    const matrix: boolean[][] = [];
    for (let r = 0; r < count; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < count; c++) {
        row.push(qr.isDark(r, c));
      }
      matrix.push(row);
    }
    return matrix;
  } catch {
    // Fallback: return a simple 21x21 pattern if encoding fails
    return Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => false));
  }
}

/**
 * Encode content as Code 128 barcode bar pattern
 * Returns array of bar widths (alternating black/white starting with black)
 */
function generateCode128Bars(content: string): number[] {
  const data = content || 'Hello';

  // Code 128B character set (ASCII 32-127)
  const START_B = 104;
  const STOP = 106;

  const values: number[] = [START_B];
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (code >= 32 && code <= 127) {
      values.push(code - 32);
    }
  }

  // Calculate checksum
  let checksum = values[0];
  for (let i = 1; i < values.length; i++) {
    checksum += values[i] * i;
  }
  checksum = checksum % 103;
  values.push(checksum);
  values.push(STOP);

  // Code 128 encoding patterns (bar/space widths for each symbol value)
  const PATTERNS: number[][] = [
    [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],
    [1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
    [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],
    [1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
    [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],
    [3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
    [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],
    [1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
    [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],
    [1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
    [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],
    [3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
    [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],
    [1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],
    [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],
    [2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
    [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],
    [1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
    [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],
    [1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
    [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],
    [2,1,1,2,3,2],[2,3,3,1,1,1,2],
  ];

  const bars: number[] = [];
  for (const val of values) {
    if (val < PATTERNS.length) {
      bars.push(...PATTERNS[val]);
    }
  }

  return bars;
}

export const QbcodeWidget: React.FC<WidgetProps> = ({ component, style, handlers }) => {
  const width = component.position?.width ?? 200;
  const height = component.position?.height ?? 200;
  const codeType = component.data?.codeType ?? 'qrcode';
  const codeContent = String(component.data?.codeContent ?? 'Hello, World!');
  const borderSize = component.data?.borderSize ?? 2;

  const borderPx = Math.max(4, borderSize * 4);
  const innerW = Math.max(8, width - borderPx * 2);
  const innerH = Math.max(8, height - borderPx * 2);

  // Generate QR code matrix based on actual content
  const qrMatrix = useMemo(() => {
    if (codeType !== 'qrcode') { return []; }
    return generateQrMatrix(codeContent);
  }, [codeType, codeContent]);

  // Generate barcode bars based on actual content
  const barcodeBars = useMemo(() => {
    if (codeType !== 'barcode') { return []; }
    return generateCode128Bars(codeContent);
  }, [codeType, codeContent]);

  const renderQrCode = () => {
    if (qrMatrix.length === 0) { return null; }
    const cells = qrMatrix.length;
    const cellW = innerW / cells;
    const cellH = innerH / cells;
    return (
      <>
        {qrMatrix.map((row, r) =>
          row.map((dark, c) =>
            dark ? (
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
    if (barcodeBars.length === 0) { return null; }
    const totalUnits = barcodeBars.reduce((a, b) => a + b, 0);
    const unitW = innerW / totalUnits;
    let x = borderPx;
    return (
      <>
        {barcodeBars.map((w, i) => {
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
