---
name: sheet-music-pdf-convert
description: Turn a sheet music PDF (exported from notation software, scanned, or photographed) into editable MusicXML that opens in MuseScore, Dorico, Sibelius or Finale. Use when the user wants to edit, transpose, re-engrave or play back a score they only have as a PDF, asks to "convert sheet music PDF to MusicXML / MuseScore / Dorico", or hands over a score PDF and asks what can be done with it.
---

# Sheet music PDF → editable score

The user has a score as a PDF and wants something they can edit. Your job is to find the best way to read this particular PDF, run it for them, and hand back a file plus an honest note about what to check. Assume the user knows nothing about PDFs, OMR or command lines: they answer yes/no questions, you do everything else, and you explain in plain words.

## 1. Look at the PDF first

Run the bundled identifier (in this skill's `scripts/` folder) on each file before choosing anything:

```
node scripts/identify.mjs <file.pdf> --json
```

It reports three separate things: what kind of PDF it is (vector with music fonts, scan/image, outlined, mixed, unknown, unreadable) with per-page evidence; which notation program probably made it; and whether Tutti is likely to read it. It needs Node.js 22 or newer; if Node is missing or older, install a current version the normal way for this computer (ask first). Read `references/routes.md` for what each result means.

The identifier only looks at fonts, metadata and images; it does not judge how complex the music is, and its rules can be older than the Tutti website. Treat "likely", "unlikely" and "unknown" as advice, never as a refusal.

## 2. Pick the route

- **Tutti is likely to read it** (exported from notation software): strongly recommend Tutti, because it reads the notation data inside the PDF instead of guessing from pixels, so the result is usually much better than OMR. Ask: "This needs you to agree to Tutti's privacy policy (https://tutti-studio.com/privacy). OK?" If yes, open the Tutti link from `references/tutti.md` and tell the user to upload the file there. If the user prefers not to upload, offer local Audiveris and say it is usually less accurate for this kind of PDF.
- **Unknown, mixed, or "unlikely" from old local rules**: offer both; suggest trying the Tutti website first, since it checks the file on the spot.
- **Scan, photo, or outlined music**: use Audiveris on this computer (section 3).
- **Handwritten**: say plainly that no automatic tool reads handwriting reliably yet; suggest re-entering it in a notation program.
- **Unreadable, encrypted, not a PDF**: explain what is wrong and what the user can do.

Audiveris gives a draft to correct, not a finished score, and works best on clean scans of simple to moderate music: solo pieces, piano, small chamber music, simple choir. Phone photos often fail outright. For a large orchestral or dense scan, say up front that the result will need a lot of correction, then let the user decide whether to try it or look at the other tools in `references/omr-tools.md`.

## 3. Running Audiveris for the user

Everything you need (official download source, checksums, OCR language data, the batch command, how to read its output, known problems) is in `references/audiveris.md`. The points that matter most:

- Download only from the official GitHub releases of Audiveris, and verify the checksum. Ask before installing. On macOS the app is not signed by Apple, so the system will block the first launch; explain the one click needed, or clear the quarantine flag yourself with the user's permission.
- Audiveris ships without OCR language data. Without it the notes still come out, but lyrics, tempo text and instrument names are silently dropped. Install the legacy language files the notes name, for the languages printed in the score.
- Give every input its own output folder; never overwrite the user's files.
- Only use Audiveris and its language data. Do not install other image tools or send pages to online services to "improve" a bad photo; if a photo reads badly, tell the user how to retake it (flat, even light, straight on, or use a scanner).

## 4. Hand back honestly

Say, separately:

1. whether the run finished, and which pages or movements were exported;
2. what Audiveris itself flagged (pages it could not read, measures it marked);
3. that the notes have **not** been checked against the PDF — OMR can miss an accidental or misread a pitch without any warning — and where to start checking (the flagged places, then key and time signatures, then dense passages).

Never call an OMR result "correct" or "ready". Then tell the user how to open the file in their notation program (`references/open-in-editor.md`).

## 5. Things to keep in mind

- One question at a time, in plain words. Do not explain PDF internals unless asked.
- Ask before uploading anything, installing anything, or changing system settings. Never work around a permission the user or the system denied; explain what it would take instead.
- Several files: identify all of them first, group by route, and confirm the plan once ("3 go to Tutti, 2 will be read on your computer").
- If something in this skill is out of date with what you see (a new Audiveris version, a changed website), trust what you see and say so.

## Examples

- *"Convert this to MuseScore"* with a Sibelius-exported quartet → identifier says vector, Sibelius, likely → recommend Tutti, ask about the privacy policy, open the site; mention the local option.
- *"Can you make this editable?"* with a scanned piano sonata from IMSLP → scan → offer to install Audiveris (ask), install language data, run, report exported pages and flagged measures, explain how to open the MusicXML and what to check.
- A phone photo of a choir part, blurry and curved → photo → run Audiveris once; if most of it is unreadable, give retake advice rather than trying more tools.
