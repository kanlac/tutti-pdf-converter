import {parseXml, children, child, descendants, value, number} from './xml.js';
import {readZip, xmlText} from './zip.js';

export function loadMusic(bytes) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return xmlText(bytes);
  const zip = readZip(bytes), container = zip.get('META-INF/container.xml');
  if (!container) throw new Error('MXL has no container.xml');
  const roots = descendants(parseXml(xmlText(container())), 'rootfile');
  const file = roots.find(n => n.attrs['media-type'] === 'application/vnd.recordare.musicxml+xml') || roots[0];
  if (!file || !zip.has(file.attrs['full-path'])) throw new Error('MXL score rootfile missing');
  return xmlText(zip.get(file.attrs['full-path'])());
}

const eps = 1e-7;
function meter(time) {
  if (child(time, 'senza-misura')) return null;
  const beats = children(time, 'beats'), units = children(time, 'beat-type');
  if (!beats.length || beats.length !== units.length) return null;
  const lengths = beats.map((n, i) => value(n).split('+').reduce((s, x) => s + Number(x.trim()), 0) * 4 / Number(value(units[i])));
  return lengths.every(x => Number.isFinite(x) && x > 0) ? lengths.reduce((s, x) => s + x, 0) : null;
}
export function analyzeMusic(xml) {
  const root = parseXml(xml);
  if (root.name !== 'score-partwise') throw new Error('Only score-partwise MusicXML is supported');
  const names = new Map(children(child(root, 'part-list'), 'score-part').map(n => [n.attrs.id, value(child(n, 'part-name'))]));
  const parts = children(root, 'part').map(p => {
    let divisions = null, meters = new Map(), unmetered = false;
    const measures = children(p, 'measure').map((node, index) => {
      let cursor = 0, previousOnset = null, previousEvent = null, previousVoice = null, previousGrace = false, invalid = false;
      const voices = new Map();
      const get = id => {
        if (!voices.has(id)) voices.set(id, {id, intervals: [], staffs: new Set(), fullRest: false});
        return voices.get(id);
      };
      for (const item of node.children) {
        if (item.name === 'attributes') {
          if (child(item, 'divisions')) divisions = number(item, 'divisions');
          for (const t of children(item, 'time')) {
            const m = meter(t); unmetered = child(t, 'senza-misura') !== undefined;
            meters.set(t.attrs.number || '*', m);
          }
        }
        if (['backup', 'forward', 'note'].includes(item.name)) {
          if (item.name === 'note' && child(item, 'grace')) {
            previousOnset = cursor; previousGrace = true; continue;
          }
          if (item.name === 'note' && child(item, 'chord') && previousGrace) continue;
          const rest = child(item, 'rest');
          const dur = child(item, 'duration');
          const duration = dur && divisions > 0 ? Number(value(dur)) / divisions : null;
          const v = value(child(item, 'voice')) || '1', staff = value(child(item, 'staff')) || '1';
          if (item.name === 'note') {
            const voice = get(v); voice.staffs.add(staff);
            // A whole-measure rest may omit duration, and remains valid in any meter.
            if (rest?.attrs.measure === 'yes') voice.fullRest = true;
            if (duration === null || !Number.isFinite(duration) || duration <= 0) {
              if (!voice.fullRest) invalid = true;
              continue;
            }
            // MusicXML <duration> is already the performed duration, including tuplets.
            // Do NOT multiply it by time-modification a second time.
            const onset = child(item, 'chord') ? previousOnset : cursor;
            if (onset === null) { invalid = true; continue; }
            if (child(item, 'chord')) {
              if (!previousEvent || previousVoice !== v) invalid = true;
              else previousEvent[1] = Math.max(previousEvent[1], onset + duration);
            } else {
              previousEvent = [onset, onset + duration]; previousVoice = v;
              voice.intervals.push(previousEvent);
              previousOnset = onset; previousGrace = false; cursor += duration;
            }
          } else {
            previousOnset = null; previousEvent = null; previousVoice = null; previousGrace = false;
            if (duration === null || !Number.isFinite(duration) || duration <= 0) { invalid = true; continue; }
            if (item.name === 'backup') { cursor -= duration; if (cursor < -eps) invalid = true; }
            else {
              // A voice-specific forward represents intentional silence in that voice.
              if (child(item, 'voice')) { const voice = get(v); voice.staffs.add(staff); voice.intervals.push([cursor, cursor + duration]); }
              cursor += duration;
            }
          }
        }
      }
      const durations = [...voices.values()].map(v => {
        const intervals = v.intervals.sort((a, b) => a[0] - b[0]);
        let covered = 0, end = -Infinity, overlap = false;
        // Each interval is a root event (chord members already merged into their root).
        // Backup can expose overlapping independent events in the same voice; retain them.
        for (const [a, b] of intervals) {
          if (a < end - eps) overlap = true;
          covered += b - a; end = Math.max(end, b);
        }
        const expected = [...v.staffs].map(s => meters.has(s) ? meters.get(s) : meters.get('*'));
        const target = expected.length && expected.every(x => x === expected[0]) ? expected[0] : null;
        return {voice: v.id, duration: covered, end: Number.isFinite(end) ? end : 0,
          start: intervals[0]?.[0] || 0, expected: target ?? null, fullRest: v.fullRest, overlap};
      });
      return {node, index: index + 1, number: node.attrs.number || '', durations, invalid, unmetered};
    });
    return {id: p.attrs.id, name: names.get(p.attrs.id) || p.attrs.id, measures};
  });
  if (!parts.length || new Set(parts.map(p => p.id)).size !== parts.length) throw new Error('Missing or duplicate score parts');
  const sources = descendants(root, 'miscellaneous-field').filter(n => /^source-sheet-\d+$/.test(n.attrs.name || '')).map(n => ({sheet: +n.attrs.name.slice(13), systems: value(n).split(/\s+/).map(Number)}));
  return {parts, sources};
}
export function rhythmIssues(part) {
  const issues = [];
  for (const m of part.measures) {
    const reasons = [];
    if (m.invalid) reasons.push('Invalid duration or backup');
    for (const v of m.durations) {
      if ((v.fullRest && v.duration === 0) || v.expected === null) continue;
      const short = v.duration < v.expected - eps && v.end <= v.expected + eps;
      // Short edge bars, explicit implicit bars and OMR split/pickup bars are review exemptions.
      const edge = m.index === 1 || m.index === part.measures.length || m.node.attrs.implicit === 'yes' || /PICKUP|FIRST_HALF|SECOND_HALF/.test(m.location?.special || '');
      if (short && edge) continue;
      if (v.duration > v.expected + eps || v.end > v.expected + eps || v.start < -eps) reasons.push(`Voice ${v.voice} too long (${fmt(v.duration)}/${fmt(v.expected)} quarters)`);
      else if (short) {
        // Secondary voices may enter or leave within a bar without explicit rests.
        // Only flag underfull voices spanning the bar's whole timeline, or an underfull bar overall.
        const anyFull = m.durations.some(o => o.end >= v.expected - eps || o.fullRest);
        if (!anyFull || (v.start <= eps && v.end >= v.expected - eps)) reasons.push(`Voice ${v.voice} too short (${fmt(v.duration)}/${fmt(v.expected)} quarters)`);
      }
      if (v.overlap) reasons.push(`Voice ${v.voice} overlapping durations`);
    }
    if (reasons.length) issues.push({measure: m, reasons: [...new Set(reasons)]});
  }
  return issues;
}
const fmt = n => Number(n.toFixed(5));
