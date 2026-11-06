import {privateUseOnly} from './font-evidence.js';
import {inspectionError} from './messages.js';

const STROKE = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);
const FILL = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const SHOW_TEXT = new Set(['Tj', 'TJ', "'", '"']);
export const graphicsState = () => ({font: null, fill: null, stroke: null, stack: [], compatibility: 0});
const childState = state => ({...state, stack: []});
const lookup = (resources, group, key, lib) => resources?.lookup(lib.PDFName.of(group))?.lookup(lib.PDFName.of(key || ''));

export function paint(op, args, resources, state, ancestors, env) {
  const {lib, ev} = env;
  if (op === 'q') state.stack.push({font: state.font, fill: state.fill, stroke: state.stroke});
  if (op === 'Q') Object.assign(state, state.stack.pop() || {font: null, fill: null, stroke: null});
  if (op === 'BX') state.compatibility++;
  if (op === 'EX') state.compatibility = Math.max(0, state.compatibility - 1);
  if (op === 'Tf') state.font = lookup(resources, 'Font', args.at(-2)?.value, lib);
  if (op === 'gs') {
    const gs = lookup(resources, 'ExtGState', args.at(-1)?.value, lib);
    const font = gs?.lookup(lib.PDFName.of('Font'));
    if (font instanceof lib.PDFArray) state.font = font.lookup(0);
  }
  if (op === 'sh') ev.shadingPaints++;
  if (['cs', 'g', 'rg', 'k', 'sc'].includes(op)) state.fill = null;
  if (['CS', 'G', 'RG', 'K', 'SC'].includes(op)) state.stroke = null;
  if (op === 'scn' || op === 'SCN') {
    const name = args.at(-1)?.type === 'name' ? args.at(-1).value : null;
    state[op === 'scn' ? 'fill' : 'stroke'] = name ? lookup(resources, 'Pattern', name, lib) : null;
  }
  if (STROKE.has(op) || FILL.has(op)) {
    ev.pathPaints++;
    const patterns = new Set([STROKE.has(op) && state.stroke, FILL.has(op) && state.fill].filter(Boolean));
    for (const pattern of patterns) paintPattern(pattern, resources, state, ancestors, env);
  }
  if (SHOW_TEXT.has(op)) {
    ev.textShows++;
    const name = fontName(state.font, lib);
    if (name) {
      ev.paintedFonts.add(name);
      if (privateUseOnly(state.font, lib, env.fontMetadata)) ev.privateUseOnlyFonts.add(name);
    }
    else throw inspectionError('missing_font');
  }
  if (op === 'Do') paintObject(lookup(resources, 'XObject', args.at(-1)?.value, lib), resources, state, ancestors, env);
}

function paintObject(object, resources, state, ancestors, env) {
  const {lib, ev} = env;
  if (!(object instanceof lib.PDFStream)) throw inspectionError('missing_xobject');
  const subtype = object.dict.lookup(lib.PDFName.of('Subtype'))?.decodeText?.();
  if (subtype === 'Image') {
    ev.imagePaints++;
    const width = object.dict.lookup(lib.PDFName.of('Width'))?.asNumber?.() ?? null;
    const height = object.dict.lookup(lib.PDFName.of('Height'))?.asNumber?.() ?? null;
    // One pixel encodes a color swatch, not a scan of notation. Keep it in the evidence.
    const kind = width === 1 && height === 1 ? 'color_swatch' : 'raster';
    if (kind === 'raster') ev.rasterImagePaints++;
    const row = ev.images.get(object) || {width, height, kind, paints: 0};
    row.paints++; ev.images.set(object, row);
  }
  else if (subtype === 'Form') {
    env.visit(object, object.dict.get(lib.PDFName.of('Resources')) || resources, childState(state), ancestors);
  } else throw inspectionError('unsupported_xobject');
}

function paintPattern(pattern, resources, state, ancestors, env) {
  const {lib, ev} = env;
  if (pattern instanceof lib.PDFStream) {
    // The pattern may itself paint text or images. A selected but unused pattern is not visited.
    env.visit(pattern, pattern.dict.get(lib.PDFName.of('Resources')) || resources,
      {...childState(state), fill: null, stroke: null}, ancestors);
  } else if (pattern instanceof lib.PDFDict && pattern.lookup(lib.PDFName.of('PatternType'))?.asNumber?.() === 2) {
    ev.shadingPaints++;
  } else throw inspectionError('invalid_pattern');
}

export function fontName(font, lib) {
  return font instanceof lib.PDFDict ? font.lookup(lib.PDFName.of('BaseFont'))?.decodeText?.() || '' : '';
}
