function isInRange(codePoint: number, start: number, end: number): boolean {
    return codePoint >= start && codePoint <= end;
}

function isCjkLike(codePoint: number): boolean {
    return (
        isInRange(codePoint, 0x2E80, 0x2EFF) ||
        isInRange(codePoint, 0x3000, 0x303F) ||
        isInRange(codePoint, 0x3040, 0x30FF) ||
        isInRange(codePoint, 0x31F0, 0x31FF) ||
        isInRange(codePoint, 0x3400, 0x4DBF) ||
        isInRange(codePoint, 0x4E00, 0x9FFF) ||
        isInRange(codePoint, 0xAC00, 0xD7AF) ||
        isInRange(codePoint, 0xF900, 0xFAFF) ||
        isInRange(codePoint, 0xFF00, 0xFFEF)
    );
}

export function estimateCharEmWidth(char: string): number {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
        return 0;
    }

    if (isCjkLike(codePoint)) {
        return 1.0;
    }

    if (/[A-Za-z]/.test(char)) {
        return 0.58;
    }

    if (/[0-9]/.test(char)) {
        return 0.56;
    }

    if (/\s/.test(char)) {
        return 0.33;
    }

    if (/[\.,:;!\?\-_'"\(\)\[\]{}\/\\]/.test(char)) {
        return 0.35;
    }

    return 0.7;
}

export function estimateTextEmWidth(text: string): number {
    let width = 0;
    for (const char of text) {
        width += estimateCharEmWidth(char);
    }
    return width;
}

export function estimateTextPixelWidth(text: string, fontSize: number, letterSpacing: number): number {
    const chars = Array.from(text);
    if (chars.length === 0) {
        return 0;
    }

    return estimateTextEmWidth(text) * fontSize + Math.max(0, chars.length - 1) * letterSpacing;
}
