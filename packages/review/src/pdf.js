import {PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix} from '../../identify/vendor/pdf-lib.esm.min.js';

// All geometry below uses the *displayed* PDF crop box, origin at its top left.
export function pageTransform(page) {
  const crop = page.getCropBox(), media = page.getMediaBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const {x, y, width: w, height: h} = crop;
  const width = rotation % 180 ? h : w, height = rotation % 180 ? w : h;
  const matrices = {0: [1, 0, 0, -1, x, y + h], 90: [0, 1, 1, 0, x, y],
    180: [-1, 0, 0, 1, x + w, y], 270: [0, -1, -1, 0, x + w, y + h]};
  return {width, height, matrix: matrices[rotation], cropped: Math.abs(crop.width - media.width) > 1 || Math.abs(crop.height - media.height) > 1 || Math.abs(crop.x - media.x) > 1 || Math.abs(crop.y - media.y) > 1};
}
export function convertBounds(location, geometry, sourceMatches = true) {
  const {bounds: b, raster: r} = location || {};
  if (!sourceMatches || !geometry.matrix || geometry.cropped || !b || !(r.width > 0 && r.height > 0)) return null;
  // Audiveris loads the displayed raster. Different aspect ratios indicate a crop or wrong PDF.
  if (Math.abs((r.width / r.height) / (geometry.width / geometry.height) - 1) > 0.015) return null;
  if (![b.left, b.right, b.top, b.bottom].every(Number.isFinite) || b.left < 0 || b.top < 0 || b.right > r.width || b.bottom > r.height || b.right <= b.left || b.bottom <= b.top) return null;
  return {x: b.left / r.width * geometry.width, y: b.top / r.height * geometry.height,
    width: (b.right - b.left) / r.width * geometry.width, height: (b.bottom - b.top) / r.height * geometry.height};
}
const shortReason = s => /export|missing measure|count|differ/i.test(s) ? 'Check missing bar' : /time offset/i.test(s) ? 'Check timing' : /long|short|rhythm|duration|backup/i.test(s) ? 'Check rhythm' : 'Check measure';
const ascii = s => s.replace(/[^\x20-\x7e]/g, '?');
export async function reviewPdf(bytes, issues, pageOnly, {sourceMatches = true, exportedPages = null, partiallyExportedPages = []} = {}) {
  const doc = await PDFDocument.load(bytes), font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages(), fallback = [], annotations = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i], geometry = pageTransform(page), {width, height, matrix} = geometry;
    if (!matrix) { fallback.push({pdfPage: i + 1, reason: 'Unsupported PDF rotation; see JSON.'}); continue; }
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix));
    const nearby = issues.filter(n => n.pdfPage === i + 1), boxes = new Map(), notes = new Set(pageOnly.filter(n => n.pdfPage === i + 1).map(n => n.reason));
    if (exportedPages && !exportedPages.includes(i + 1)) notes.add('Page not exported');
    if (partiallyExportedPages.includes(i + 1)) notes.add('Only some systems exported');
    for (const item of nearby) {
      const bounds = convertBounds(item.location, geometry, sourceMatches);
      if (!bounds) { notes.add(`${item.partId} bar ${item.measureNumber}: ${[...new Set(item.reasons.map(shortReason))].join(', ')}`); item.pdfMark = 'page-note'; continue; }
      const key = Object.values(bounds).join('/');
      if (!boxes.has(key)) boxes.set(key, {bounds, items: [], reasons: new Set()});
      const box = boxes.get(key); box.items.push(item); item.reasons.map(shortReason).forEach(r => box.reasons.add(r)); item.pdfMark = 'box';
    }
    let label = 0;
    for (const {bounds: b, items, reasons} of [...boxes.values()].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)) {
      page.drawRectangle({x: b.x, y: b.y, width: b.width, height: b.height, borderColor: rgb(.88, 0, 0), color: rgb(1, .1, .1), opacity: .07, borderOpacity: .65, borderWidth: .85});
      const phrase = reasons.has('Check missing bar') ? 'Check missing bar' : reasons.has('Check rhythm') ? 'Check rhythm' : [...reasons][0];
      const text = `${++label}: ${phrase}`;
      // Text is drawn with a local Y flip so it remains upright in top-left coordinates.
      const size = Math.min(6, Math.max(4, (b.width - 4) / font.widthOfTextAtSize(text, 1))), tw = font.widthOfTextAtSize(text, size);
      const tx = Math.max(3, Math.min(width - tw - 3, b.x + 2)), ty = Math.max(8, b.y - 3);
      page.drawRectangle({x: tx - 1, y: ty - 6, width: tw + 2, height: 8, color: rgb(1, 1, 1), opacity: .92});
      drawText(page, text, tx, ty, font, size);
      annotations.push({pdfPage: i + 1, bounds: b, reason: phrase, measures: items.map(n => `${n.partId}/${n.measureIndex}`)});
    }
    if (notes.size) {
      const text = `Page ${i + 1}: possible problems: ${[...notes].join('; ')}`;
      // Reserve a visible page-edge panel; never silently truncate diagnostics.
      const lines = wrap(ascii(text), width - 16, font, 7), panel = Math.min(height - 16, lines.length * 9 + 10);
      page.drawRectangle({x: 4, y: 4, width: width - 8, height: panel, color: rgb(1, 1, 1), opacity: .95, borderColor: rgb(.88, 0, 0), borderWidth: .7});
      for (let j = 0; j < lines.length && 14 + j * 9 < panel; j++) drawText(page, lines[j], 8, 14 + j * 9, font, 7);
      fallback.push({pdfPage: i + 1, reasons: [...notes], overflow: lines.length * 9 + 10 > panel});
    }
    page.pushOperators(popGraphicsState());
  }
  return {bytes: await doc.save(), annotations, fallback, pageCount: pages.length};
}
function drawText(page, text, x, y, font, size) {
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, x, y));
  page.drawText(ascii(text), {x: 0, y: 0, size, font, color: rgb(.8, 0, 0), rotate: degrees(0)});
  page.pushOperators(popGraphicsState());
}
function wrap(text, width, font, size) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    if (line && font.widthOfTextAtSize(line + ' ' + word, size) > width) { lines.push(line); line = word; }
    else line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines;
}
