// A small, non-validating XML reader. Keeps source offsets so marking never serializes music.
// External entities and DTD subsets are deliberately unsupported; nothing is fetched.
export function decode(s = '') {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, v) => {
    if (v[0] === '#') return String.fromCodePoint(v[1].toLowerCase() === 'x' ? parseInt(v.slice(2), 16) : +v.slice(1));
    return {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"}[v];
  });
}
export function parseXml(xml) {
  if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(xml)) throw new Error('XML entity declarations / DTD subsets are unsupported');
  const doc = {name: '#document', children: [], start: 0}, stack = [doc];
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/?[A-Za-z_](?:[^<>\"']|\"[^\"]*\"|'[^']*')*?>/g;
  let m, end = 0;
  while ((m = token.exec(xml))) {
    const raw = m[0], parent = stack.at(-1);
    if (xml.slice(end, m.index).includes('<')) throw new Error('Malformed XML');
    parent.text = (parent.text || '') + xml.slice(end, m.index);
    end = token.lastIndex;
    if (raw.startsWith('<![CDATA[')) { parent.text += raw.slice(9, -3); continue; }
    if (/^<[!?]/.test(raw)) continue;
    if (raw.startsWith('</')) {
      const name = raw.slice(2, -1).trim();
      if (stack.length === 1 || stack.at(-1).qname !== name) throw new Error('Mismatched XML closing tag: ' + name);
      const node = stack.pop(); node.end = end; continue;
    }
    const qname = /^<([^\s/>]+)/.exec(raw)[1], attrs = {};
    const tail = raw.slice(qname.length + 1).replace(/\/?\s*>$/, '');
    let consumed = 0;
    const attr = /\s+([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/g;
    for (const a of tail.matchAll(attr)) {
      if (tail.slice(consumed, a.index).trim()) throw new Error('Malformed XML attributes');
      if (Object.hasOwn(attrs, a[1])) throw new Error('Duplicate XML attribute');
      attrs[a[1]] = decode(a[2].slice(1, -1)); consumed = a.index + a[0].length;
    }
    if (tail.slice(consumed).trim()) throw new Error('Malformed XML attributes');
    const node = {name: qname.split(':').at(-1), qname, attrs, children: [], text: '', start: m.index, openEnd: end};
    parent.children.push(node);
    if (/\/\s*>$/.test(raw)) node.end = end; else stack.push(node);
  }
  if (stack.length !== 1 || xml.slice(end).includes('<') || doc.children.length !== 1) throw new Error('Incomplete XML');
  return doc.children[0];
}
export const children = (n, name) => n?.children.filter(c => c.name === name) || [];
export const child = (n, name) => children(n, name)[0];
export const value = n => decode(n?.text || '').trim();
export const number = (n, name) => Number(value(child(n, name)));
export function descendants(n, name) {
  return (n?.children || []).flatMap(c => [...(c.name === name ? [c] : []), ...descendants(c, name)]);
}
export function markNotes(xml, measures) {
  const notes = measures.flatMap(m => children(m.node, 'note')).sort((a, b) => b.start - a.start);
  for (const n of notes) {
    let tag = xml.slice(n.start, n.openEnd);
    if (/\scolor\s*=/.test(tag)) tag = tag.replace(/(\scolor\s*=\s*)("[^"]*"|'[^']*')/, '$1"#E00000"');
    else tag = tag.replace(/\/?\s*>$/, m => ' color="#E00000"' + m);
    xml = xml.slice(0, n.start) + tag + xml.slice(n.openEnd);
  }
  return xml;
}
