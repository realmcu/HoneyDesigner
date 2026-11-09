/**
 * Protected area merger utility
 * Merges user code with generated code
 *
 * Recognized marker styles (both are preserved on regeneration):
 *   /* @protected start {name} *\/ ... /* @protected end {name} *\/
 *   /* USER CODE BEGIN {name} *\/ ... /* USER CODE END {name} *\/   (toggle button callbacks)
 */

import { logger } from '../../../utils/Logger';

interface MarkerStyle {
  begin: string;
  end: string;
}

const MARKER_STYLES: MarkerStyle[] = [
  { begin: '@protected start', end: '@protected end' },
  { begin: 'USER CODE BEGIN', end: 'USER CODE END' },
];

export class ProtectedAreaMerger {

  /**
   * Merge protected area code
   * @param existing Existing file content
   * @param generated Newly generated content
   * @returns Merged content
   */
  static merge(existing: string, generated: string): string {
    let result = generated;
    for (const style of MARKER_STYLES) {
      result = ProtectedAreaMerger.mergeStyle(existing, result, style);
    }
    return result;
  }

  private static mergeStyle(existing: string, generated: string, style: MarkerStyle): string {
    const protectedAreas = new Map<string, string>();

    // Extract protected areas from existing file (first occurrence wins on name conflict)
    const regex = new RegExp(`\\/\\* ${style.begin} (\\w+) \\*\\/([\\s\\S]*?)\\/\\* ${style.end} \\1 \\*\\/`, 'g');
    let match;

    while ((match = regex.exec(existing)) !== null) {
      if (!protectedAreas.has(match[1])) {
        protectedAreas.set(match[1], match[2]);
      }
    }

    // Replace protected areas in generated code
    let result = generated;
    protectedAreas.forEach((content, id) => {
      const pattern = new RegExp(
        `\\/\\* ${style.begin} ${id} \\*\\/[\\s\\S]*?\\/\\* ${style.end} ${id} \\*\\/`,
        'g'
      );
      if (pattern.test(result)) {
        pattern.lastIndex = 0;
        // Function replacer: user code may contain `$` sequences that must not be expanded
        result = result.replace(pattern, () => `/* ${style.begin} ${id} */${content}/* ${style.end} ${id} */`);
      } else if (content.trim() !== '') {
        logger.warn(`[ProtectedAreaMerger] Protected area "${id}" no longer exists in generated output; its user code was dropped. Check if the component or event was removed.`);
      }
    });

    return result;
  }
}
