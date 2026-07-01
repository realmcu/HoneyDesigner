export type TextScript =
    | 'Latin'
    | 'CJK'
    | 'Kana'
    | 'Hangul'
    | 'Cyrillic'
    | 'Greek'
    | 'Arabic'
    | 'Hebrew'
    | 'Devanagari';

function isInRange(codePoint: number, start: number, end: number): boolean {
    return codePoint >= start && codePoint <= end;
}

export function detectScripts(text: string): TextScript[] {
    const scripts = new Set<TextScript>();

    for (const char of text) {
        const codePoint = char.codePointAt(0);
        if (codePoint === undefined) {
            continue;
        }

        if ((codePoint >= 0x41 && codePoint <= 0x5A) || (codePoint >= 0x61 && codePoint <= 0x7A)) {
            scripts.add('Latin');
        } else if (isInRange(codePoint, 0x4E00, 0x9FFF) || isInRange(codePoint, 0x3400, 0x4DBF)) {
            scripts.add('CJK');
        } else if (isInRange(codePoint, 0x3040, 0x30FF) || isInRange(codePoint, 0x31F0, 0x31FF)) {
            scripts.add('Kana');
        } else if (isInRange(codePoint, 0xAC00, 0xD7AF) || isInRange(codePoint, 0x1100, 0x11FF)) {
            scripts.add('Hangul');
        } else if (isInRange(codePoint, 0x0400, 0x04FF)) {
            scripts.add('Cyrillic');
        } else if (isInRange(codePoint, 0x0370, 0x03FF)) {
            scripts.add('Greek');
        } else if (isInRange(codePoint, 0x0600, 0x06FF) || isInRange(codePoint, 0x0750, 0x077F)) {
            scripts.add('Arabic');
        } else if (isInRange(codePoint, 0x0590, 0x05FF)) {
            scripts.add('Hebrew');
        } else if (isInRange(codePoint, 0x0900, 0x097F)) {
            scripts.add('Devanagari');
        }
    }

    return Array.from(scripts);
}
