# Startup Optimization Report

Date: 2026-06-20

This report summarizes the final startup optimizations retained after investigating issue 1269 and the Notebook Navigator load time shown by Obsidian. The final build keeps `main.js` below the Obsidian Sync 5MB per-file limit.

## Executive Summary

Notebook Navigator startup was spending time in code that users did not need during plugin load. The main source was bundled module evaluation: importing a feature module at startup can execute a large dependency chain even if the user never opens that feature.

The final retained work reduces default startup module initialization, moves feature-heavy code to first use, removes unnecessary early background work, and keeps the release bundle in UTF-8 so `main.js` remains syncable.

## Final Measured Result

Measurements were taken with the local startup harness in `scripts/benchmark-startup.mjs`. The harness measures `main.js` import/evaluation and a mocked `onload()` path. It does not fully reproduce Electron, Obsidian internals, or vault-specific behavior, so the Obsidian plugin-list number still needs validation inside Obsidian.

| Measurement | Baseline | Final releasable build |
| --- | ---: | ---: |
| English import median | 10.90ms | 6.55ms |
| English import p95 | N/A | 8.04ms |
| zh-CN import median | N/A | 6.57ms |
| zh-CN import p95 | N/A | 8.07ms |
| English mocked `onload()` median | N/A | 7.12ms |
| English mocked `onload()` p95 | N/A | 9.08ms |
| zh-CN mocked `onload()` median | N/A | 7.09ms |
| zh-CN mocked `onload()` p95 | N/A | 8.83ms |

Final build output:

| File | Bytes |
| --- | ---: |
| `main.js` | 4,313,668 |
| `styles.css` | 302,598 |
| `manifest.json` | 498 |
| Total | 4,616,764 |

An ASCII bundle experiment reached faster local startup numbers, around 4.29ms English import median and 4.35ms zh-CN import median, but it expanded non-ASCII locale strings into escape sequences and pushed `main.js` above 5MB. That experiment was reverted. The final releasable build uses UTF-8.

## Why This Worked

Obsidian reports community plugin load time from more than visible work inside our `onload()` body. It also includes loading and evaluating the plugin bundle. In a single bundled `main.js`, a startup import can initialize a whole graph of modules even when the user never opens the feature behind that graph.

The final approach reduced default startup work in four ways:

- Startup now imports less feature UI code.
- Startup uses smaller helper modules where it only needs lightweight data or lookup behavior.
- Background cache work no longer starts during early database initialization.
- Optional external icon infrastructure starts only when the user has enabled or manages those icon packs.

The retained initializer trace dropped from the previous retained 120 startup initializers to 117. More importantly, the trace removed specific heavy default-startup chains such as full folder-note UI/opening helpers.

Several lazy-loading experiments were reverted. Some reduced initializer count but added wrapper code, grew `main.js`, or made parse/evaluation slower. Only changes with clear measured benefit or necessary release constraints were retained.

## Retained Optimizations

### 1. Command Handlers Load On First Command Use

Startup still registers all command IDs and names so the Obsidian command palette works normally. The heavy command implementation module no longer initializes during plugin load.

Implemented in:

- `src/services/commands/registerNavigatorCommands.ts`
- `src/services/commands/navigatorCommandHandlers.ts`

How it works:

- `registerNavigatorCommands.ts` contains lightweight command metadata: ID, display name, and whether the command needs `checkCallback`.
- At startup it registers small callbacks with Obsidian.
- On first command execution or check, it loads `navigatorCommandHandlers.ts` with `require(...)`.
- To preserve existing command implementation behavior, it temporarily captures the commands registered by the real handler module and stores them in a `WeakMap` keyed by plugin instance.

Why it helps:

- Command-only imports, modal imports, calendar command helpers, folder-note command helpers, and navigation command helpers no longer execute just because the plugin loaded.
- Command palette behavior stays intact because command metadata still exists at startup.

### 2. Settings UI Loads Only When Settings Are Opened Or Queried

The full settings module was too large to initialize during plugin startup. Startup now registers a lightweight settings tab shell.

Implemented in:

- `src/settings/LazyNotebookNavigatorSettingTab.ts`
- `src/main.ts`

How it works:

- `LazyNotebookNavigatorSettingTab` extends Obsidian `PluginSettingTab`.
- It stores the plugin reference and exposes the settings-tab methods Obsidian can call.
- The full `NotebookNavigatorSettingTab` from `src/settings.ts` is loaded only when `display()`, `getSettingDefinitions()`, `getControlValue()`, or `setControlValue()` needs the real settings UI.

Why it helps:

- Settings tab renderers, settings controls, diagnostics UI, and related modules stop initializing during plugin load.
- The plugin can still provide Obsidian settings definitions when Obsidian asks for them.

### 3. React View Classes Load Inside Obsidian View Factories

React view modules are now constructed from inside `registerView(...)` callbacks rather than imported eagerly by startup code.

Implemented in:

- `src/main.ts`
- `src/view/viewGuards.ts`

How it works:

- `main.ts` registers view factories for the navigator view, calendar view, and folder-note sidebar placeholder.
- Each factory uses synchronous `require(...)` inside the factory callback, because Obsidian view construction is synchronous.
- Startup code that needs to inspect an existing leaf uses structural type guards from `viewGuards.ts` instead of importing the view classes.

Why it helps:

- The React provider tree, view components, and view-only hooks are deferred until Obsidian creates the view.
- Startup can still safely stop content processing or navigate mounted views by checking method shape instead of importing concrete classes.

### 4. Emoji Catalog Loads Only When Emoji Search Or Display Names Need It

The `emojilib` catalog is large and not needed by most startup paths.

Implemented in:

- `src/services/icons/emojiCatalog.ts`
- `src/services/icons/providers/EmojiIconProvider.ts`
- `src/modals/IconPickerSurface.ts`
- `src/modals/IconPickerModal.ts`

How it works:

- `emojiCatalog.ts` keeps a private cached catalog.
- It loads `emojilib` with `require(...)` only when emoji catalog entries or display names are requested.
- It narrows the unknown module value into the expected `Record<string, string[]>` shape before exposing entries.

Why it helps:

- The emoji keyword database is no longer parsed and initialized during default plugin load.
- Emoji search and icon-picker display names continue to work when the picker or provider uses them.

### 5. Release Version Comparison No Longer Imports Release Notes

Startup needed `compareVersions`, but importing it from `releaseNotes.ts` also initialized the full release-note data.

Implemented in:

- `src/utils/versionUtils.ts`
- `src/services/ReleaseCheckService.ts`
- `src/releaseNotes.ts`

How it works:

- `compareVersions(...)` moved into `versionUtils.ts`.
- `ReleaseCheckService` imports the lightweight utility directly.
- `releaseNotes.ts` re-exports the same function so existing release-note consumers keep their API.

Why it helps:

- Startup services can compare versions without loading the release-note array.

### 6. Folder-Note Lookup Was Split From Full Folder-Note Actions

Several startup services need to detect folder notes, but they do not need folder-note creation, opening, or modal behavior.

Implemented in:

- `src/utils/folderNoteLookup.ts`
- `src/utils/folderNotes.ts`
- `src/services/FileSystemService.ts`
- `src/services/fileSystem/FileDeletionService.ts`
- `src/services/RecentNotesService.ts`
- `src/services/metadata/folderMetadata/FolderNoteMetadataAdapter.ts`
- `src/services/workspace/FolderNoteSidebarService.ts`
- `src/utils/fileFinder.ts`

How it works:

- `folderNoteLookup.ts` contains only synchronous detection behavior:
  - folder-note detection settings extraction
  - supported extension checks
  - root folder-note naming support
  - `getFolderNote(...)`
  - `isFolderNote(...)`
- Startup services import from `folderNoteLookup.ts`.
- `folderNotes.ts` re-exports the lookup helpers and keeps full feature actions such as creation/opening behavior.

Why it helps:

- Startup can detect folder notes without importing full folder-note UI/action dependencies.
- The initializer trace removed `folderNotes`, `FolderNoteTypeModal`, and `openFileInContext` from default startup.
- The lookup path stays synchronous, which avoids making file-system and metadata services async just to defer imports.

### 7. Preview Text Warmup No Longer Starts During Database Initialization

Database initialization previously started preview-text cache warmup during early startup. That work is not required for plugin load.

Implemented in:

- `src/storage/fileOperations.ts`
- `tests/storage/fileOperationsLifecycle.test.ts`

How it works:

- `initializeDatabase(...)` still configures preview-text cache options and opens IndexedDB.
- It no longer starts preview-text warmup as part of database initialization.
- The lifecycle test verifies that database initialization does not call preview warmup.

Why it helps:

- Startup no longer begins a background preview-store scan immediately.
- Preview text still works on demand; the cache can populate when preview text is actually requested.

### 8. External Icon Provider Controller Is Conditional

External icon packs are optional. Default startup no longer initializes the external icon provider controller or opens the icon asset database unless external packs are enabled or managed.

Implemented in:

- `src/main.ts`
- `src/services/icons/external/ExternalIconProviderController.ts`

How it works:

- `externalIconController` is nullable.
- Passive query methods return default values when no controller exists.
- `getExternalIconController()` lazy-loads `ExternalIconProviderController` only when installing/removing providers or when synchronization is required.
- Startup calls synchronization only when settings show enabled external icon providers.
- Settings save re-syncs when a controller already exists or external icon providers are enabled.

Why it helps:

- Default users do not pay the startup cost of external icon provider setup.
- Users who enable or manage external icon packs still get the same controller behavior when needed.

### 9. Locale Startup Loads The Selected Complete Locale Directly

Non-English startup previously initialized English and then merged the selected locale. Locale files are complete and validated, so startup no longer needs that merge for supported languages.

Implemented in:

- `src/i18n/index.ts`
- `src/types/commonjsRequire.d.ts`
- `scripts/check-unused-strings.mjs`

How it works:

- English is loaded lazily by `getEnglishStrings()`.
- Supported non-English locales load their complete selected locale directly with literal `require('./locales/<locale>.ts')` calls.
- Unsupported languages still fall back to English.
- `check-unused-strings` validates locale shape, which protects the assumption that translated locale files match the English key structure.

Why it helps:

- A zh-CN startup no longer initializes English first.
- The selected locale path does less startup work while keeping the English fallback for unsupported languages.

### 10. Build Output Uses UTF-8, Not ASCII

The final production build uses UTF-8 output.

Implemented in:

- `esbuild.config.mjs`
- `scripts/benchmark-startup.mjs`

How it works:

- `esbuild.config.mjs` sets `charset: 'utf8'`.
- `benchmark-startup.mjs` defaults to UTF-8 so measurements reflect the release build.

Why it helps:

- UTF-8 keeps translated locale text compact in raw `main.js`.
- The releasable artifact stays below the Obsidian Sync 5MB file limit.
- The faster ASCII result was rejected because raw `main.js` exceeded the Sync limit.

## Reverted Or Not Applied Work

Not every lazy split helped. The reverted experiments are documented in `docs/startup-optimization-log.md`.

Common reasons for reverting:

- The lazy wrapper increased bundle size more than the deferred import helped.
- The code path became async where startup services needed synchronous behavior.
- The initializer count improved but measured median or p95 regressed.
- The change created more lifecycle risk than the measured startup gain justified.
- The ASCII build improved local parsing but broke the 5MB Sync constraint.

Examples of reverted or not-applied areas:

- Lazy file-operation modals.
- Lazy API subcontrollers.
- Lazy file-system operation accessors.
- Lazy tag/property operation construction.
- Lazy folder-note utilities using async dynamic imports.
- External locale assets, because the current release workflow expects only `main.js`, `manifest.json`, and `styles.css`.

## Validation

The final state was validated with:

- `npx prettier --check esbuild.config.mjs scripts/benchmark-startup.mjs docs/startup-optimization-log.md`
- `npx tsc --noEmit --pretty false`
- `npm run lint -- --quiet`
- `node scripts/check-unused-strings.mjs --check`
- `npm run test`
- `./scripts/build.sh`
- `wc -c main.js styles.css manifest.json`

Results:

- TypeScript passed.
- ESLint passed.
- Locale usage and locale shape validation passed.
- Vitest passed: 139 test files, 1511 tests.
- Full build passed with `✅ No warnings`.
- `main.js` built to 4,313,668 bytes.

## Practical Expectation

This should reduce the portion of Obsidian plugin load time caused by Notebook Navigator bundle evaluation and early side effects. It will not necessarily reduce the full Obsidian plugin-list number by the same ratio, because that number also includes Electron behavior, Obsidian internals, device performance, and vault-specific work.

The next meaningful validation step is inside Obsidian on the reported vault/device, comparing plugin-list load time before and after this build.
