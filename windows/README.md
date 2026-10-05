# BEAT Windows preview

Version 0.10.0 preserves native heading UUIDs, allowing supported scripts such as Big Fish to open for editing. Revision tracking, Final Draft exchange and PDF export are included. See [CONNECTION.md](CONNECTION.md) for tools, discovery and registration.

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
- Supported legacy and modern BEAT documents containing revisions, tags, review comments and known settings are editable. Unsupported metadata documents open read-only and round-trip intact. File > Create editable copy creates a new Fountain-only document; the copy omits BEAT metadata and must be saved under another filename.

## Current limits

This is a writing prototype, not a feature-complete replacement for macOS BEAT. The parser implements a basic subset and has not been compared against output from the native BEAT parser. Source markup stays visible while writing. Tag/review creation and management, plugin compatibility are not implemented. Revision tracking is limited to additions and suggested removals. Screenplay formatting in the editor is a writing aid, not production pagination. Documents are limited to 20 MB. Save regularly.

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

This is the first pagination implementation, not verified production parity with native macOS BEAT. Font fallback for non-Latin text depends on installed Windows fonts. Very long character cues use at most two rows in repeated continuation headers. Native revision marks, scene continuation numbering, customized print styles, headers/footers remain future work. Inspect the PDF before production use.


### Writing tools (0.6.0)

Character names already used in the current script appear as suggestions when typing an uppercase cue or an @-forced cue after a blank line. Ctrl+Space also opens suggestions on a blank cue line. Arrow keys select, Tab accepts, Escape dismisses, and clicking accepts. Cue extensions such as (V.O.) and dual-dialogue ^ markers remain intact. Suggestions never replace text without acceptance and are disabled for protected documents.

Select a scene in the outline, then use Move up or Move down. The scene's heading, synopsis, comments and body move together with one undo step. Explicit scene numbers stay with their scene; automatic numbers follow the new order. Title pages and section headings stay in place. Moves cannot cross a section and are disabled while the outline is filtered or the document is read-only. An EOF scene lacking a final blank separator gets one when needed to keep headings distinct. Moves remain unsaved and receive normal recovery checkpoints.


### Final Draft exchange (0.7.0)

File > Open accepts .fdx files and creates visibly unsaved Fountain copies. Their original FDX paths are protected from Save and Export overwrites; save the imported screenplay under a new Fountain filename. Imported drafts receive normal recovery checkpoints. File > Export Final Draft writes a separate .fdx without saving the source script or clearing its recovery draft. Cancelling either conversion leaves the current document intact.

The converter supports scene headings and numbers, action, character cues, dialogue, parentheticals, transitions, shots, lyrics, centered text, bold/italic/underline text runs and dual dialogue. Title-page text is preserved; its original placement and field labels are not round-tripped. Sections and synopsis are exported as action text. Final Draft repaginates; Fountain page-break directives and notes are not exported. Revisions, tags, script notes, scene colors, custom fonts and unsupported paragraph features produce conversion warnings. The original FDX is retained for those features.

XML is parsed locally with DTD/entity declarations disabled, strict error reporting and bounded size/depth. Exports escape XML text and validate text characters. Existing destinations are checked before atomic replacement; edits made while an export dialog is open cancel export rather than writing stale text.

Validation covers the repository's native FDX structure and Windows round trips. Opening these exports in an installed Final Draft application remains an external interoperability check; no complete fidelity with Final Draft's production metadata or print layout is claimed.

### Revision tracking (0.8.0)

Enable **Track additions** above the editor and choose one of the eight native revision generations. New typing and Codex insertions are underlined in that generation's color. Select text and use **Mark addition**, **Suggest removal**, or **Clear marks**. Suggested removals remain in the source and appear struck through. Ordinary Delete/Backspace still erases text; it does not archive deleted text or create a removal suggestion automatically.

Text edits, marks, generation and tracking-mode changes share undo/redo. Revisions persist in automatic recovery and in Fountain saves using BEAT's native UTF-16 revision arrays. BOM and source newline style are preserved; native CRLF range offsets are translated to and from the editor's LF offsets. Untouched files still save byte-for-byte.

The 0.8.0 implementation handled plain Fountain and revision-only legacy BEAT settings. Version 0.9.0 extends editing to supported tags, reviews and known settings in both native envelopes; see below. Plugin data, unknown settings, malformed ranges and obsolete removed ranges stay protected. Heading UUID support was added in 0.10.0. Create an editable copy to omit those settings. Scene moves are disabled while tracking is enabled or marks are present. PDF/preview show screenplay content without revision marks; FDX export warns that revision metadata is omitted. Native macOS rendering parity has not yet been verified.

### Native BEAT metadata editing (0.9.0)

Supported legacy `END_BEAT` and modern `/** settings: ... **/` documents now allow screenplay text editing while preserving existing tag definitions, tag ranges, review comments, revisions and known document settings. Tags have a teal tint; reviews have a gold tint with the comment available on hover. Their counts appear above the editor. Tag and review management tools are not included in this release.

Insertions before a range shift it. Insertions inside a range inherit its annotation; insertions at its edges stay outside. Deleting all annotated text removes that range while retaining its tag definition. Undo/redo restores the text and annotations together, including Codex edits. Saved caret positions follow edits and are restored when opening. Automatic recovery retains annotations and restores an unsaved copy protected from overwriting its source. Saves retain BOM, source newline style, native UTF-16 offsets and the original settings envelope. Untouched files remain byte-for-byte identical.

Only recognized scalar settings and validated native annotation structures are editable. Unknown keys, malformed or overlapping ranges, missing tag definitions, locked documents, invalid or mismatched scene UUIDs, changed indices, character data, hidden revisions or plugin lists remain protected. The upstream Big Fish sample is editable from 0.10.0. Scene moves are disabled for documents carrying native annotation state, even when the current tag/review ranges are empty. Preview/PDF omit tags and review comments; FDX export warns that BEAT metadata is omitted. Native macOS interoperability remains an external verification step.

### Native heading identities (0.10.0)

Valid native `Heading UUIDs` tables now remain attached to their scene and section lines through text edits. The saved table follows native outline order and retains raw heading strings, including explicit numbers and markup. Duplicate heading names retain their separate UUIDs. Renaming a heading keeps its identity; new headings get fresh UUIDs; deleting a heading removes its saved identity. Undo/redo and recovery restore the exact identities, including IDs generated for newly inserted headings.

Both native settings envelopes are supported, with BOM and newline style preserved. Untouched saves remain byte-for-byte identical. Big Fish's 194 native heading IDs match the Windows outline and now open editable. Malformed, duplicate, incomplete or mismatched UUID tables remain protected. Replacing an entire scene/document creates new identities for replaced headings; a direct single-line rename retains its ID. Scene moves remain disabled for documents carrying heading identities until a dedicated move operation can preserve all metadata together. macOS round-trip interoperability remains an external verification step.
