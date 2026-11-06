# Audiveris

Open-source OMR (AGPL-3.0) that reads scanned or photographed printed music and exports MusicXML. It runs on the user's computer; nothing is uploaded. Facts below were measured with 5.11.0 on Apple-silicon macOS in November 2026; on other systems or versions, check what you see and adapt.

## What to expect

Treat the output as a draft to correct, not a finished score. In our test batch of real scans (Lieder, voice and piano, one to four pages), every run produced a file, but most had structural problems: a staff split into extra parts, a bar missing from one staff, bar counts that differ between staves. Strict note-by-note agreement on the one scan we could align was about 40%. Synthetic phone-style photos (perspective, shadow, blur) failed to export at all. Clean, flat, high-resolution scans of simple music do best; tell the user this before they invest time.

## Getting it

- Only from the official releases: https://github.com/Audiveris/audiveris/releases (audiveris.com is not the project). Pick the asset for the system: macOS arm64 or x86_64 `.dmg`, Ubuntu 22.04/24.04 x86_64 `.deb`, Windows x86_64 `.msi`. Check the SHA-256 against the `digest` the GitHub release API gives for the asset.
- Java is bundled; nothing else is needed to run it.
- macOS: the app is not signed by Apple. The first launch shows "“Audiveris” Not Opened" and the CLI produces no output until it is allowed. The user can allow it in System Settings → Privacy & Security ("Open Anyway"), or, with their permission, remove the download quarantine flag from the copied app (`xattr -dr com.apple.quarantine Audiveris.app`; a few read-only files inside may need owner write first).
- macOS: mounting the `.dmg` from a terminal prints the AGPL licence and waits for acceptance; with no answer it fails with "attach canceled", which looks like a broken download but is not.
- macOS launcher for the command line: `Audiveris.app/Contents/MacOS/Audiveris`.

## OCR language data (do not skip)

Audiveris ships without OCR languages. Without them it still exports notes, but **lyrics, tempo words and instrument names are silently dropped** (same scan: 95 lyric syllables with data, 0 without).

- Use the Tesseract **4.x legacy** data, e.g. `https://github.com/tesseract-ocr/tessdata/raw/4.1.0/<lang>.traineddata` — not `tessdata_fast` or `tessdata_best`.
- Put the files in one folder and point `TESSDATA_PREFIX` at it for the Audiveris process.
- Get `eng` plus the languages of the lyrics and markings (often `deu`, `ita`, `fra`, `lat`). The log line `Installed OCR languages: ...` confirms they were found; `No installed OCR languages` means they were not.

## Running it

```
<launcher> -batch -export -save \
  -constant org.audiveris.omr.text.Language.defaultSpecification=eng+deu \
  -output <its own output folder> [-sheets 2-5] -- <absolute path to the PDF>
```

- `-sheets` picks PDF pages (1-based, ranges allowed). Skip cover, title and text-only pages: a single page without music can make the whole run end with `Could not export since transcription did not complete successfully` and exit code 1.
- One output folder per input file. Output: `<name>.mxl` (the MusicXML), `<name>.omr` (Audiveris project, reopenable in its editor) and a `.log`.
- Time and memory on our machine: 30–210 seconds and 0.7–1.4 GB for 1–4 pages. Default heap limit is 8 GB; long scores do not need manual splitting.

## Checking the result before handing it over

An exit code of 0 and an `.mxl` file do **not** mean the music is complete.

- Open the MXL and count parts and measures per part; unequal measure counts between parts of the same score mean something was dropped.
- `*.mvtnull.mxl`, or several `exported to` lines for the same path, means movements overwrote one another; the file may hold only a fragment.
- In the log, `[<name>#N]` refers to PDF page N. `flagged as invalid` / `No system found`: that page was not read. `Error visiting Measure{#11P2}` followed by an exception: that measure is likely missing from part 2. `no correct rhythm`, `Voice ... too long`, `No timeOffset`: rhythm trouble around that place. These appear at INFO level too, so do not filter for WARN/ERROR only.
- Report all of this plainly (see "Hand back honestly" in SKILL.md). The `.omr` file lets a patient user fix things in Audiveris's own editor; most users will rather fix the MusicXML in their notation program.

## When it fails

- Photo: suggest a retake (flat page, even light, straight above, or a scanner) before anything else; then the photo-oriented tools in `omr-tools.md`.
- Large orchestral or dense scans: expect failure or heavy correction; say so first.
- Repeated failures on a clean scan: stop after one retry with different pages, and point to `omr-tools.md` rather than trying more settings.
