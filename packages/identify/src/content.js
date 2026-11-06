import {tokens} from './tokens.js';
import {inspectionError, reason} from './messages.js';

// Bounds are safety limits for local inspection, never notation geometry rules.
const MAX_DECODED_BYTES = 16 * 1024 * 1024;
const MAX_OPERATIONS = 200000;
const MAX_DEPTH = 32;
const PATH_PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const SHOW_TEXT = new Set(['Tj', 'TJ', "'", '"']);
const VALID = new Set(('q Q cm w J j M d ri i gs m l c v y h re S s f F f* B B* b b* n W W* '
  + 'BT ET Tc Tw Tz TL Tf Tr Ts Td TD Tm T* Tj TJ \' " d0 d1 CS cs SC SCN sc scn G g RG rg K k sh Do '
  + 'MP DP BMC BDC EMC BX EX').split(' '));

export function inspectPage(page, lib, budget) {
  const ev = {fonts: new Set(), paintedFonts: new Set(), imagePaints: 0, pathPaints: 0,
    textShows: 0, complete: true, issues: []};
  const state = {font: null, stack: []};
  const resources = page.node.getInheritableAttribute(lib.PDFName.of('Resources'));
  const contents = page.node.Contents();
  const list = contents instanceof lib.PDFArray ? contents.asArray() : contents ? [contents] : [];
  try {
    for (const content of list) visit(content, resources, state, ev, lib, page.doc.context, budget, new Set());
  } catch (error) {
    ev.complete = false;
    ev.issues.push(reason(error.inspectionCode || 'content_error'));
  }
  return {...ev, fonts: [...ev.fonts].sort(), paintedFonts: [...ev.paintedFonts].sort()};
}

function visit(ref, resourceRef, state, ev, lib, context, budget, ancestors) {
  const stream = context.lookup(ref);
  if (!(stream instanceof lib.PDFStream)) throw inspectionError('invalid_stream');
  if (ancestors.has(stream) || ancestors.size >= MAX_DEPTH) throw inspectionError('cyclic_form');
  const active = new Set(ancestors).add(stream);
  const resources = context.lookup(resourceRef);
  if (resources && !(resources instanceof lib.PDFDict)) throw inspectionError('invalid_resources');
  const fonts = resources?.lookup(lib.PDFName.of('Font'));
  if (fonts instanceof lib.PDFDict) {
    for (const [, value] of fonts.entries()) {
      const name = fontName(context.lookup(value), lib);
      if (name) ev.fonts.add(name);
    }
  }
  const bytes = lib.decodePDFRawStream(stream).decode();
  budget.bytes -= bytes.length;
  if (budget.bytes < 0) throw inspectionError('byte_budget');
  const text = new TextDecoder('latin1').decode(bytes);
  const operands = [];
  for (const token of tokens(text)) {
    if (--budget.operations < 0) throw inspectionError('operation_budget');
    if (token.type !== 'operator') { operands.push(token); continue; }
    const op = token.value;
    if (!VALID.has(op)) throw inspectionError(op === 'BI' ? 'inline_image' : 'unsupported_operator');
    paint(op, operands, resources, fonts, state, ev, lib, context, budget, active);
    operands.length = 0;
  }
}

function fontName(font, lib) {
  return font instanceof lib.PDFDict ? font.get(lib.PDFName.of('BaseFont'))?.decodeText?.() || '' : '';
}

function paint(op, args, resources, fonts, state, ev, lib, context, budget, ancestors) {
  if (op === 'q') state.stack.push(state.font);
  if (op === 'Q') state.font = state.stack.pop() ?? null;
  if (op === 'Tf') state.font = args.at(-2)?.value;
  if (PATH_PAINT.has(op)) ev.pathPaints++;
  if (SHOW_TEXT.has(op)) {
    ev.textShows++;
    const name = fontName(fonts?.lookup(lib.PDFName.of(state.font || '')), lib);
    if (name) ev.paintedFonts.add(name);
    else throw inspectionError('missing_font');
  }
  if (op === 'sh' || (['scn', 'SCN'].includes(op) && resources?.has(lib.PDFName.of('Pattern')))) {
    throw inspectionError('pattern');
  }
  if (op !== 'Do') return;
  const objects = resources?.lookup(lib.PDFName.of('XObject'));
  const object = objects?.lookup(lib.PDFName.of(args.at(-1)?.value || ''));
  if (!(object instanceof lib.PDFStream)) throw inspectionError('missing_xobject');
  const subtype = object.dict.get(lib.PDFName.of('Subtype'))?.decodeText?.();
  if (subtype === 'Image') ev.imagePaints++;
  else if (subtype === 'Form') {
    visit(object, object.dict.get(lib.PDFName.of('Resources')) || resources,
      {font: state.font, stack: []}, ev, lib, context, budget, ancestors);
  } else throw inspectionError('unsupported_xobject');
}

export function contentBudget() { return {bytes: MAX_DECODED_BYTES, operations: MAX_OPERATIONS}; }
