# HoneyGUI Designer I18n Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-level multilingual text authoring and PC preview switching to HoneyGUI Designer, with visible device-fidelity warnings for missing glyphs, missing character sets, and likely text overflow.

**Architecture:** Follow the mainstream localization model used by Android, Apple, Qt, Flutter, and design tools: controls bind to stable string keys; translations live in a project string catalog; Designer resolves the current preview locale at render time; the HML `text` attribute remains the fallback and current codegen-compatible value. Because the Webview canvas can fall back to system fonts while firmware cannot, glyph/charset/overflow diagnostics are treated as first-class preview output, not secondary hints. Runtime firmware language switching is a later phase.

**Tech Stack:** TypeScript, VS Code extension API, React Webview, Zustand store, existing HoneyGUI Designer HML parser/serializer, existing `hg_label` widget/property infrastructure, existing HTTP validation API, `ts-node` smoke tests for new pure logic.

---

## Scope

Source repo:

- `F:\sourcecode\HoneyGui\honeygui-design`

Acceptance project:

- `F:\HoneyGUI\honeygui_designer_ui\Smartwatch_360_360`
- Acceptance screen: `ui/alone_select_mode_view.hml`
- Acceptance controls: `asm_scan_text`, `asm_skip_text`

This phase includes:

- Project file `i18n/strings.json`.
- HML attribute `i18nKey` on text-capable controls, starting with `hg_label`.
- Designer toolbar preview-locale selector.
- Minimal locale/key management: add locale, key autocomplete, and unused-key warnings.
- Properties panel editing for key, default-locale text, and current-locale text.
- Canvas preview resolution from selected locale.
- Device-fidelity diagnostics for missing glyphs, missing charset coverage, and likely overflow.
- Validation warnings for missing keys/translations.
- HML spec sync in both human docs and AI-agent skill docs.
- V202S fixture.

This phase excludes:

- Firmware runtime language switching.
- Generated C language tables.
- Automatic translation.
- RTL layout mirroring.
- ICU plural/message formatting.
- Full catalog management UI for rename/delete/merge keys. Add locale and key autocomplete are included; destructive catalog operations are not.

## Data Contract

Catalog path, relative to project root:

```text
i18n/strings.json
```

Catalog format:

```json
{
  "version": 1,
  "defaultLocale": "en-US",
  "locales": ["en-US", "zh-CN"],
  "strings": {
    "pairing.scan_code": {
      "en-US": "Scan code pairing",
      "zh-CN": "扫码配对"
    }
  }
}
```

HML usage:

```xml
<hg_label
  id="asm_scan_text"
  text="Scan code pairing"
  i18nKey="pairing.scan_code"
  fontFile="/font/Arial.ttf"
  fontSize="22" />
```

Preview resolution order:

1. `catalog.strings[i18nKey][previewLocale]`
2. `catalog.strings[i18nKey][catalog.defaultLocale]`
3. `component.data.text`
4. `component.name`

Source-of-truth rule for label text editing:

- Without `i18nKey`, `Display Text` edits `component.data.text` exactly as today.
- With `i18nKey`, `Default Locale Text` becomes the editable source for both `catalog.strings[key][defaultLocale]` and `component.data.text`.
- With `i18nKey`, `Display Text` is shown as read-only `Fallback Text (codegen)` to avoid three editable text fields disagreeing.
- `Current Locale Text` edits only `catalog.strings[key][previewLocale]`.

## Implementation Tasks

### Task 1: Add Project I18n Core and Tests

**Files:**

- Create: `src/project-i18n/types.ts`
- Create: `src/project-i18n/catalog.ts`
- Create: `src/project-i18n/files.ts`
- Create: `scripts/test-project-i18n.ts`
- Modify: `package.json`

- [ ] Create `I18nCatalog`, `LocaleCode`, `I18nKey`, `LocalizedTextResolution`, and `I18nDiagnostic` types in `src/project-i18n/types.ts`.
- [ ] Implement pure helpers in `src/project-i18n/catalog.ts`:
  - `createEmptyCatalog(defaultLocale: LocaleCode): I18nCatalog`
  - `normalizeCatalog(input: unknown, defaultLocale: LocaleCode): I18nCatalog`
  - `ensureLocale(catalog: I18nCatalog, locale: LocaleCode): I18nCatalog`
  - `setTranslation(catalog: I18nCatalog, key: I18nKey, locale: LocaleCode, text: string): I18nCatalog`
  - `listI18nKeys(catalog: I18nCatalog): string[]`
  - `findUnusedKeys(catalog: I18nCatalog, referencedKeys: Set<string>): string[]`
  - `resolveLocalizedText(catalog, key, previewLocale, fallbackText, fallbackName?): LocalizedTextResolution`
  - `validateCatalog(catalog): I18nDiagnostic[]`
- [ ] Implement file helpers in `src/project-i18n/files.ts`:
  - `loadProjectI18nCatalog(projectRoot: string): I18nCatalog`
  - `saveProjectI18nCatalog(projectRoot: string, catalog: I18nCatalog): void`
- [ ] Default missing catalogs to `en-US` and do not create `i18n/strings.json` until the user edits catalog content.
- [ ] Serialize catalog JSON with `JSON.stringify(catalog, null, 2) + '\n'`.
- [ ] Create `scripts/test-project-i18n.ts` using Node `assert`. It must cover:
  - current-locale resolution
  - default-locale fallback
  - `component.data.text` fallback
  - malformed catalog normalization
  - locale insertion without duplicates
  - unused-key detection
- [ ] Add a root `package.json` script:

```json
"test:project-i18n": "ts-node scripts/test-project-i18n.ts"
```

Verification:

```powershell
npm run test:project-i18n
npm run compile
```

Expected:

- `test:project-i18n` exits 0.
- TypeScript compile passes.

### Task 2: Preserve `i18nKey` in HML

**Files:**

- Modify: `src/hml/types.ts`
- Modify: `src/hml/HmlParser.ts`
- Existing behavior: `src/hml/HmlSerializer.ts`

- [ ] Add `i18nKey?: string` to `ComponentData` in `src/hml/types.ts`.
- [ ] Add `i18nKey` to `dataProps` in `src/hml/HmlParser.ts` near `text`, `fontFile`, `timeFormat`, `fontType`, `renderMode`, `fontSize`, and `characterSets`.
- [ ] Keep `i18nKey` trimmed by leaving it out of `TEXT_PROPS`; only `text` and `placeholder` preserve leading/trailing spaces.
- [ ] Confirm `src/hml/HmlSerializer.ts` needs no special case because it already serializes non-empty `component.data` fields.
- [ ] Confirm saving a label with `data.i18nKey = 'pairing.scan_code'` writes `i18nKey="pairing.scan_code"` and keeps `text="Scan code pairing"`.

Verification:

```powershell
npm run compile
```

Expected: TypeScript compile passes and no serializer error is introduced.

### Task 3: Load and Save Catalog Through Extension/Webview

**Files:**

- Modify: `src/designer/FileManager.ts`
- Modify: `src/designer/MessageHandler.ts`
- Modify: `src/webview/types.ts`
- Modify: `src/webview/store.ts`
- Modify: `src/webview/App.tsx`

- [ ] In `FileManager.sendLoadHmlMessage`, find `projectRoot` as it already does, load `projectI18nCatalog` via `loadProjectI18nCatalog(projectRoot)`, and include it in the `loadHml` message.
- [ ] In `FileManager.createNewDocument`, include an empty `projectI18nCatalog`.
- [ ] Add a `saveProjectI18nCatalog` message in `MessageHandler.ts`. It must:
  - Use `ProjectUtils.findProjectRoot(currentFilePath)`.
  - Validate and normalize the payload.
  - Save `i18n/strings.json`.
  - Post `projectI18nCatalogSaved` back to the Webview with the normalized catalog.
- [ ] Add Webview message types for `projectI18nCatalog`, `previewLocale`, and `saveProjectI18nCatalog`.
- [ ] Add store state in `src/webview/store.ts`:
  - `projectI18nCatalog`
  - `previewLocale`
  - `setProjectI18nCatalog`
  - `setPreviewLocale`
  - `updateProjectI18nCatalog`
  - `saveProjectI18nCatalog`
- [ ] Debounce catalog saves in the Webview store at 400 ms and flush on blur/unmount, so typing Chinese/Japanese/Korean text does not write `strings.json` on every IME edit.
- [ ] When receiving `projectI18nCatalogSaved`, replace the in-memory catalog with the normalized payload to reduce stale-copy drift.
- [ ] Initialize `previewLocale` from saved Webview state when valid, otherwise from `projectI18nCatalog.defaultLocale`.
- [ ] In `App.tsx`, when handling `loadHml`, batch update `projectI18nCatalog` and `previewLocale` alongside `projectConfig`, `components`, and `currentFilePath`.
- [ ] In `App.tsx`, handle `projectI18nCatalogSaved` without forcing an HML reload.
- [ ] Keep Designer UI language (`src/webview/i18n`) separate from project preview language. Do not reuse `setLocale` for content preview.

Verification:

```powershell
npm run compile
npm run build:webview
```

Expected: Extension and Webview builds pass.

### Task 4: Add Preview Locale Selector and Minimal Catalog Management

**Files:**

- Create: `src/webview/components/ProjectI18nLocaleSelect.tsx`
- Modify: `src/webview/components/Toolbar.tsx`
- Modify: `src/webview/components/Toolbar.css`
- Modify: `src/webview/i18n/locales/en.ts`
- Modify: `src/webview/i18n/locales/zh-cn.ts`

- [ ] Build a compact select control with label `Preview Language`.
- [ ] Read locale options from `useDesignerStore().projectI18nCatalog.locales`.
- [ ] Bind selected value to `useDesignerStore().previewLocale`.
- [ ] Persist preview-locale changes through `setPreviewLocale`, not through catalog save.
- [ ] Add an `Add Locale` command in the selector dropdown:
  - Prompt for a BCP-47-like value such as `ja-JP`.
  - Trim spaces.
  - Reject empty values.
  - Reject duplicates.
  - Add the locale through `ensureLocale`.
  - Save the catalog through the debounced catalog save path.
- [ ] Place the control in `Toolbar.tsx` near simulation/preview controls, before the right-side action buttons.
- [ ] Add CSS matching current toolbar density: fixed height, no oversized text, no card styling.
- [ ] Add translations for Designer UI labels:
  - `Preview Language`
  - `Add Locale`
  - `Default Locale`
  - `Missing Translation`
  - `Unused I18n Key`

Verification:

```powershell
npm run compile
npm run build:webview
```

Expected: Builds pass and toolbar layout remains stable.

### Task 5: Add Properties Panel Editing Without Text Source Ambiguity

**Files:**

- Modify: `src/webview/components/ComponentLibrary.tsx`
- Modify: `src/webview/components/properties/DefaultProperties.tsx`
- Modify: `src/webview/i18n/locales/en.ts`
- Modify: `src/webview/i18n/locales/zh-cn.ts`

- [ ] Add `i18nKey` as a data property to `hg_label` in `ComponentLibrary.tsx`.
- [ ] Do not add `i18nKey` to non-text controls in this phase.
- [ ] In `DefaultProperties.tsx`, detect text-localizable components with `component.type === 'hg_label'`.
- [ ] Without `i18nKey`, keep the existing editable `Display Text` behavior exactly as today.
- [ ] With `i18nKey`, show `Display Text` as read-only `Fallback Text (codegen)` and explain through tooltip that it is synced from the default-locale text.
- [ ] Add a `Localized Key` input bound to `component.data.i18nKey` through `handleDataChange('i18nKey', value.trim())`.
- [ ] Add key autocomplete from `listI18nKeys(projectI18nCatalog)`.
- [ ] When user first enters an `i18nKey`, seed default-locale translation from `component.data.text` if missing.
- [ ] Add a `Default Locale Text` input:
  - Disabled when `i18nKey` is empty.
  - Value comes from `projectI18nCatalog.strings[i18nKey][defaultLocale] ?? component.data.text ?? ''`.
  - On change, update `catalog.strings[i18nKey][defaultLocale]`.
  - On change, also update `component.data.text` to the same value so firmware fallback and default-locale preview cannot drift.
- [ ] Add a `Current Locale Text` input:
  - Disabled when `i18nKey` is empty.
  - Hidden when `previewLocale === defaultLocale`; in that case the default-locale input is the active editor.
  - Value comes from `projectI18nCatalog.strings[i18nKey][previewLocale] ?? ''`.
  - On change, clone catalog, update current-locale translation, update store, and post `saveProjectI18nCatalog`.
- [ ] Display visible warnings when:
  - current locale is missing and preview is falling back.
  - typed key does not exist yet.
  - catalog contains keys not referenced by any loaded HML component.
- [ ] Keep existing font picker, `characterSets`, glyph stats, scrolling controls, and line-break controls unchanged except where Task 7 switches glyph stats to resolved preview text.

Verification:

```powershell
npm run compile
npm run build:webview
```

Expected:

- Builds pass.
- Existing labels without `i18nKey` still edit `Display Text`.
- Labels with `i18nKey` have exactly one editable default/fallback source.

### Task 6: Resolve Localized Text and Improve Preview Measurement

**Files:**

- Create: `src/project-i18n/textMetrics.ts`
- Modify: `src/webview/components/widgets/LabelWidget.tsx`
- Modify: `src/webview/hooks/useFontGlyphStats.ts` only if its API must accept resolved text.
- Modify: `scripts/test-project-i18n.ts`

- [ ] Import `useDesignerStore` and `resolveLocalizedText` in `LabelWidget.tsx`.
- [ ] Resolve label display text from `component.data.i18nKey`, `projectI18nCatalog`, and `previewLocale`.
- [ ] Preserve split-time behavior: if `timeFormat === 'HH:mm-split'` and no explicit text/i18n translation exists, use `12:34`.
- [ ] Create `src/project-i18n/textMetrics.ts` with:
  - `estimateCharEmWidth(char: string): number`
  - `estimateTextEmWidth(text: string): number`
  - `estimateTextPixelWidth(text: string, fontSize: number, letterSpacing: number): number`
- [ ] Use script-aware widths:
  - CJK/Kana/Hangul full-width characters: `1.0em`
  - Latin uppercase/lowercase: `0.58em`
  - Digits: `0.56em`
  - Spaces: `0.33em`
  - Common punctuation: `0.35em`
  - Fallback: `0.7em`
- [ ] Replace the existing `text.length * fontSize * 0.6` estimate in `LabelWidget.tsx` with `estimateTextPixelWidth`.
- [ ] Use the improved estimate for scroll distance, word-wrap height estimate, and overflow warning calculation.
- [ ] Pass resolved text to:
  - `useFontGlyphCheck`
  - scrolling text width/height estimate
  - rendered `<span>`
  - split-time renderer
- [ ] Do not mutate `component.data.text` when switching preview locale.
- [ ] Keep canvas fallback to `component.name` when no text is available.
- [ ] Extend `scripts/test-project-i18n.ts` to assert that `estimateTextEmWidth('扫码配对')` is greater than `estimateTextEmWidth('Scan')`.

Verification:

```powershell
npm run test:project-i18n
npm run compile
npm run build:webview
```

Expected:

- I18n tests pass.
- Builds pass.
- CJK and long German preview text produce more realistic width/overflow behavior than the old `0.6` constant.

### Task 7: Make Device-Fidelity Diagnostics First-Class

**Files:**

- Create: `src/project-i18n/script.ts`
- Modify: `src/webview/components/properties/DefaultProperties.tsx`
- Modify: `src/webview/components/widgets/LabelWidget.tsx`
- Modify: `src/webview/components/DesignerCanvas.css`
- Modify: `src/webview/components/PropertiesPanel.css`
- Modify: `scripts/test-project-i18n.ts`

- [ ] Add `detectScripts(text: string)` for Latin, CJK, Kana, Hangul, Cyrillic, Greek, Arabic, Hebrew, and Devanagari ranges.
- [ ] Use resolved preview text, not only fallback `component.data.text`, for glyph checks in `LabelWidget.tsx`.
- [ ] In `DefaultProperties.tsx`, pass resolved preview text to `useFontGlyphStats`.
- [ ] Show missing-glyph status as a visible warning badge in both:
  - the selected label on canvas
  - the Font group in the properties panel
- [ ] Show charset coverage warning in the Font group when `characterSets` does not cover all characters in the resolved preview text.
- [ ] Show likely-overflow warning when estimated text width exceeds component width and neither `wordWrap` nor `enableScroll` will make it visible.
- [ ] Show likely-wrap-height warning when word-wrapped estimated height exceeds component height.
- [ ] Warnings must use stronger visual priority than passive hints, but remain non-blocking for save/codegen.
- [ ] Do not automatically change `fontFile`; only recommend fonts available in the current project asset list.
- [ ] Extend `scripts/test-project-i18n.ts` to assert script detection for:
  - `Scan code pairing` -> Latin
  - `扫码配对` -> CJK
  - `コードをスキャン` -> Kana
  - `QR-Code koppeln` -> Latin

Verification:

```powershell
npm run test:project-i18n
npm run compile
npm run build:webview
```

Expected:

- Tests and builds pass.
- CJK text with a font lacking CJK glyphs produces a visible warning even if the browser can render it through system fallback.

### Task 8: Add Validation Warnings

**Files:**

- Modify: `src/services/HmlValidationService.ts`
- Modify: `src/services/ExtensionApiService.ts`

- [ ] Extend `ValidationWarning` to include:
  - `type: 'best-practice' | 'performance' | 'compatibility' | 'i18n'`
  - optional `attribute`
  - optional `locale`
  - optional `key`
- [ ] Add optional validation context to `HmlValidationService.validateHml`:
  - `projectRoot?: string`
  - `previewLocale?: string`
  - `i18nCatalog?: I18nCatalog`
- [ ] When no context is provided, validation remains exactly as today.
- [ ] If context has a catalog, warn when:
  - `hg_label.data.i18nKey` references a missing key.
  - current preview locale text is missing.
  - default locale text is missing.
  - `i18nKey` exists but `text` fallback is empty.
  - catalog contains unused keys after scanning all loaded components in the current HML.
- [ ] In `ExtensionApiService.handleValidateHml`, when request uses `filePath`, derive `projectRoot`, load catalog, and pass validation context.
- [ ] Keep all i18n diagnostics as warnings, not errors.
- [ ] Preserve response shape `{ success: true, data: result }`; `result.warnings` already exists.

Verification:

```powershell
npm run compile
```

Then, with the extension running:

```powershell
Invoke-RestMethod -Method Post http://localhost:38912/api/validate-hml `
  -ContentType 'application/json' `
  -Body '{"filePath":"F:\\HoneyGUI\\honeygui_designer_ui\\Smartwatch_360_360\\ui\\alone_select_mode_view.hml"}'
```

Expected: structural validation still works; i18n issues appear only in `data.warnings`.

### Task 9: Add V202S Acceptance Fixture

**Files:**

- Create: `F:\HoneyGUI\honeygui_designer_ui\Smartwatch_360_360\i18n\strings.json`
- Modify: `F:\HoneyGUI\honeygui_designer_ui\Smartwatch_360_360\ui\alone_select_mode_view.hml`

- [ ] Create `i18n/strings.json`:

```json
{
  "version": 1,
  "defaultLocale": "en-US",
  "locales": ["en-US", "zh-CN", "zh-TW", "de-DE"],
  "strings": {
    "pairing.scan_code": {
      "en-US": "Scan code pairing",
      "zh-CN": "扫码配对",
      "zh-TW": "掃碼配對",
      "de-DE": "QR-Code koppeln"
    },
    "pairing.skip": {
      "en-US": "Jump over",
      "zh-CN": "跳过",
      "zh-TW": "跳過",
      "de-DE": "Überspringen"
    }
  }
}
```

- [ ] Update `asm_scan_text`:

```xml
<hg_label id="asm_scan_text" ... text="Scan code pairing" i18nKey="pairing.scan_code" ... />
```

- [ ] Update `asm_skip_text`:

```xml
<hg_label id="asm_skip_text" ... text="Jump over" i18nKey="pairing.skip" ... />
```

- [ ] Preserve all existing geometry, colors, font settings, events, and z-order.
- [ ] Validate HML with the project validator:

```powershell
cd F:\HoneyGUI\honeygui_designer_ui\Smartwatch_360_360
python tools\validate\validate_screen.py ui\alone_select_mode_view.hml
```

Expected: PASS.

### Task 10: Sync HML Spec and Existing Docs

**Files:**

- Modify: `vibe-designer/skills/honeygui-designer/references/hml-spec.md`
- Modify: `docs/HML-Spec-zh.md`
- Modify: `docs/开发指南.md` only if it already has a suitable HML/i18n section

- [ ] Update `vibe-designer/skills/honeygui-designer/references/hml-spec.md`. This is required by `CLAUDE.md` and is the source distributed to project `.claude/skills/honeygui-designer/references/hml-spec.md`.
- [ ] Add `i18nKey` to the `hg_label` property table in the skill spec.
- [ ] Document `i18n/strings.json` catalog format in the skill spec.
- [ ] Document preview resolution order in the skill spec.
- [ ] Document that `text` remains the fallback and codegen-compatible value.
- [ ] Document that runtime firmware language switching is not part of this phase.
- [ ] Update `docs/HML-Spec-zh.md` with the same `i18nKey` and catalog behavior.
- [ ] Do not create a separate `docs/i18n-preview-zh.md` unless an existing docs index expects feature-specific pages. Prefer integrating into existing spec/docs so agents and users read one canonical source.
- [ ] Include the V202S pairing example.
- [ ] After opening V202S once in the modified extension, confirm its generated `.claude/skills/honeygui-designer/references/hml-spec.md` includes `i18nKey`.

Verification:

```powershell
npm run compile
```

Expected: compile still passes and AI-agent HML spec source includes `i18nKey`.

## Manual Acceptance

- [ ] Open `F:\HoneyGUI\honeygui_designer_ui\Smartwatch_360_360` in VS Code with the modified HoneyGUI Designer extension.
- [ ] Open `ui/alone_select_mode_view.hml`.
- [ ] Select `asm_scan_text`.
- [ ] Confirm Properties panel behavior:
  - without `i18nKey`, `Display Text` is editable as before.
  - with `i18nKey`, `Fallback Text (codegen)` is read-only.
  - with `i18nKey`, `Default Locale Text` edits both default translation and `text`.
  - with `i18nKey`, `Current Locale Text` edits only the selected preview locale.
  - `Localized Key` offers autocomplete from existing catalog keys.
- [ ] Add locale `ja-JP` from the toolbar selector and confirm it appears in `i18n/strings.json`.
- [ ] Switch preview language to `en-US`; canvas shows `Scan code pairing` and `Jump over`.
- [ ] Switch preview language to `zh-CN`; canvas shows `扫码配对` and `跳过`.
- [ ] Switch preview language to `zh-TW`; canvas shows `掃碼配對` and `跳過`.
- [ ] Switch preview language to `de-DE`; canvas shows `QR-Code koppeln` and `Überspringen`.
- [ ] Save HML and confirm `text` values remain synced to default-locale English fallbacks.
- [ ] Edit current locale text in Properties panel and confirm `i18n/strings.json` changes after debounce/blur.
- [ ] Set a font without CJK glyph support while previewing `zh-CN`; confirm a visible missing-glyph warning appears.
- [ ] Enter a long German translation and confirm likely-overflow warning appears when the label is too narrow.
- [ ] Confirm no HML codegen behavior changes unless runtime i18n is explicitly added later.

## Final Verification

Run from `F:\sourcecode\HoneyGui\honeygui-design`:

```powershell
npm run test:project-i18n
npm run compile
npm run build:webview
npm run test:unit
```

Run from `F:\HoneyGUI\honeygui_designer_ui\Smartwatch_360_360`:

```powershell
python tools\validate\validate_screen.py ui\alone_select_mode_view.hml
```

Expected:

- New project-i18n pure tests pass.
- TypeScript compile passes.
- Webview bundle builds.
- Existing tool unit tests pass.
- V202S HML validation passes.
- Designer preview locale changes canvas text without mutating fallback `text` except when editing default-locale text intentionally syncs it.
- Missing glyphs and likely overflow are visible enough to prevent a false-green PC preview.

## Rollback Plan

- Remove `i18nKey` from affected HML labels.
- Delete `i18n/strings.json` from the project.
- Revert Designer changes in `src/project-i18n`, `src/hml`, `src/designer`, `src/webview`, `src/services`, docs, and `package.json`.
- Existing HML files without `i18nKey` continue to load because `text` fallback remains unchanged.
