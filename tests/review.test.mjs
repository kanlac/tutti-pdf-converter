import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, copyFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {PDFDocument, degrees} from '../packages/identify/vendor/pdf-lib.esm.min.js';
import {analyzeMusic, loadMusic, rhythmIssues} from '../packages/review/src/music.js';
import {readOmr, mapMusic, logDiagnostics} from '../packages/review/src/omr.js';
import {parseXml, markNotes} from '../packages/review/src/xml.js';
import {readZip} from '../packages/review/src/zip.js';
import {review} from '../packages/review/src/index.js';
import {pageTransform, convertBounds} from '../packages/review/src/pdf.js';
import {note, attrs, measure, score, omr, mxl} from './review-fixtures.mjs';
const full = note(16), script = 'plugins/sheet-music-pdf-convert/skills/sheet-music-pdf-convert/scripts/review.mjs';
function middle(body) {
  return analyzeMusic(score([measure(1, attrs() + full), measure(2, body), measure(3, full)])).parts[0];
}
async function pdf() { const d = await PDFDocument.create(); d.addPage([600, 800]); return d.save(); }

test('duration uses divisions and performed tuplets, not notation type or an extra ratio', () => {
  const tuplet = note(4, '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
  const p = middle(`<attributes><divisions>3</divisions></attributes>${tuplet.repeat(3)}`);
  assert.equal(p.measures[1].durations[0].duration, 4);
  // Last measure inherits divisions=3 and is overfull; inspect the middle only.
  assert.equal(rhythmIssues(p).filter(n => n.measure.index === 2).length, 0);
});

test('chords (including different durations), grace, rests and independent voices', () => {
  const chord = note(8) + note(4, '<chord/>') + note(8, '<grace/>') + note(8);
  const p = middle(chord + '<backup><duration>16</duration></backup>' + note(16, '', '2'));
  assert.deepEqual(p.measures[1].durations.map(v => v.duration), [4, 4]);
  assert.equal(rhythmIssues(p).length, 0);
  const graceChord = middle('<note><grace/><pitch><step>C</step><octave>4</octave></pitch></note>' + note(4, '<chord/>') + full);
  assert.equal(rhythmIssues(graceChord).length, 0);
  const rest = middle('<note><rest/><duration>16</duration></note>');
  assert.equal(rhythmIssues(rest).length, 0);
  assert.equal(rhythmIssues(middle('<note><rest measure="yes"/></note>')).length, 0);
  assert.match(rhythmIssues(middle('<note><rest measure="yes"/><duration>20</duration></note>'))[0].reasons.join(), /too long/);
});

test('backup / voice forward / unvoiced forward and changing divisions follow the cursor', () => {
  const p = middle(note(4) + '<forward><duration>8</duration><voice>1</voice></forward>' + note(4));
  assert.equal(rhythmIssues(p).length, 0);
  const q = middle('<forward><duration>8</duration></forward>' + note(12));
  assert.match(rhythmIssues(q)[0].reasons.join(), /too long/);
  const r = middle(note(8) + '<attributes><divisions>8</divisions></attributes>' + note(16));
  assert.equal(r.measures[1].durations[0].duration, 4);
  assert.equal(rhythmIssues(r).filter(x => x.measure.index === 2).length, 0);
  assert.match(rhythmIssues(middle('<backup><duration>4</duration></backup>' + full))[0].reasons.join(), /backup/);
  assert.match(rhythmIssues(middle(note(0)))[0].reasons.join(), /Invalid duration/);
  const duplicateVoice = middle(full + '<backup><duration>16</duration></backup>' + full);
  assert.equal(duplicateVoice.measures[1].durations[0].duration, 8);
  assert.match(rhythmIssues(duplicateVoice)[0].reasons.join(), /too long.*overlapping/);
});

test('pickup, final, implicit and OMR split short bars are conservative, overfull edges still flagged', () => {
  const p = analyzeMusic(score([measure(0, attrs() + note()), measure(1, full), measure(2, note())])).parts[0];
  assert.equal(rhythmIssues(p).length, 0);
  assert.match(rhythmIssues(middle(note()))[0].reasons.join(), /too short/);
  const q = analyzeMusic(score([measure(1, attrs() + full), measure(2, note(), 'implicit="yes"'), measure(3, full)])).parts[0];
  assert.equal(rhythmIssues(q).length, 0);
  const r = middle(note()); r.measures[1].location = {special: 'SECOND_HALF'};
  assert.equal(rhythmIssues(r).length, 0);
  assert.match(rhythmIssues(analyzeMusic(score([measure(1, attrs() + note(20))])).parts[0])[0].reasons.join(), /too long/);
});

test('additive, changing and unmetered signatures; partial secondary voice is not assumed wrong', () => {
  const p = middle(attrs('3+2', '8') + note(10));
  assert.equal(rhythmIssues(p).filter(x => x.measure.index === 2).length, 0);
  assert.equal(rhythmIssues(middle(full + '<backup><duration>16</duration></backup>' + note(4, '', '2'))).length, 0);
  assert.equal(rhythmIssues(middle('<attributes><time><senza-misura/></time></attributes>' + note(23))).length, 0);
  const unknown = analyzeMusic(score([measure(1, '<attributes><divisions>4</divisions></attributes>' + full)])).parts[0];
  assert.equal(rhythmIssues(unknown).length, 0);
  const poly = middle('<attributes><time number="2"><beats>4</beats><beat-type>4</beat-type></time><time number="1"><senza-misura/></time></attributes>' + note(20) + '<backup><duration>20</duration></backup>' + note(20, '<staff>2</staff>', '2'));
  assert.match(rhythmIssues(poly)[0].reasons.join(), /Voice 2 too long/);
});

test('marking patches only note opening-tag color bytes, handles existing color and XML syntax', () => {
  const xml = score([measure(1, attrs() + full), measure(2, note(20).replace('<note>', '<note color="blue" default-x=">">')), measure(3, full)]);
  const music = analyzeMusic(xml), marked = markNotes(xml, [music.parts[0].measures[1]]);
  assert.equal(marked, xml.replace('color="blue"', 'color="#E00000"'));
  assert.equal(parseXml(marked).name, 'score-partwise');
  assert.throws(() => parseXml('<a><b></a>'));
  assert.throws(() => parseXml('<!DOCTYPE a [<!ENTITY a SYSTEM "file:///etc/passwd">]><a/>'));
  assert.throws(() => readZip(Buffer.from('bad zip')));
  const corrupted = Buffer.from(mxl(xml)); corrupted[30 + Buffer.byteLength('META-INF/container.xml') + 3] ^= 1;
  assert.throws(() => loadMusic(corrupted));
});

test('OMR resolves physical part 7 to logical P1 and exact exported ordinal; INFO warnings count', () => {
  const music = analyzeMusic(score([measure(1, attrs() + full), measure(2, full), measure(3, full)]));
  const o = readOmr(omr()), map = mapMusic(music, o);
  const error = logDiagnostics('WARN [sample] Error visiting Measure{#2P7} in {Page#1.1}', o, map)[0];
  assert.equal(error.pdfPage, 1); assert.equal(error.locations[0].measure.index, 2);
  assert.equal(music.parts[0].measures[1].location.internalPart, '7');
  const d = logDiagnostics('INFO [sample#1] Measure{#2P7} Voice{#1} too long\nINFO [sample#1] S1 MeasureStack#2 no correct rhythm\nINFO [sample#1] Measure{#2P1} No timeOffset', o, map);
  assert.equal(d[0].locations[0].measure.index, 2);
  assert.equal(d[1].locations[0].measure.index, 2);
  assert.equal(d[2].pageOnly, true);
  const empty = mapMusic(analyzeMusic(score([measure(2, attrs() + full)], {sources: ''})), o);
  assert.equal(empty.locations.length, 0);
});

test('missing measure maps to its original PDF region and flags neighbors without shifting subsequent bars', async () => {
  const xml = score([], {parts: [{id: 'P1', measures: [measure(1, attrs() + full), measure(3, full)]}, {id: 'P2', measures: [measure(1, attrs() + full), measure(2, full), measure(3, full)]}]});
  const result = await review({musicBytes: mxl(xml), omrBytes: omr(), log: '', pdfBytes: await pdf(), pdfName: 'original.pdf'});
  assert.deepEqual(result.summary.parts.map(p => p.measures), [2, 3]);
  const missing = result.summary.findings.find(n => n.measureIndex === null);
  assert.equal(missing.measureNumber, '2'); assert.equal(missing.pdfPage, 1);
  assert.ok(result.summary.findings.some(n => n.partId === 'P1' && n.measureNumber === '3' && n.measureIndex === 2));
});

test('selected sheet 2 / PDF page 5 and absent pages are reported without inventing MusicXML positions', async () => {
  const xml = score([measure(1, attrs() + full), measure(2, full), measure(3, full)], {sources: '<miscellaneous-field name="source-sheet-2">1</miscellaneous-field>'});
  const d = await PDFDocument.create(); for (let i = 0; i < 5; i++) d.addPage([600, 800]);
  const r = await review({musicBytes: mxl(xml), omrBytes: omr({sheet: 2, pdfPage: 5}), log: 'INFO [sample#2] Measure{#99P7} No timeOffset', pdfBytes: await d.save(), pdfName: 'original.pdf'});
  assert.equal(r.summary.pageOnly[0].pdfPage, 5); assert.equal(r.summary.findings.length, 0);
  assert.deepEqual(r.summary.pagesNotExported, [1, 2, 3, 4]);
});

test('PDF geometry handles all right-angle rotations, crop offsets and aspect-ratio fallbacks', async () => {
  const d = await PDFDocument.create(), p = d.addPage([600, 800]);
  const location = {bounds: {left: 60, right: 180, top: 80, bottom: 160}, raster: {width: 600, height: 800}};
  assert.deepEqual(convertBounds(location, pageTransform(p)), {x: 60, y: 80, width: 120, height: 80});
  for (const angle of [90, 270]) {
    p.setRotation(degrees(angle)); const g = pageTransform(p);
    assert.equal(g.width, 800); assert.equal(g.height, 600);
    assert.ok(convertBounds({...location, raster: {width: 800, height: 600}}, g));
    assert.equal(convertBounds(location, g), null);
  }
  p.setRotation(degrees(180)); assert.deepEqual(pageTransform(p).matrix, [-1, 0, 0, 1, 600, 0]);
  p.setCropBox(20, 30, 500, 700); assert.equal(convertBounds(location, pageTransform(p)), null);
  assert.equal(convertBounds(location, pageTransform(p), false), null);
});

test('isolated bundled CLI needs no repo files, preserves input, writes JSON + prose and refuses overwrite', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tutti-review-test-'));
  try {
    const local = path.join(dir, 'review.mjs'), input = path.join(dir, 'draft.mxl');
    await copyFile(script, local);
    const xml = score([measure(1, attrs() + full), measure(2, note(20)), measure(3, full)]), bytes = mxl(xml);
    await writeFile(input, bytes); await writeFile(path.join(dir, 'draft.omr'), omr());
    await writeFile(path.join(dir, 'draft.log'), 'INFO [draft#1] Measure{#2P7} No timeOffset');
    await writeFile(path.join(dir, 'original.pdf'), await pdf());
    const run = spawnSync(process.execPath, [local, input, path.join(dir, 'original.pdf')], {cwd: dir, encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /Compare the marked places/);
    const result = JSON.parse(await readFile(path.join(dir, 'draft-review.json'), 'utf8'));
    assert.equal(result.markedMeasureCount, 1); assert.equal(result.pdf.boxes.length, 1);
    assert.deepEqual(result.findings[0].sources, ['musicxml-rhythm', 'audiveris-log']);
    assert.equal((await readFile(path.join(dir, 'draft-marked.musicxml'), 'utf8')).replace(' color="#E00000"', ''), xml);
    assert.deepEqual(await readFile(input), bytes);
    assert.equal((await PDFDocument.load(await readFile(path.join(dir, 'draft-review.pdf')))).getPageCount(), 1);
    const again = spawnSync(process.execPath, [local, input, path.join(dir, 'original.pdf')], {cwd: dir, encoding: 'utf8'});
    assert.equal(again.status, 2); assert.match(again.stderr, /Refusing to overwrite/);
    assert.equal(spawnSync(process.execPath, [local, '--bad'], {cwd: dir}).status, 2);
    assert.match(await readFile(local, 'utf8'), /Copyright \(c\) 2019 Andrew Dillon/);
  } finally { await rm(dir, {recursive: true, force: true}); }
});


test('a log without a P label belongs to physical parts only, not an invented unprinted part', async () => {
  const xml = score([], {parts: ['P1', 'P2'].map(id => ({id, measures: [measure(1, attrs() + full), measure(2, full), measure(3, full)]}))});
  const r = await review({musicBytes: mxl(xml), omrBytes: omr({logicalId: 2}), log: 'INFO [sample#1] Measure{#2} No timeOffset', pdfBytes: await pdf(), pdfName: 'original.pdf'});
  assert.deepEqual(r.summary.findings.map(f => f.partId), ['P2']);
});


test('pickup rhythm labels stay page-only, surviving chord IDs and export-time Page labels anchor precisely', () => {
  const music = analyzeMusic(score([measure(0, attrs() + note()), measure(1, full), measure(2, full)]));
  const o = readOmr(omr({labels: [0, 1, 2], special: {0: 'PICKUP'}})), map = mapMusic(music, o);
  const ds = logDiagnostics('INFO [sample#1] S1 MeasureStack#2 no correct rhythm\nINFO [sample#1] Measure{#3P7} No timeOffset for HeadChordInter#102\nWARN [sample] Error visiting Measure{#2P7} in {Page#1.1}', o, map);
  assert.equal(ds[0].pageOnly, true);
  assert.equal(ds[1].locations[0].measure.number, '2');
  assert.equal(ds[2].locations[0].measure.index, 3);
});
