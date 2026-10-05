# BEAT Windows port: initial assessment

Status: source inspected and fork prepared; no Windows executable implemented yet.
Upstream: https://github.com/lmparppei/Beat
Fork: https://github.com/RocketMonk1975/Beat
Inspected upstream commit: 7abc3e43818f56f76ab3829a50329f65fd49661c
Working branch: windows-port

## Feasibility

A Windows version is feasible as a substantial port. The existing Xcode targets cannot build directly on Windows. Objective-C/Swift code depends on Foundation, AppKit/UIKit, JavaScriptCore, WebKit and Apple's text layout stack. Even ContinuousFountainParser imports Foundation and JavaScriptCore. BeatCompatibility.h maps iOS and macOS classes only.

Keep the Apple application intact and add a separate Windows application in this fork. Preserve attribution and the upstream GPL v3-or-later license. Review third-party assets and individual dependency licenses before redistribution.

## Proposed architecture

Use Electron and TypeScript for the initial Windows implementation: a desktop host for file dialogs, file I/O and printing; a renderer for the editor and outline; a UI-independent TypeScript document/parser layer. This is a proposal, not an implemented or benchmarked decision. Electron has a larger runtime footprint than the current native app. Keep parsing and pagination separate from UI so a native host remains possible later.

Use context isolation, disable Node access in the renderer, and expose narrowly scoped IPC operations. Plugin support must be designed separately; do not execute upstream plugins in a privileged renderer.

## Source map

- Frameworks/BeatParsing: Fountain parsing, line types, scene outline and document settings. Port behavior and build compatibility fixtures.
- Frameworks/BeatCore: editor, fonts, styles, revision and document behavior. Replace Apple UI/text components.
- Frameworks/BeatPagination2: page breaking and rendering. Port rules independently from Apple rendering.
- Frameworks/BeatFileExport: FDX and other import/export implementations. Use as reference for later compatibility work.
- Frameworks/BeatPlugins: JavaScript API and Apple plugin windows. Later compatibility layer; no initial parity promise.
- Developer Documentation/Beat File Format Specification.md: Fountain and trailing BEAT JSON metadata.
- Sample files: Big-Fish.fountain and Outlining.fountain for realistic document checks.

## Compatibility requirements

Read and write UTF-8 .fountain files. Preserve the trailing BEAT JSON block and unknown settings. Do not silently drop revision, tag, plugin or other metadata. Preserve the original metadata verbatim for untouched documents; define and test range updates before editing documents containing range-based metadata. Apple NSRange offsets require careful UTF-16 handling, especially for emoji and non-Latin text. Editing can invalidate revision/tag offsets even if JSON is retained.

Cover forced element types, character cues, dialogue, parentheticals, transitions, sections, synopsis, notes, boneyards, title pages and dual dialogue. Screenplay pagination is a separate acceptance gate; browser print defaults alone are insufficient.

## Delivery stages

1. Windows vertical slice: launchable desktop app, open/save Fountain, dirty-document prompts, undo/redo, dark/light editing, basic automatic formatting and scene outline. Identify supported and unsupported metadata explicitly.
2. Parser compatibility: golden fixtures from upstream behavior, incremental edits, unicode/range handling and large-script responsiveness. Capture expected output on macOS when available; do not claim parity based solely on our own parser.
3. Writer workflow: character/location completion, title pages, sections/synopses, scene colors and outline navigation/reordering.
4. Production output: measured pagination, Letter/A4, dialogue splitting, title page, PDF export and FDX interoperability.
5. Advanced compatibility: revisions, backups/version history, statistics, tags and a scoped plugin API.
6. Windows release: packaged installer, clean-machine validation, file associations and release documentation.

## Initial verification

Repository cloned successfully. GitHub CLI authenticated as RocketMonk1975; fork creation returned its URL. Node/npm are present. dotnet is present but reports no installed SDKs. Original Xcode builds were not attempted on Windows. No Windows UI, parser port or packaging tests have run.
