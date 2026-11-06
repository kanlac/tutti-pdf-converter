import {subsetFree, classifyExporter, profileEvidence, detectProfile, admission} from './sources.js';
import {reason} from './messages.js';

function pageKind(page, rules) {
  const painted = page.paintedFonts.map(subsetFree);
  const musicFonts = painted.filter(font => rules.familyKinds[rules.families[font]] === 'music');
  const unknownFonts = painted.filter(font => !Object.hasOwn(rules.families, font));
  // Like the server exporter, fingerprints can identify legacy music font names
  // without granting them a decoding registration or release permission.
  const prefixes = rules.exporters.flatMap(row => row.fontSets.flat());
  const candidateMusicFonts = unknownFonts.filter(font => !/text/i.test(font)
    && prefixes.some(prefix => font.startsWith(prefix)));
  let kind = 'unknown';
  const raster = page.rasterImagePaints ?? page.imagePaints;
  if (raster && (page.textShows || page.pathPaints)) kind = 'mixed';
  else if (musicFonts.length || candidateMusicFonts.length) kind = raster ? 'mixed' : 'vector';
  else if (page.complete && raster) kind = 'scan';
  else if (page.complete && page.pathPaints && !page.textShows) kind = 'outlined';
  return {...page, musicFonts, candidateMusicFonts, unknownFonts, kind};
}

function documentKind(pages) {
  // Text-only / empty front matter has no scan or outlined-notation evidence.
  const musicPages = pages.filter(page => !(page.complete && !page.pathPaints
    && !(page.rasterImagePaints ?? page.imagePaints) && page.kind === 'unknown'));
  const withoutCovers = musicPages.length && musicPages.every(page => page.kind === 'vector');
  const kinds = new Set((withoutCovers ? musicPages : pages).map(page => page.kind));
  if (kinds.size === 1) return [...kinds][0];
  return 'mixed';
}

function sourceEvidence(read, pages, rules) {
  const fonts = [...new Set(pages.flatMap(page => page.paintedFonts.map(subsetFree)))].sort();
  const evidence = {producer: read.producer, creator: read.creator, fonts};
  const exporter = classifyExporter(evidence, rules);
  const profile = detectProfile(profileEvidence(evidence, rules), rules);
  const ids = [...new Set([...exporter.metadataSoftware, ...exporter.fontSoftware, ...profile.candidates])].sort();
  const sources = ids.map(id => ({id, name: rules.exporters.find(row => row.id === id)?.name || id,
    evidence: [exporter.metadataSoftware.includes(id) && 'metadata', exporter.fontSoftware.includes(id) && 'fonts',
      profile.candidates.includes(id) && 'profile'].filter(Boolean)}));
  const conflict = exporter.metadataSoftware.length > 1 || exporter.fontSoftware.length > 1
    || (exporter.metadataSoftware.length > 0 && exporter.fontSoftware.length > 0
      && !exporter.metadataSoftware.some(id => exporter.fontSoftware.includes(id)))
    || ['ambiguous', 'conflicting'].includes(profile.state);
  return {sources, exporter, profile, conflict};
}

function suitability(kind, pages, source, rules) {
  if (['scan', 'outlined', 'unreadable'].includes(kind)) return {status: 'unlikely', reasons: [reason(kind === 'unreadable' ? 'parse_error' : kind)]};
  if (pages.some(page => !page.complete)) return {status: 'unknown', reasons: [reason('incomplete')]};
  if (kind !== 'vector') return {status: 'unknown', reasons: [reason(kind)]};
  if (source.conflict) return {status: 'unknown', reasons: [reason('source_conflict')]};
  const music = [...new Set(pages.flatMap(page => page.musicFonts))].map(font => ({names: [font]}));
  const disabled = source.sources.some(({id}) => !rules.profiles.some(row => row.id === id && row.enabled))
    || rules.releases.some(row => source.sources.some(({id}) => id === row.engine) && !row.enabled
      && music.some(font => font.names.some(name => row.fonts.includes(name))));
  if (disabled) return {status: 'unlikely', reasons: [reason('snapshot_disabled')]};
  const allowed = admission(source.profile, source.exporter, music, rules);
  return {status: allowed ? 'likely' : 'unknown', reasons: [reason(allowed ? 'try_tutti' : 'unconfirmed')]};
}

export function decide(read, rules) {
  const pages = read.pages.map(page => pageKind(page, rules));
  const kind = read.failure ? 'unreadable' : documentKind(pages);
  const source = sourceEvidence(read, pages, rules);
  const tutti = read.failure ? {status: 'unlikely', reasons: [reason(read.failure)]} : suitability(kind, pages, source, rules);
  return {schemaVersion: 1, dataVersion: rules.dataVersion,
    pdf: {kind, reasons: [reason(read.failure || (pages.some(page => !page.complete) ? 'incomplete' : kind))],
      bytes: read.size, pageCount: read.pageCount ?? null, pages,
      metadata: {producer: read.producer || '', creator: read.creator || ''}},
    sources: source.sources, tutti,
    websiteLimits: {...rules.limits, exceedsBytes: read.size > rules.limits.pdfBytes,
      exceedsPages: (read.pageCount || 0) > rules.limits.pdfPages}};
}
