// Source and admission logic adapted from Tutti browser precheck-core.js (MIT).
const META_CHARS = 200;
const MAX_FONTS = 40;

const regex = (spec) => new RegExp(spec.source, spec.flags);

export function subsetFree(name) {
  return typeof name === 'string' && name.length > 7 && name[6] === '+' ? name.slice(7) : name;
}

// vector/exporter.py classify()
export function classifyExporter({producer = '', creator = '', fonts = [], raster = false}, knowledge) {
  const sorted = [...new Set(fonts)].sort();
  const byMeta = knowledge.exporters.filter(row => regex(row.meta).test(producer || '') || regex(row.meta).test(creator || '')).map(row => row.id);
  const byFonts = knowledge.exporters.filter(row => row.fontSets.some(group =>
    group.every(prefix => sorted.some(font => font.startsWith(prefix))))).map(row => row.id);
  const metaOne = byMeta.length === 1 ? byMeta[0] : null;
  const fontOne = byFonts.length === 1 ? byFonts[0] : null;
  return {
    software: metaOne || fontOne,
    basis: metaOne ? 'metadata' : fontOne ? 'fonts' : null,
    metadataSoftware: byMeta,
    fontSoftware: byFonts,
    raster: Boolean(raster),
    producer: (producer || '').slice(0, META_CHARS),
    creator: (creator || '').slice(0, META_CHARS),
    fonts: sorted.slice(0, MAX_FONTS),
  };
}

// vector/engine_profile.py evidence()
export function profileEvidence({producer = '', creator = '', fonts = []}, knowledge) {
  const sorted = [...new Set(fonts)].sort();
  const families = [...new Set(sorted.filter(f => Object.hasOwn(knowledge.families, f)).map(f => knowledge.families[f]))].sort();
  return {
    meta: {producer: producer || '', creator: creator || ''},
    metaPresent: Boolean((producer || '').trim() || (creator || '').trim()),
    fonts: sorted,
    families,
  };
}

function evaluate(node, {metaOn, fontOn, ev}) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || !Object.keys(node).length) return false;
  const results = [];
  if ('all_of' in node) results.push(node.all_of.every(sub => evaluate(sub, {metaOn, fontOn, ev})));
  if ('any_of' in node) results.push(node.any_of.some(sub => evaluate(sub, {metaOn, fontOn, ev})));
  if ('meta' in node) results.push(Boolean(metaOn) && Object.entries(node.meta).every(([key, spec]) => regex(spec).test(ev.meta[key] || '')));
  if ('font_family' in node) results.push(Boolean(fontOn) && ev.families.includes(node.font_family));
  return results.length ? results.every(Boolean) : false;
}

function topHits(knowledge, ev, metaOn, fontOn) {
  const hits = knowledge.profiles.filter(row => row.id !== '*' && evaluate(row.detect, {metaOn, fontOn, ev}))
    .map(row => [row.specificity, row.id]);
  if (!hits.length) return [];
  const best = Math.max(...hits.map(([score]) => score));
  return hits.filter(([score]) => score === best).map(([, id]) => id).sort();
}

function knownEngines(knowledge) { return knowledge.exporters.map(row => row.id); }

function namedEngines(ev, knowledge) {
  const blob = `${ev.meta.producer} ${ev.meta.creator}`;
  return knownEngines(knowledge).filter(id => new RegExp(`\\b${id}\\b`, 'i').test(blob));
}

// vector/engine_profile.py detect() (no explicit profile: the site never sets one)
export function detectProfile(ev, knowledge) {
  const metaHits = topHits(knowledge, ev, true, false);
  const fontHits = topHits(knowledge, ev, false, true);
  const metaStatus = metaHits.length ? 'hit' : !ev.metaPresent ? 'absent' : namedEngines(ev, knowledge).length ? 'foreign' : 'uninformative';
  let state, profile, candidates;
  if (metaHits.length > 1) [state, profile, candidates] = ['ambiguous', null, metaHits];
  else if (metaHits.length) {
    const only = metaHits[0];
    if (!fontHits.length || (fontHits.length === 1 && fontHits[0] === only)) [state, profile, candidates] = ['confirmed', only, [only]];
    else [state, profile, candidates] = ['conflicting', only, [...new Set([only, ...fontHits])].sort()];
  } else if (metaStatus === 'foreign' && fontHits.length) [state, profile, candidates] = ['conflicting', null, fontHits];
  else if (fontHits.length > 1) [state, profile, candidates] = ['ambiguous', null, fontHits];
  else if (fontHits.length) [state, profile, candidates] = ['inferred', fontHits[0], fontHits];
  else [state, profile, candidates] = ['unknown', '*', []];
  return {state, profile, candidates, metaStatus, metaHits, fontHits};
}

// The server also resolves real font instances; a browser resource name only
// supplies positive permission evidence for that exact name.
export function admission(automatic, identified, music, knowledge) {
  const profiles = new Map(knowledge.profiles.map(row => [row.id, row.enabled === true]));
  const candidates=[...new Set([...automatic.candidates,...(identified.fontSoftware||[])])];
  const sources = identified.metadataSoftware?.length ? identified.metadataSoftware : candidates.length===1?candidates:candidates.filter(id=>profiles.get(id));
  if (!Array.isArray(knowledge.releases) || !sources.length || sources.some(id=>!profiles.get(id))) return false;
  const counts=new Map(), families=new Map();
  for(const instance of music){
    const family=knowledge.releases.find(row=>instance.names.some(n=>row.fonts.includes(n)))?.family||instance.family||instance.names.join('|');
    families.set(instance,family);counts.set(family,(counts.get(family)||0)+(instance.body_count??1));
  }
  if(![...counts.values()].some(Boolean)){
    for(const key of counts.keys())counts.set(key,music.filter(r=>families.get(r)===key&&r.font_kind==='music').reduce((a,r)=>a+(r.painted_count??1),0));
  }
  const total=[...counts.values()].reduce((a,b)=>a+b,0),max=Math.max(0,...counts.values());
  const {body_share,body_min_glyphs}=knowledge.admissionParams;
  let primary=[...counts.keys()].filter(k=>counts.get(k)>=body_min_glyphs&&counts.get(k)>=total*body_share);
  if(!primary.length&&total)primary=[...counts.keys()].filter(k=>counts.get(k)===max);
  const body=music.filter(row=>primary.includes(families.get(row)));
  return body.length>0&&body.every(instance=>sources.every(engine=>{
    const rows=knowledge.releases.filter(row=>row.engine===engine&&instance.names.some(name=>row.fonts.includes(name)));
    return rows.length>0&&rows.every(row=>row.enabled===true);
  }));
}
