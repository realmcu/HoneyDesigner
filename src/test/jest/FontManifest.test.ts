/**
 * 字体转换清单：桌面版用它判断「上次转换是否已覆盖当前需求」。
 * 关键在于覆盖范围按码点比较而非按 HML 修改时间，因此删除控件、改坐标不会触发重转，
 * 只有新码点、更大字号或输入文件变化才失效。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FontManifest, loadFontManifest, manifestCovers, saveFontManifest } from '../../simulation/FontManifest';

const codes = (s: string): number[] => Array.from(s).map(ch => ch.codePointAt(0)!);

describe('FontManifest', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-manifest-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const manifestWith = (chars: string, precision = 0, fingerprint = 'fp'): FontManifest => ({
    version: 1,
    groups: { '/f.ttf|vector': { fingerprint, chars, precision } },
  });

  it('round-trips through disk and treats a missing file as empty', () => {
    expect(loadFontManifest(dir).groups).toEqual({});
    saveFontManifest(dir, manifestWith('abc', 24));
    expect(loadFontManifest(dir).groups['/f.ttf|vector']).toEqual({ fingerprint: 'fp', chars: 'abc', precision: 24 });
  });

  it('falls back to an empty manifest when the file is corrupt', () => {
    fs.writeFileSync(path.join(dir, 'font-manifest.json'), '{ not json', 'utf-8');
    expect(loadFontManifest(dir).groups).toEqual({});
  });

  it('covers a subset of converted characters', () => {
    const manifest = manifestWith('abcdef');
    expect(manifestCovers(manifest, '/f.ttf|vector', 'fp', codes('cab'), 0)).toBe(true);
    expect(manifestCovers(manifest, '/f.ttf|vector', 'fp', codes('xyz'), 0)).toBe(false);
  });

  it('rejects a changed fingerprint or a missing group', () => {
    const manifest = manifestWith('abcdef');
    expect(manifestCovers(manifest, '/f.ttf|vector', 'other', codes('a'), 0)).toBe(false);
    expect(manifestCovers(manifest, '/g.ttf|vector', 'fp', codes('a'), 0)).toBe(false);
  });

  it('rejects a malformed entry instead of throwing', () => {
    const broken = { version: 1, groups: { '/f.ttf|vector': { fingerprint: 'fp', chars: 5 } } } as unknown as FontManifest;
    expect(manifestCovers(broken, '/f.ttf|vector', 'fp', codes('a'), 0)).toBe(false);
    const missingChars = { version: 1, groups: { '/f.ttf|vector': { fingerprint: 'fp' } } } as unknown as FontManifest;
    expect(manifestCovers(missingChars, '/f.ttf|vector', 'fp', codes('a'), 0)).toBe(false);
  });

  it('treats vector precision as a lower bound', () => {
    const manifest = manifestWith('abcdef', 24);
    expect(manifestCovers(manifest, '/f.ttf|vector', 'fp', codes('a'), 20)).toBe(true);
    expect(manifestCovers(manifest, '/f.ttf|vector', 'fp', codes('a'), 24)).toBe(true);
    expect(manifestCovers(manifest, '/f.ttf|vector', 'fp', codes('a'), 48)).toBe(false);
  });

  it('handles characters outside the BMP', () => {
    const manifest = manifestWith('a😀');
    expect(manifestCovers(manifest, '/f.ttf|vector', 'fp', codes('😀'), 0)).toBe(true);
    expect(manifestCovers(manifest, '/f.ttf|vector', 'fp', codes('b'), 0)).toBe(false);
  });
});
