import {readZip, xmlText} from './zip.js';
import {parseXml, children, child, descendants, value} from './xml.js';

function staffBounds(part) {
  const staves = children(part, 'staff');
  const lines = staves.flatMap(s => descendants(child(s, 'lines'), 'line'));
  const points = lines.flatMap(l => children(l, 'point')).map(p => [+p.attrs.x, +p.attrs.y]);
  if (!points.length) return null;
  const ys = points.map(p => p[1]);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const spacing = lines.length > staves.length ? (bottom - top) / Math.max(4, lines.length - 1) : 20;
  return {top: top - spacing * 1.4, bottom: bottom + spacing * 1.4};
}
export function readOmr(bytes) {
  const zip = readZip(bytes), bookFile = zip.get('book.xml');
  if (!bookFile) throw new Error('OMR book.xml missing');
  const book = parseXml(xmlText(bookFile())), pages = [], sheets = [];
  for (const stub of children(book, 'sheet')) {
    const sheet = +stub.attrs.number, file = zip.get(`sheet#${sheet}/sheet#${sheet}.xml`);
    const pdfPage = Number(value(child(child(stub, 'input'), 'number'))) || sheet;
    sheets.push({sheet, pdfPage, invalid: stub.attrs.invalid === 'true', complete: /\bPAGE\b/.test(value(child(stub, 'steps')))});
    if (!file) continue;
    const root = parseXml(xmlText(file())), picture = child(root, 'picture');
    for (const p of children(root, 'page')) {
      const bp = children(stub, 'page').find(n => n.attrs.id === p.attrs.id);
      const systems = children(p, 'system').map((s, si) => {
        const physical = children(s, 'part'), logical = children(children(bp, 'system')[si], 'part');
        const parts = physical.map((part, pi) => ({physicalId: part.attrs.id, logicalId: logical[pi]?.attrs['logical-id'], bounds: staffBounds(part), measures: children(part, 'measure').map(m => ({id: m.attrs.id,
          chordIds: ['head-chords', 'rest-chords'].flatMap(tag => value(child(m, tag)).split(/\s+/).filter(Boolean)),
          voices: Object.fromEntries(children(m, 'voice').map(v => [v.attrs.id, v.attrs.excess || null]))}))}));
        return {id: +s.attrs.id, parts, stacks: children(s, 'stack').filter(n => n.attrs.special !== 'CAUTIONARY').map(n => ({id: n.attrs.id, left: +n.attrs.left, right: +n.attrs.right, special: n.attrs.special || null}))};
      });
      pages.push({sheet, pdfPage, pageId: p.attrs.id, width: +picture?.attrs.width, height: +picture?.attrs.height,
        delta: Number(bp?.attrs['delta-measure-id']), systems});
    }
  }
  const scores = children(book, 'score').map(s => children(s, 'page').map(p => pages.find(n => n.sheet === +p.attrs['sheet-number'] && n.pageId === p.attrs['sheet-page-id'])).filter(Boolean));
  return {pages, sheets, scores, source: book.attrs.path};
}

export function mapMusic(music, omr) {
  const warnings = [], selected = music.sources.flatMap(s => s.systems.map(id => `${s.sheet}/${id}`));
  const matches = omr.scores.filter(pages => {
    const keys = pages.flatMap(p => p.systems.map(s => `${p.sheet}/${s.id}`));
    return keys.length === selected.length && keys.every(k => selected.includes(k));
  });
  if (matches.length !== 1 || !selected.length || new Set(selected).size !== selected.length) {
    warnings.push('Cannot uniquely match exported systems to an OMR score; log locations stay page-only.');
    return {locations: [], warnings, missing: [], mappedPages: []};
  }
  const pages = matches[0], locations = [];
  let offset = 0;
  for (const p of pages) {
    for (const s of p.systems) for (const t of s.stacks) {
      const match = /^(\d+)(.*)$/.exec(t.id);
      if (!match || !Number.isFinite(offset)) continue;
      const label = String(+match[1] + offset) + match[2];
      for (const part of music.parts) {
        const logicalId = /^P(\d+)$/.exec(part.id)?.[1];
        if (!logicalId) continue;
        const physical = s.parts.find(n => n.logicalId === logicalId);
        const omrMeasure = physical?.measures.find(m => m.id === t.id);
        locations.push({pdfPage: p.pdfPage, sheet: p.sheet, omrPage: p.pageId, system: s.id,
          internalMeasure: t.id, internalPart: physical?.physicalId || null, partId: part.id, label,
          special: t.special, pickupOnPage: p.systems.some(s => s.stacks.some(t => t.special === 'PICKUP')),
          chordIds: omrMeasure?.chordIds || [], voices: omrMeasure?.voices || {}, raster: {width: p.width, height: p.height},
          bounds: physical?.bounds ? {left: t.left, right: t.right, ...physical.bounds} : null});
      }
    }
    offset += p.delta;
  }
  const missing = [];
  for (const part of music.parts) {
    const expected = locations.filter(l => l.partId === part.id), used = new Set();
    let previous = -1;
    const assignments = [];
    for (const m of part.measures) {
      const candidates = expected.map((l, i) => ({l, i})).filter(x => x.l.label === m.number);
      if (candidates.length !== 1 || candidates[0].i <= previous) { assignments.length = 0; break; }
      const {l, i} = candidates[0];
      const print = child(m.node, 'print');
      const prior = expected[previous];
      if ((print?.attrs['new-page'] === 'yes' && prior?.pdfPage === l.pdfPage) ||
          (print?.attrs['new-system'] === 'yes' && prior?.sheet === l.sheet && prior?.system === l.system)) { assignments.length = 0; break; }
      assignments.push([m, l]); used.add(i); previous = i;
    }
    if (!assignments.length) {
      warnings.push(`Cannot validate measure sequence for ${part.id}; no precise mapping for this part.`);
      continue;
    }
    for (const l of expected) l.validated = true;
    for (const [m, l] of assignments) { m.location = l; l.measure = m; }
    for (let i = 0; i < expected.length; i++) if (!used.has(i)) missing.push(expected[i]);
  }
  return {locations, warnings, missing, mappedPages: [...new Set(locations.filter(l => l.measure).map(l => l.pdfPage))]};
}

export function logDiagnostics(log, omr, mapping) {
  const diagnostics = [];
  for (const line of log.split(/\r?\n/)) {
    let reason;
    if (/no correct rhythm/i.test(line)) reason = 'No correct rhythm';
    else if (/Voice.*too long/i.test(line)) reason = 'Voice too long';
    else if (/No timeOffset/i.test(line)) reason = 'Missing time offset';
    else if (/Error visiting Measure\{/i.test(line)) reason = 'Measure export error';
    else if (/flagged as invalid|No system found|Could not export since/i.test(line)) reason = 'Page not transcribed';
    if (!reason) continue;
    const page = /\{Page#(\d+)\.(\d+)\}/.exec(line);
    const tag = /\[([^\]]+)#(\d+)\]/.exec(line), sheet = tag ? +tag[2] : page ? +page[1] : null;
    const pdfPage = omr.sheets.find(s => s.sheet === sheet)?.pdfPage ?? sheet;
    const measure = /Measure\{#([^}P\s]+)(?:P(\d+))?\}/.exec(line);
    const stack = /\bS(\d+)\s+MeasureStack#([^\s]+)/.exec(line);
    let locations = mapping.locations.filter(l => l.validated && l.internalPart !== null && l.sheet === sheet);
    if (page) locations = locations.filter(l => l.sheet === +page[1] && l.omrPage === page[2]);
    const chord = /(?:Head|Rest|Small)ChordInter#(\d+)/.exec(line);
    if (chord) {
      // Inter IDs survive the pickup renumbering performed after RHYTHMS.
      locations = locations.filter(l => l.chordIds.includes(chord[1]));
    } else {
      if (measure) {
        locations = locations.filter(l => l.internalMeasure === measure[1] && (!measure[2] || l.internalPart === measure[2]));
      } else if (stack) locations = locations.filter(l => l.system === +stack[1] && l.internalMeasure === stack[2]);
      else locations = [];
      // Rhythm logs can precede PICKUP numbering (1 becomes 0). Do not guess an offset.
      if (reason !== 'Measure export error' && locations.some(l => l.pickupOnPage)) locations = [];
      const voice = /Voice\{#(\d+)\s+excess:([^}\s]+)/.exec(line);
      if (voice) locations = locations.filter(l => l.voices[voice[1]] === voice[2]);
    }
    // The same internal measure number can recur in separate logical pages/movements.
    const positions = new Set(locations.map(l => `${l.sheet}/${l.omrPage}/${l.system}/${l.internalMeasure}`));
    if (positions.size !== 1) locations = [];
    diagnostics.push({reason, source: 'audiveris-log', pdfPage, sheet,
      raw: line.trim(), locations, pageOnly: !locations.length});
  }
  return diagnostics;
}
