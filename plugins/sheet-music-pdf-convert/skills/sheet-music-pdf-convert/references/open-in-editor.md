# Opening the MusicXML

The result is a `.musicxml` or `.mxl` file (`.mxl` is the same thing, compressed). Every major notation program opens both.

| Program | How |
|---|---|
| MuseScore Studio (free) | File → Open, choose the file. |
| Dorico | File → Open creates a new project from the file; File → Import → MusicXML adds it to an open project as a new flow. Before importing, the MusicXML options in Preferences decide what is kept (note durations, beam groups, system breaks); keeping less often gives a cleaner result. |
| Sibelius | File → Open, choose the file; an import dialog lets you match instruments. |
| Finale | File → Import → MusicXML. |

Only name menu commands listed here or ones you have checked in the program's own documentation; menus differ between versions, so do not guess.

If the user has no notation program, suggest MuseScore Studio: it is free for macOS, Windows and Linux.

## What to check first

- For an OMR result (Audiveris or similar): the places the tool flagged, then key and time signatures, clefs, and the densest passages. Compare against the PDF page by page.
- For a Tutti result: the review list on the Tutti result page.
- If notes vanish or measures shift only after import (the file looked fine elsewhere), it is an import problem, not a reading problem; try the other way of opening (Open vs Import in Dorico) or another program to confirm.

Guides: https://tutti-studio.com/post/musicxml-import-problems-dorico , https://tutti-studio.com/post/sibelius-to-musescore-dorico
