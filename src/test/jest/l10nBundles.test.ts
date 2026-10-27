/**
 * l10n bundle 守护测试：key 一致性、占位符一致性，以及仿真编译链路文件不再残留中文字面量。
 *
 * `CJK_FREE_FILES` 是迁移进度清单，每完成一个文件就把它追加进来。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const ROOT = path.resolve(__dirname, '../../..');
const EN_BUNDLE = 'l10n/bundle.l10n.json';
const ZH_BUNDLE = 'l10n/bundle.l10n.zh-cn.json';
const KEY_LINE = /^\s*("(?:[^"\\]|\\.)*")\s*:/gm;
const CJK = /[一-鿿　-〿＀-￯]/;

/** 已迁移、不允许再出现中文字面量的文件（仓库相对路径）。 */
export const CJK_FREE_FILES: string[] = [
    'src/simulation/BuildManager.ts',
    'src/simulation/SConstructTemplate.ts',
    'src/simulation/DependencyInstaller.ts',
    'src/simulation/EnvironmentChecker.ts',
    'src/simulation/BuildCore.ts',
    'src/simulation/SimulationRunner.ts',
    'src/services/CodeGenerator.ts',
    'src/services/GlassConverterService.ts',
    'src/services/Model3DConverterService.ts',
    'src/services/ConversionConfigService.ts',
];

function readJson(rel: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function rawKeyLines(rel: string): Array<{ key: string; line: number }> {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
  const found: Array<{ key: string; line: number }> = [];
  lines.forEach((text, index) => {
    const re = new RegExp(KEY_LINE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      found.push({ key: JSON.parse(match[1]), line: index + 1 });
    }
  });
  return found;
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSources(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function literalTexts(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
  }
  return [];
}

function placeholders(value: string): string {
  return (value.match(/\{\d+\}/g) || []).sort().join(',');
}

describe('l10n bundles', () => {
  it('has no duplicate keys in raw bundle text', () => {
    const duplicates: string[] = [];
    for (const rel of [EN_BUNDLE, ZH_BUNDLE]) {
      const seen = new Set<string>();
      for (const { key, line } of rawKeyLines(rel)) {
        if (seen.has(key)) {
          duplicates.push(`${rel}:${line} ${JSON.stringify(key)}`);
        }
        seen.add(key);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('en and zh-cn have identical key sets', () => {
    const en = readJson(EN_BUNDLE);
    const zh = readJson(ZH_BUNDLE);
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it('zh-cn values keep the placeholders of their keys', () => {
    const zh = readJson(ZH_BUNDLE);
    const mismatched = Object.keys(zh)
      .filter(key => placeholders(key) !== placeholders(zh[key]))
      .map(key => `${JSON.stringify(key)} expects [${placeholders(key)}] but zh-cn has [${placeholders(zh[key])}]`);
    expect(mismatched).toEqual([]);
  });

  it('every literal vscode.l10n.t key exists in both bundles', () => {
    const en = readJson(EN_BUNDLE);
    const zh = readJson(ZH_BUNDLE);
    const missingInEn: string[] = [];
    const missingInZh: string[] = [];

    for (const file of walkSources(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (rel.startsWith('src/webview/') || rel.startsWith('src/test/')) {
        continue;
      }
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && /(^|\.)l10n\.t$/.test(node.expression.getText(source))) {
          const arg = node.arguments[0];
          if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
            const where = `${rel}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
            if (!(arg.text in en)) {
              missingInEn.push(`${where} ${JSON.stringify(arg.text)}`);
            }
            if (!(arg.text in zh)) {
              missingInZh.push(`${where} ${JSON.stringify(arg.text)}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(missingInEn).toEqual([]);
    expect(missingInZh).toEqual([]);
  });
});

describe('simulation log sources', () => {
  it('contain no CJK string literals', () => {
    const hits: string[] = [];
    for (const rel of CJK_FREE_FILES) {
      const file = path.join(ROOT, rel);
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (literalTexts(node).some(text => CJK.test(text))) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          hits.push(`${rel}:${line} ${node.getText(source).slice(0, 80)}`);
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(hits).toEqual([]);
  });
});
