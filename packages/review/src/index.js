import path from 'node:path';
import {analyzeMusic, loadMusic, rhythmIssues} from './music.js';
import {readOmr, mapMusic, logDiagnostics} from './omr.js';
import {markNotes} from './xml.js';
import {reviewPdf} from './pdf.js';

export async function review({musicBytes, omrBytes, log, pdfBytes, pdfName}) {
  const xml = loadMusic(musicBytes), music = analyzeMusic(xml), omr = readOmr(omrBytes), mapping = mapMusic(music, omr);
  const issues = new Map(), pageOnly = [], warnings = [...mapping.warnings];
  const add = (part, measure, reason, source, location = measure?.location, raw) => {
    const key = part.id + '/' + (measure?.index ?? `missing:${location?.label}:${location?.sheet}:${location?.system}`);
    if (!issues.has(key)) issues.set(key, {partId: part.id, partName: part.name, measureIndex: measure?.index ?? null,
      measureNumber: measure?.number ?? location?.label ?? null, pdfPage: location?.pdfPage ?? null,
      reasons: [], sources: [], evidence: [], location: location || null, _measure: measure});
    const issue = issues.get(key);
    if (!issue.reasons.includes(reason)) issue.reasons.push(reason);
    if (!issue.sources.includes(source)) issue.sources.push(source);
    if (raw && !issue.evidence.includes(raw)) issue.evidence.push(raw);
  };
  for (const p of music.parts) for (const {measure, reasons} of rhythmIssues(p)) for (const r of reasons) add(p, measure, r, 'musicxml-rhythm');
  const counts = music.parts.map(p => ({id: p.id, name: p.name, measures: p.measures.length, mappedMeasures: p.measures.filter(m => m.location).length}));
  // Missing measures are localized by the validated OMR sequence, not by comparing array indices.
  for (const l of mapping.missing) {
    const p = music.parts.find(p => p.id === l.partId);
    add(p, null, 'Missing measure in exported part', 'part-measure-count', l);
    const locs = mapping.locations.filter(n => n.partId === p.id), pos = locs.indexOf(l);
    for (const n of [locs[pos - 1], locs[pos + 1]]) if (n?.measure) add(p, n.measure, 'Near missing measure', 'part-measure-count');
    for (const q of music.parts.filter(q => q !== p)) {
      const m = q.measures.find(m => m.location?.sheet === l.sheet && m.location?.system === l.system && m.location?.internalMeasure === l.internalMeasure && m.location?.omrPage === l.omrPage);
      if (m) add(q, m, 'Other part missing this measure', 'part-measure-count');
    }
  }
  if (new Set(counts.map(p => p.measures)).size > 1 && !mapping.missing.length) {
    warnings.push('Part measure counts differ; no validated OMR gap. Review the first differing measure labels and the part endings.');
    const max = Math.max(...counts.map(p => p.measures));
    for (const p of music.parts) {
      const other = music.parts.find(q => q.measures.length === max);
      if (!other || other === p) continue;
      let first = p.measures.findIndex((m, i) => m.number !== other.measures[i]?.number);
      if (first < 0) first = p.measures.length;
      for (const q of [p, other]) for (const m of q.measures.slice(Math.max(0, first - 1), first + 2)) add(q, m, 'Part measure counts differ near here', 'part-measure-count');
    }
  }
  const diagnostics = logDiagnostics(log, omr, mapping);
  for (const d of diagnostics) {
    if (d.pageOnly) { pageOnly.push({pdfPage: d.pdfPage, reason: d.reason, source: d.source, evidence: d.raw, detail: d.pdfPage ? `Only known to be near PDF page ${d.pdfPage}` : 'PDF page unknown'}); continue; }
    for (const l of d.locations) {
      const p = music.parts.find(p => p.id === l.partId);
      add(p, l.measure, d.reason, d.source, l, d.raw);
    }
  }
  const sourceMatches = !pdfName || [omr.source].filter(Boolean).some(s => path.basename(s.replaceAll('\\', '/')) === path.basename(pdfName));
  if (!sourceMatches) warnings.push('PDF filename differs from the OMR source; boxes disabled. Confirm this is the original PDF.');
  const findings = [...issues.values()];
  const exportSheets = new Set(music.sources.map(s => s.sheet));
  const exportPages = new Set(omr.sheets.filter(s => exportSheets.has(s.sheet)).map(s => s.pdfPage));
  const partiallyExportedPages = [...exportPages].filter(page => {
    const selected = music.sources.filter(s => omr.sheets.find(n => n.sheet === s.sheet)?.pdfPage === page).flatMap(s => s.systems.map(id => `${s.sheet}/${id}`));
    return omr.pages.filter(p => p.pdfPage === page).flatMap(p => p.systems.map(s => `${p.sheet}/${s.id}`)).some(k => !selected.includes(k));
  });
  const pdf = await reviewPdf(pdfBytes, findings, pageOnly, {sourceMatches,
    exportedPages: music.sources.length ? [...exportPages] : null, partiallyExportedPages});
  const pagesNotExported = Array.from({length: pdf.pageCount}, (_, i) => i + 1).filter(p => !exportPages.has(p));
  if (!music.sources.length) warnings.push('No source-sheet metadata: exported pages are unknown, not confirmed missing.');
  const markedMeasures = [...new Set(findings.map(n => n._measure).filter(Boolean))];
  const summary = {schemaVersion: 1, parts: counts, markedMeasureCount: markedMeasures.length,
    findings: findings.map(({_measure, location, ...n}) => ({...n, location: location ? {...location, measure: undefined} : null})),
    pageOnly, pagesNotExported: music.sources.length ? pagesNotExported : null, partiallyExportedPages,
    invalidPages: omr.sheets.filter(s => s.invalid).map(s => s.pdfPage),
    pdf: {boxes: pdf.annotations, pageNotes: pdf.fallback}, warnings,
    limitations: ['These are review hints, not a correctness score. Unmarked notes can still have pitch, accidental, rhythm or missing-content errors.',
      'Short first/last/implicit/pickup/split bars and incomplete secondary voices are treated conservatively.',
      'Precise mapping requires Audiveris source-sheet metadata and a unique OMR score/measure sequence.',
      'Rhythm logs on pickup pages stay page-only unless a surviving chord ID anchors them; export-time errors use the saved page/measure labels.',
      'Boxes require matching source filename, raster aspect ratio and uncropped orthogonal PDF geometry; source identity is not cryptographically verified.']};
  const missing = summary.pagesNotExported === null ? 'unknown' : summary.pagesNotExported.join(', ') || 'none';
  const human = `Review ${markedMeasures.length} marked part-measures and ${pageOnly.length} page-only log hints. ` +
    `Part measure counts: ${counts.map(p => `${p.id} (${p.name}) ${p.measures}`).join('; ')}. ` +
    `Pages not exported: ${missing}. Partially exported pages: ${partiallyExportedPages.join(', ') || 'none'}. ` +
    `${pdf.annotations.length} PDF boxes; ${pdf.fallback.length} pages with margin notes. ` +
    'Compare the marked places with the original, then check the rest: unmarked music may still be wrong.';
  return {markedXml: markNotes(xml, markedMeasures), pdfBytes: pdf.bytes, summary: {...summary, humanSummary: human}, human};
}
