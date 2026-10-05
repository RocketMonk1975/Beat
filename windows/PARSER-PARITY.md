# Windows Fountain parity: v0.4.0

## Reference and verification

The local native source is the reference: `Frameworks/BeatParsing/BeatParsing/Parsing/Extensions/ContinuousFountainParser+ParsingRules.m`, `ParsingRule.m`, `Categories/NSString+CharacterControl.m`, the Notes extension, and `Parsing/Assisting classes/Line.m` and `InlineFormatting.m`.

`tests/fixtures/native-rules.json` records curated source-derived expected classifications and the rule supporting each case. They are static fixtures, not captured output from an executable native parser. macOS differential testing remains necessary for a full parity claim.

## Covered behavior

| Area | Windows behavior |
| --- | --- |
| Context | Headings and cues after an empty/effectively empty line; heading-like dialogue stays dialogue |
| Cues | Uppercase outside parentheticals, explicit @ and fullwidth equivalents, no arbitrary 80-character cutoff |
| Dialogue | Parentheticals can be unfinished; two spaces can preserve a dialogue line |
| Forced elements | Action, shots, headings, lyrics, sections, synopsis, transition, centered text, page breaks |
| Title page | Known and custom initial keys, continuation until a blank line |
| Comments | Inline/multiline omissions and closed notes; visible prefixes/suffixes remain visible; blank lines cancel multiline notes |
| Inline styling | Bold before italic, underline, combined/nested ranges; escapes and incomplete markers remain editable |
| Dual dialogue | Adjacent dialogue blocks paired by the second cue's ^; independent lengths; side-by-side continuous preview |
| Source protection | Absolute UTF-16 ranges; source text untouched; existing document/automation/recovery guards unchanged |

## Deliberate differences and remaining work

- The parser is a whole-document static parser. Native interactive rules depend on selected/current line, tab-forced cues and dynamic reparsing. Windows does not emulate those editing states.
- Conventional EST. and INT/EXT headings remain supported as compatibility extensions to the native rules reviewed here.
- Raw editing stays sequential for dual dialogue. The continuous preview supplies two columns without altering source order or editing offsets. It is not production pagination.
- Macros, native +highlight+ syntax, revisions, tags, markers, arbitrary nested/malformed notes and note-color semantics beyond scene colors need further comparison. Macros and unsupported syntax stay literal.
- Preview layout uses editor-scale proportions; exact native font metrics, title-page placement, page breaking, dialogue continuations and PDF export are next-stage work.
- A complete macOS comparison corpus should include native parser output for all upstream sample scripts and live-edit sequences. The macOS frameworks cannot be executed in this Windows environment.

## Validation

Core fixtures cover contextual classification, inline comments, unmatched markers, overlapping styles, dual pairing, source offsets, realistic scripts and adversarial dense/malformed markup. Desktop checks verify decorations, safe text rendering, paired preview columns, live Codex updates, undo and outline navigation alongside the existing save/recovery/metadata regressions.
