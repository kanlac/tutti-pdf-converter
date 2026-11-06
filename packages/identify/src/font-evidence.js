// Read Unicode metadata only; no glyph decoding table or notation recognition.
const privateUse = code => (code >= 0xe000 && code <= 0xf8ff)
  || (code >= 0xf0000 && code <= 0xffffd) || (code >= 0x100000 && code <= 0x10fffd);

function unicode(hex) {
  if (hex.length % 4) return [0xfffd];
  const units = hex.match(/.{4}/g)?.map(value => parseInt(value, 16)) || [];
  const text = String.fromCharCode(...units);
  return [...text].map(char => char.codePointAt(0)).filter(code => code >= 32);
}

export function privateUseOnly(font, lib, cache) {
  if (cache.has(font)) return cache.get(font);
  let result = false;
  try {
    const stream = font?.lookup(lib.PDFName.of('ToUnicode'));
    if (stream instanceof lib.PDFStream && !stream.dict.has(lib.PDFName.of('UseCMap'))) {
      const source = new TextDecoder().decode(lib.decodePDFRawStream(stream).decode());
      if (/\busecmap\b/.test(source)) { cache.set(font, false); return false; }
      const text = source.replace(/<([\da-f\s]+)>/gi, (_, hex) => '<' + hex.replace(/\s/g, '') + '>');
      const codes = [];
      for (const [, block] of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const [, target] of block.matchAll(/<[\da-f]+>\s*<([\da-f]+)>/gi)) codes.push(...unicode(target));
      }
      for (const [, block] of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const [, first, last, target, array] of block.matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*(?:<([\da-f]+)>|\[([^\]]*)\])/gi)) {
          if (array !== undefined) {
            for (const [, value] of array.matchAll(/<([\da-f]+)>/gi)) codes.push(...unicode(value));
          } else {
            const end = BigInt('0x' + target) + BigInt('0x' + last) - BigInt('0x' + first);
            codes.push(...unicode(target), ...unicode(end.toString(16).padStart(target.length, '0')));
          }
        }
      }
      result = codes.length > 0 && codes.every(privateUse);
    }
  } catch {
    // This optional metadata cannot establish private-use-only evidence if unreadable.
  }
  cache.set(font, result);
  return result;
}
