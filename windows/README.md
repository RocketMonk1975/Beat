# BEAT Windows preview

Version 0.5.0 adds paginated preview and PDF export, building on the Fountain formatting improvements in 0.4.0. Recovery and backups are included from 0.3.0. See [CONNECTION.md](CONNECTION.md) for tools, discovery and registration.

This is the first runnable Windows prototype in a fork of [BEAT](https://github.com/lmparppei/Beat), created by Lauri-Matti Parppei and contributors. The original macOS/iOS app remains in the parent repository. This port is licensed under GPL v3 or later; see ../LICENSE.md.

## Run the packaged app

Double-click `Launch BEAT Windows.cmd` in the `BEAT Windows-win32-x64` folder. The launcher grants Electron's Windows sandbox read/execute access to this application folder, then starts `BEAT Windows.exe`. Keep the executable alongside all the other files in that folder. Preferences and browser session data are kept in a local `user-data` folder. No Node installation is needed for the packaged app. This is an unsigned development build.

## Run from source

Requires Node.js 22 or newer and npm.

```powershell
cd E:\_CONTENT\DEV\BEAT\upstream\windows
npm install
npm start
```

`npm run build` compiles the application; `npm test` runs document/parser tests; `npm run test:desktop` exercises the real Electron application; `npm run package` makes a portable Windows x64 application folder.

Alternatively, run `& .\scripts\test-desktop.ps1` from PowerShell to run the desktop checks, wait for completion, and print their results. The test window briefly opens and types into disposable documents under `work/desktop-test`; it never writes to the upstream sample scripts.

## Available

- New, open, save and save as using native Windows dialogs.
- UTF-8 Fountain files, source newline style and BOM preservation.
- Basic live screenplay formatting with source markup visible.
- Scene/section outline, filtering, synopsis display and navigation.
- Undo/redo, find/replace, dark/light themes and focus mode.
- Local Codex control: read, search, navigate, apply undoable edits, undo/redo and save a named script. Pause the connection from the footer.
- Unsaved-change prompts and detection of externally changed files before overwriting.
- Existing BEAT metadata documents open read-only and round-trip intact. File > Create editable copy creates a new Fountain-only document; the copy omits BEAT metadata and must be saved under another filename.

## Current limits

This is a writing prototype, not a feature-complete replacement for macOS BEAT. The parser implements a basic subset and has not been compared against output from the native BEAT parser. Source markup stays visible while writing. FDX export, revisions, tags, plugin compatibility are not implemented. Screenplay formatting in the editor is a writing aid, not production pagination. Documents are limited to 20 MB. Save regularly.

## Shortcuts

Ctrl+N new · Ctrl+O open · Ctrl+S save · Ctrl+Shift+S save as · Ctrl+F find/replace · Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+Shift+F focus · Ctrl+Shift+D theme.


### Recovery and backups (0.3.0)

Dirty named and untitled scripts receive atomic, synced checkpoints after 750 ms of idle time and at least every 5 seconds during continuous typing. The visible status reports checkpoint time or storage failures. A crash can lose edits since the last checkpoint.

Startup offers unresolved drafts. File > Recover unsaved screenplay opens the paged chooser. Restoration creates a visibly unsaved copy, preserves BOM, newline style and protected metadata, and requires a different destination from its source. Cancel leaves drafts intact. Successful save or explicit Discard removes checkpoints and recovery ancestry in queue order. Undoing an ordinary document to its saved text removes its checkpoint; recovered copies remain unsaved until saved or discarded.

File > Restore versioned backup lists previous versions by original filename and timestamp. Each overwrite first backs up exact existing bytes, including BOM, mixed newlines and metadata. Backup failures stop the save. Restored backups are protected unsaved copies. Destinations are checked immediately before atomic replacement. Avoid editing the same file in another application during a save: filesystem replacement is not a cross-application transaction.

Storage is under user-data in protection/recovery and protection/backups. Each instance owns a separate session; another active instance's drafts are excluded from recovery selection. Damaged entries are retained independently and reported. Backups retain the newest 50 versions per original path. Unresolved drafts are never aged out; a warning beyond 100 entries asks users to resolve them explicitly. This favors preserving work over a hard recovery storage limit.


### Fountain formatting (0.4.0)

The Windows parser now uses blank-line context for headings and cues, accepts mixed-case cue extensions and unfinished parentheticals, supports shots (`!!`), fullwidth forced markers, and title-page continuation. Inline and multiline comments no longer consume visible text around them. Notes must close before a blank line; omissions may extend to the end of the script. Outline labels and word counts exclude comment contents and matched formatting markers.

The editor styles bold, italic, underline and combined/nested emphasis while keeping every source character editable. Escaped markers and incomplete markup stay literal. Preview (View > Screenplay preview, Ctrl+Shift+P) displays continuous formatted text, omits comments and control markers, and places paired `^` dialogue blocks in two columns. Returning to editing keeps selection and undo history. The preview updates after local Codex edits; outline navigation returns to the source editor.

This is a static-rule parity pass based on the native parser source checked into this repository, not a claim of complete parity with the running macOS app. See PARSER-PARITY.md for the comparison and remaining differences. The preview has no pagination or PDF export yet.


### Pagination and PDF (0.5.0)

Preview uses physical Letter (default) or A4 pages, 12-point Courier New, one-inch top/bottom/right margins and a 1.5-inch left margin. Dialogue and parenthetical columns have screenplay indents. Title-page fields appear separately; script numbering begins after the title page, with the first script page unnumbered. Explicit === breaks advance to the next page without printing the marker. Scene headings stay with following content. Split dialogue repeats its cue with (CONT'D) and adds (MORE); dual dialogue continues in independent columns.

Choose paper size in Preview. File > Export PDF (Ctrl+Alt+P), or Preview's Export PDF button, uses that same measured layout. Export does not save the script or clear its recovery draft. Cancellation, storage errors and changes during export leave the screenplay untouched. Existing PDF destinations are checked before atomic replacement. The exporter runs in an isolated sandboxed window with JavaScript disabled.

This is the first pagination implementation, not verified production parity with native macOS BEAT. Font fallback for non-Latin text depends on installed Windows fonts. Very long character cues use at most two rows in repeated continuation headers. Native revision marks, scene continuation numbering, customized print styles, headers/footers and FDX export remain future work. Inspect the PDF before production use.


### Writing tools (0.6.0)

Character names already used in the current script appear as suggestions when typing an uppercase cue or an @-forced cue after a blank line. Ctrl+Space also opens suggestions on a blank cue line. Arrow keys select, Tab accepts, Escape dismisses, and clicking accepts. Cue extensions such as (V.O.) and dual-dialogue ^ markers remain intact. Suggestions never replace text without acceptance and are disabled for protected documents.

Select a scene in the outline, then use Move up or Move down. The scene's heading, synopsis, comments and body move together with one undo step. Explicit scene numbers stay with their scene; automatic numbers follow the new order. Title pages and section headings stay in place. Moves cannot cross a section and are disabled while the outline is filtered or the document is read-only. An EOF scene lacking a final blank separator gets one when needed to keep headings distinct. Moves remain unsaved and receive normal recovery checkpoints.
