# Reading the identifier and choosing a route

`node scripts/identify.mjs <file.pdf> --json` works offline and never uploads anything. Exit code 0 means it produced a result (including "unknown"); 1 means the file could not be read as a PDF; 2 means a usage or file-access error.

## The three answers

**`pdf.kind`** (also given per page in `pdf.pages[].kind`):

| Value | Meaning |
|---|---|
| `vector` | Music is drawn with music fonts, as notation software does when it exports a PDF |
| `scan` | Pages are images: a scanner, a camera, or a PDF saved from photos |
| `outlined` | Vector drawing but no fonts: the symbols were turned into shapes |
| `mixed` | Some pages of one kind, some of another. Often harmless (a scanned or decorated cover before a vector score), sometimes a real mix |
| `unknown` | Not enough evidence either way (for example an unregistered music font) |
| `unreadable` | Not a PDF, empty, password-protected or broken; see `pdf.reasons` |

**`sources`**: notation programs the metadata or fonts point to. There can be several; that is normal for scores assembled from different files.

**`tutti.status`**: `likely`, `unlikely` or `unknown`, with `reasons`. This is routing advice from rules bundled with this skill, and those rules may be older than the Tutti website. `websiteLimits` says whether the file is over the website's size or page limits; it does not affect the local route.

## Routes

| Situation | Route |
|---|---|
| `tutti.status` is `likely` | Strongly recommend Tutti (`tutti.md`); offer Audiveris as the local alternative, noting it is usually less accurate for this kind of PDF |
| `unknown` or `unlikely`, and `kind` is `vector` or `mixed` | Suggest trying the Tutti website first, since it decides on upload; keep Audiveris as an option. Do not present local "unlikely" as a refusal |
| `kind` is `scan`, `outlined`, or a `mixed` file whose music pages are scans | Audiveris (`audiveris.md`) |
| `unreadable` | Explain the reason in `pdf.reasons` (for example, ask for the version without a password) |

For a `mixed` file, look at `pdf.pages` to see which pages hold the music before deciding. If only a cover or an instructions page differs, treat the file by its music pages. A page that is `mixed` because it has a full-page image plus text fonts but no `musicFonts` is usually a scan with an OCR text layer (IMSLP adds these); treat it as a scan.

The identifier cannot tell how complex the music is or whether it is handwritten. Look at a page yourself if the user can share it, or ask; for handwritten music see `omr-tools.md`.

## Several files

Identify every file first, then confirm one plan with the user, grouped by route. Give each file its own output folder named after the input, and never overwrite the originals.
