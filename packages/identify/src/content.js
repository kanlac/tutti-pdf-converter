import {tokens} from './tokens.js';
import {inspectionError, reason} from './messages.js';
import {paint, graphicsState, fontName} from './paint.js';

// Bounds for one page. Long documents do not exhaust later pages' inspection.
const MAX_DECODED_BYTES = 16 * 1024 * 1024;
const MAX_OPERATIONS = 2000000;
const MAX_DEPTH = 32;
const VALID = new Set(('q Q cm w J j M d ri i gs m l c v y h re S s f F f* B B* b b* n W W* '
  + 'BT ET Tc Tw Tz TL Tf Tr Ts Td TD Tm T* Tj TJ \' " d0 d1 CS cs SC SCN sc scn G g RG rg K k sh Do '
  + 'MP DP BMC BDC EMC BX EX').split(' '));

export function inspectPage(page, lib) {
  const ev = {fonts: new Set(), paintedFonts: new Set(), imagePaints: 0, rasterImagePaints: 0, images: new Map(), pathPaints: 0,
    textShows: 0, shadingPaints: 0, complete: true, issues: []};
  const budget = {bytes: MAX_DECODED_BYTES, operations: MAX_OPERATIONS};
  function issue(error) {
    ev.complete = false;
    const code = error.inspectionCode || 'content_error';
    if (!ev.issues.some(item => item.code === code)) ev.issues.push(reason(code));
  }
  const env = {lib, context: page.doc.context, ev, budget, issue};
  env.visit = (ref, resources, state, ancestors = new Set()) => {
    try { visit(ref, resources, state, ancestors, env); } catch (error) { issue(error); }
  };
  try {
    const resources = page.node.getInheritableAttribute(lib.PDFName.of('Resources'));
    const contents = page.node.Contents();
    const list = contents instanceof lib.PDFArray ? contents.asArray() : contents ? [contents] : [];
    const state = graphicsState();
    for (const stream of list) env.visit(stream, resources, state);
  } catch (error) { issue(error); }
  return {...ev, fonts: [...ev.fonts].sort(), paintedFonts: [...ev.paintedFonts].sort(), images: [...ev.images.values()]};
}

function visit(ref, resourceRef, state, ancestors, env) {
  const {lib, context, ev, budget, issue} = env;
  const stream = context.lookup(ref);
  if (!(stream instanceof lib.PDFStream)) throw inspectionError('invalid_stream');
  if (ancestors.has(stream) || ancestors.size >= MAX_DEPTH) throw inspectionError('cyclic_form');
  const active = new Set(ancestors).add(stream);
  const resources = context.lookup(resourceRef);
  if (resources && !(resources instanceof lib.PDFDict)) throw inspectionError('invalid_resources');
  const fonts = resources?.lookup(lib.PDFName.of('Font'));
  if (fonts instanceof lib.PDFDict) {
    for (const [, ref] of fonts.entries()) {
      try {
        const name = fontName(context.lookup(ref), lib);
        if (name) ev.fonts.add(name);
      } catch (error) { issue(error); }
    }
  }
  const bytes = lib.decodePDFRawStream(stream).decode();
  budget.bytes -= bytes.length;
  if (budget.bytes < 0) throw inspectionError('byte_budget');
  const operands = [];
  for (const token of tokens(new TextDecoder('latin1').decode(bytes))) {
    if (--budget.operations < 0) throw inspectionError('operation_budget');
    if (token.type !== 'operator') { operands.push(token); continue; }
    const op = token.value;
    if (op === 'BI') throw inspectionError('inline_image');
    if (!VALID.has(op)) {
      if (!state.compatibility) issue(inspectionError('unsupported_operator'));
    } else {
      try { paint(op, operands, resources, state, active, env); } catch (error) { issue(error); }
    }
    operands.length = 0;
  }
}
