import {inspectionError} from './messages.js';

// A bounded PDF content lexer. Strings/arrays are opaque operands, never operators.
export function* tokens(text) {
  let i = 0;
  const delimiter = /[\s\0()[\]<>\/%]/;
  while (i < text.length) {
    const c = text[i];
    if (/[\s\0]/.test(c)) { i++; continue; }
    if (c === '%') { while (i < text.length && !/[\r\n]/.test(text[i])) i++; continue; }
    if (c === '(') {
      let depth = 1; i++;
      while (i < text.length && depth) {
        if (text[i] === '\\') i += 2;
        else { if (text[i] === '(') depth++; if (text[i] === ')') depth--; i++; }
      }
      if (depth) throw inspectionError('unclosed_string');
      yield {type: 'string'}; continue;
    }
    if (c === '<' && text[i + 1] !== '<') {
      const end = text.indexOf('>', ++i);
      if (end < 0) throw inspectionError('unclosed_hex');
      i = end + 1; yield {type: 'string'}; continue;
    }
    if ('[]'.includes(c)) { i++; yield {type: c}; continue; }
    if (c === '<' || c === '>') { i += 2; yield {type: 'dictionary'}; continue; }
    const name = c === '/';
    const start = name ? ++i : i;
    while (i < text.length && !delimiter.test(text[i])) i++;
    if (i === start) throw inspectionError('invalid_token');
    const value = text.slice(start, i).replace(/#([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    yield {type: name ? 'name' : ['true', 'false', 'null'].includes(value) ? 'literal' : /^[-+.\d]+$/.test(value) ? 'number' : 'operator', value};
  }
}
