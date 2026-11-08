import {crc32} from '../packages/review/src/zip.js';
export function zip(files) {
  const records = [], data = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name), b = Buffer.from(text), crc = crc32(b);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(b.length, 18); local.writeUInt32LE(b.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(b.length, 20); central.writeUInt32LE(b.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    records.push(central, n); data.push(local, n, b); offset += local.length + n.length + b.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(records.reduce((s, b) => s + b.length, 0), 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...data, ...records, end]);
}
export const note = (duration = 4, extra = '', voice = '1') => `<note>${extra}<pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>quarter</type></note>`;
export const attrs = (beats = '4', unit = '4', divisions = 4) => `<attributes><divisions>${divisions}</divisions><time><beats>${beats}</beats><beat-type>${unit}</beat-type></time></attributes>`;
export const measure = (num, content, extra = '') => `<measure number="${num}" ${extra}>${content}</measure>`;
export function score(measures, {sources = '<miscellaneous-field name="source-sheet-1">1</miscellaneous-field>', parts} = {}) {
  const ps = parts || [{id: 'P1', measures}];
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise><identification><miscellaneous>${sources}</miscellaneous></identification><part-list>${ps.map(p => `<score-part id="${p.id}"><part-name>${p.id}</part-name></score-part>`).join('')}</part-list>${ps.map(p => `<part id="${p.id}">${p.measures.join('')}</part>`).join('')}</score-partwise>`;
}
export function omr({labels = [1, 2, 3], sheet = 1, pdfPage = sheet, physicalId = 7, logicalId = 1, width = 600, height = 800, source = 'original.pdf', special = {}} = {}) {
  return zip({'book.xml': `<book path="${source}"><sheet number="${sheet}"><input><number>${pdfPage}</number></input><steps>LOAD PAGE</steps><page id="1" delta-measure-id="${labels.at(-1)}"><system><part logical-id="${logicalId}"/></system></page></sheet><score><logical-part id="${logicalId}"/><page sheet-number="${sheet}" sheet-page-id="1"/></score></book>`,
    [`sheet#${sheet}/sheet#${sheet}.xml`]: `<sheet><picture width="${width}" height="${height}"/><page id="1"><system id="1">${labels.map((n, i) => `<stack id="${n}" left="${30 + i * 150}" right="${180 + i * 150}" ${special[n] ? `special="${special[n]}"` : ''}/>`).join('')}<part id="${physicalId}">${labels.map(n => `<measure id="${n}"><head-chords>${100 + n}</head-chords></measure>`).join('')}<staff><lines>${[200, 210, 220, 230, 240].map(y => `<line><point x="30" y="${y}"/><point x="570" y="${y}"/></line>`).join('')}</lines></staff></part></system></page></sheet>`});
}
export function mxl(xml) { return zip({'META-INF/container.xml': '<container><rootfiles><rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>', 'score.xml': xml}); }
