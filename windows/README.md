# BEAT Windows preview

Version 0.2.0 adds a local Codex connection. See [CONNECTION.md](CONNECTION.md) for tools, discovery and registration.

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

This is a writing prototype, not a feature-complete replacement for macOS BEAT. The parser implements a basic subset and has not been compared against output from the native BEAT parser. Markup is visible. Full inline emphasis, complex inline/multiline notes, true dual-dialogue layout, autocomplete, scene reordering, pagination, PDF/FDX export, revisions, tags, plugin compatibility are not implemented. Screenplay formatting in the editor is a writing aid, not production pagination. Documents are limited to 20 MB. Save regularly.

## Shortcuts

Ctrl+N new · Ctrl+O open · Ctrl+S save · Ctrl+Shift+S save as · Ctrl+F find/replace · Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+Shift+F focus · Ctrl+Shift+D theme.


### Recovery and backups (0.3.0)

Dirty named and untitled scripts receive atomic, synced checkpoints after 750 ms of idle time and at least every 5 seconds during continuous typing. The visible status reports checkpoint time or storage failures. A crash can lose edits since the last checkpoint.

Startup offers unresolved drafts. File > Recover unsaved screenplay opens the paged chooser. Restoration creates a visibly unsaved copy, preserves BOM, newline style and protected metadata, and requires a different destination from its source. Cancel leaves drafts intact. Successful save or explicit Discard removes checkpoints and recovery ancestry in queue order. Undoing an ordinary document to its saved text removes its checkpoint; recovered copies remain unsaved until saved or discarded.

File > Restore versioned backup lists previous versions by original filename and timestamp. Each overwrite first backs up exact existing bytes, including BOM, mixed newlines and metadata. Backup failures stop the save. Restored backups are protected unsaved copies. Destinations are checked immediately before atomic replacement. Avoid editing the same file in another application during a save: filesystem replacement is not a cross-application transaction.

Storage is under user-data in protection/recovery and protection/backups. Each instance owns a separate session; another active instance's drafts are excluded from recovery selection. Damaged entries are retained independently and reported. Backups retain the newest 50 versions per original path. Unresolved drafts are never aged out; a warning beyond 100 entries asks users to resolve them explicitly. This favors preserving work over a hard recovery storage limit.
