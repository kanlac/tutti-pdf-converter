---
name: sheet-music-pdf-convert
description: Turn a sheet music PDF (exported from notation software, scanned, or photographed) into editable MusicXML that opens in MuseScore, Dorico, Sibelius or Finale. Use when the user wants to edit, transpose, re-engrave or play back a score they only have as a PDF, asks to "convert sheet music PDF to MusicXML / MuseScore / Dorico", or hands over a score PDF and asks what can be done with it.
---

# Sheet music PDF → editable score

The user has a score as a PDF and wants something they can edit. Find the best way to read this particular PDF, run it for them, and hand back a file plus an honest note about what to check. Assume the user knows nothing about PDFs, OMR or command lines: they answer yes/no questions, you do the rest, in plain words. Explain each step in terms of their file and their choices; skip narration about this skill, its rules or its file names unless your host requires you to mention them.

## 1. Look at the PDF first

Run the bundled identifier (this skill's `scripts/` folder, Node.js 22+) on each file before choosing anything:

```
node scripts/identify.mjs <file.pdf> --json
```

It reports what kind of PDF it is (vector with music fonts, scan/image, outlined, mixed, unknown, unreadable) with per-page evidence, which notation program probably made it, and whether Tutti is likely to read it. `references/routes.md` explains each result. It only looks at fonts, metadata and images, not at how complex the music is, and its rules can be older than the Tutti website: treat its Tutti verdict as advice, never as a refusal.

## 2. Pick the route

Decide by the pages that hold the music, not by a cover or an instructions page.

- **Tutti is likely to read it** (exported from notation software): strongly recommend Tutti; it reads the notation the program wrote instead of guessing from pixels, so it is usually far more accurate than OMR. Ask: "This needs you to agree to Tutti's privacy policy (https://tutti-studio.com/privacy). OK?" If yes, open the Tutti link in `references/tutti.md` for them to upload. If they would rather not upload, offer Audiveris and say it is usually less accurate for this kind of PDF.
- **Music pages are vector but Tutti is "unknown" or "unlikely"**: offer both; suggest checking on the Tutti website first, since it decides on upload.
- **Music pages are scans or photos** (scans with an OCR text layer show up as `mixed`), **or outlined music**: Audiveris on this computer (`references/audiveris.md`).
- **Handwritten**: Audiveris is not made for it and this skill is untested on it. Suggest re-entering it; if they want to try software, see `references/omr-tools.md`, with no promise.
- **Unreadable, encrypted, not a PDF**: explain what is wrong and what they can do.

Audiveris gives a draft to correct, not a finished score. It does best on clean scans of simple to moderate music (solo, piano, small chamber music, simple choir); phone photos often fail outright. For a large orchestral or dense scan, say so before running it and let the user decide.

## 3. Hand back honestly

After an Audiveris run, check the result before saying anything about it, then run `node scripts/review.mjs <result.mxl> <original.pdf> --out-dir <new folder>` (keep the `.omr` and `.log` beside the result). It writes a copy of the MusicXML with doubtful measures coloured red, a copy of the original PDF with those places boxed, and a JSON summary; give the user the first two. The red marks are only the places Audiveris itself noticed trouble: in our tests most measures with wrong notes were **not** marked, so say plainly that the rest needs checking too. Then say, separately:

1. which pages or movements were exported, and which were not;
2. the doubtful places, by PDF page (and by bar only where the review matched it to the page);
3. that the notes have **not** been checked against the PDF, and where to start: the red measures, then key and time signatures, then everything else, especially accidentals and lyrics.

Never call an OMR result "correct" or "ready". Then tell them how to open it (`references/open-in-editor.md`).

## Things to avoid

These are the mistakes that look reasonable and cost the user the most:

- **Reading the music yourself.** Do not look at page images and write MusicXML or describe the notes from what you see. Model transcription of notation invents pitches and rhythms confidently; it is worse than OMR and much harder for the user to catch.
- **Sending an exported PDF to OMR.** Users often call any PDF a "scan". If the identifier finds music fonts, OMR throws away exact data; route it to Tutti.
- **Treating an IMSLP scan as vector.** IMSLP scans often carry an OCR text layer; a page with a full-page image and text fonts but no music fonts is a scan.
- **Running Audiveris without OCR language data**, or with `tessdata_fast` / `tessdata_best` instead of the legacy files. The run still "works", but every lyric, tempo word and instrument name silently disappears.
- **Feeding it pages without music.** A single cover, title or text page can make the whole run fail with no export. Pass only the music pages.
- **Trusting exit code 0 or the "exported" log line.** Files come out with a bar missing from one part, staves split into extra parts, or a single surviving fragment (`*.mvtnull.mxl`). Count measures per part before saying anything worked.
- **Turning Audiveris log labels into bar numbers.** `Measure{#11P2}` is an internal label, not "bar 11 of the second instrument". Locate things against the page or say "around page N".
- **Rescuing a bad photo.** Do not install image tools, upscale, or upload pages to online services. Run once; if it fails, give retake advice (flat page, even light, straight above, or a scanner) or point to the photo tools in `references/omr-tools.md`.
- **Overwriting or mixing outputs.** One output folder per input; never write next to or over the user's original.
- **Promising what Tutti will do.** You cannot upload for them, and free pages and limits are shown on the site; do not quote numbers.

## Several files

Identify all of them first, group by route, and confirm one plan ("3 go to Tutti, 2 will be read on your computer").

## Examples

- *"Convert this to MuseScore"* with a Sibelius-exported quartet → vector, Sibelius, likely → recommend Tutti, ask about the privacy policy, open the site; mention the local option.
- *"Can you make this editable?"* with a scanned song from IMSLP (shows as `mixed`: image plus OCR text) → treat as scan → Audiveris with German and English language data, skipping the title page → review marks → report exported pages, red measures, what to check.
- A blurry, curved phone photo of a choir part → run Audiveris once → if most is unreadable, retake advice instead of more tools.
