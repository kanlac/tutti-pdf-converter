// Generated syntax variants observed in Qt/Sibelius/MuseScore PDFs; no score content.
import test from 'node:test';
import assert from 'node:assert/strict';
import {identify} from '../packages/identify/src/index.js';
import rules from '../packages/identify/data/identify-data.json' with {type:'json'};
import {lib, font, content, image} from './pdf.mjs';
const N=lib.PDFName.of;
const inspect = doc => doc.save().then(bytes=>identify(bytes,{pdfLib:lib,rules}));
function shading(doc) {
  return doc.context.obj({ShadingType:2, ColorSpace:'DeviceRGB', Coords:[0,0,100,0],
    Function:{FunctionType:2,Domain:[0,1],C0:[0,0,0],C1:[1,1,1],N:1}, Extend:[true,true]});
}
async function document() {
  const doc=await lib.PDFDocument.create();doc.setCreator('Sibelius');doc.setProducer('');
  const page=doc.addPage();page.node.setFontDictionary(N('Music'),font(doc));
  page.node.setFontDictionary(N('Text'),font(doc,'Palatino-Roman'));
  return {doc,page,resources:page.node.Resources()};
}

for(const select of ['0 0 0 SCN 0 0 0 scn', '/Pattern cs /P1 scn', '/Shade sh']) {
  test(`Qt pattern/shading resources do not suppress painted fonts: ${select}`,async()=>{
    const {doc,page,resources}=await document();
    resources.set(N('Pattern'),doc.context.obj({P1:{PatternType:2,Shading:shading(doc)}}));
    resources.set(N('Shading'),doc.context.obj({Shade:shading(doc)}));
    content(doc,page,`${select} 0 0 m 20 20 l S BT /Text 12 Tf (title) Tj /Music 12 Tf (q) Tj ET`);
    const r=await inspect(doc), p=r.pdf.pages[0];
    assert.equal(r.pdf.kind,'vector');assert.equal(r.tutti.status,'likely');
    assert.equal(p.complete,true);assert.equal(p.pathPaints,1);
    assert.deepEqual(p.paintedFonts,['OpusStd','Palatino-Roman']);
  });
}

test('painting a tiling pattern reads its Form-like content',async()=>{
  const {doc,page,resources}=await document();
  const pattern=doc.context.register(doc.context.flateStream('BT /Music 12 Tf (q) Tj ET',
    {Type:'Pattern',PatternType:1,PaintType:1,TilingType:1,BBox:[0,0,20,20],XStep:20,YStep:20,
      Resources:{Font:{Music:font(doc)}}}));
  resources.set(N('Pattern'),doc.context.obj({P1:pattern}));
  content(doc,page,'/Pattern cs /P1 scn 0 0 20 20 re f');
  const r=await inspect(doc);assert.equal(r.tutti.status,'likely');assert.equal(r.pdf.pages[0].complete,true);
});

test('shading pattern fills remain readable and count separately from music text',async()=>{
  const {doc,page,resources}=await document();
  resources.set(N('Pattern'),doc.context.obj({P1:{PatternType:2,Shading:shading(doc)}}));
  content(doc,page,'/Pattern cs /P1 scn 0 0 20 20 re f BT /Music 12 Tf (q) Tj ET');
  const r=await inspect(doc);assert.equal(r.tutti.status,'likely');assert.equal(r.pdf.pages[0].shadingPaints,1);
});

test('bad child Form preserves evidence before and after it and in subsequent content streams',async()=>{
  const {doc,page}=await document();
  const bad=doc.context.register(doc.context.flateStream('BT (unterminated',
    {Type:'XObject',Subtype:'Form',BBox:[0,0,20,20]}));
  page.node.setXObject(N('Bad'),bad);
  content(doc,page,'0 0 m 20 20 l S /Bad Do BT /Text 12 Tf (title) Tj ET');
  content(doc,page,'BT /Music 12 Tf (q) Tj ET 20 20 m 30 30 l S');
  const r=await inspect(doc),p=r.pdf.pages[0];
  assert.equal(p.complete,false);assert.deepEqual(p.paintedFonts,['OpusStd','Palatino-Roman']);
  assert.equal(p.pathPaints,2);assert.equal(p.textShows,2);
  assert.equal(p.kind,'vector');assert.equal(r.tutti.status,'unknown');
  assert.deepEqual(p.issues.map(i=>i.code),['unclosed_string']);
});

test('unknown operator loses only that operation; later text and paths are retained',async()=>{
  const {doc,page}=await document();
  content(doc,page,'1 2 UnsupportedOp 0 0 m 20 20 l S BT /Music 12 Tf (q) Tj ET');
  const r=await inspect(doc),p=r.pdf.pages[0];assert.equal(p.complete,false);
  assert.equal(p.kind,'vector');assert.equal(p.pathPaints,1);assert.equal(p.textShows,1);
  assert.equal(r.tutti.status,'unknown');
});

test('PDF compatibility sections allow unknown operators and marked content allows boolean operands',async()=>{
  const {doc,page}=await document();
  content(doc,page,'BX 1 2 FutureOp EX /Span << /Flag true /Other false /None null >> BDC BT /Music 12 Tf (q) Tj ET EMC');
  const r=await inspect(doc);assert.equal(r.tutti.status,'likely');assert.equal(r.pdf.pages[0].complete,true);
});

test('ExtGState Font and a Form inheriting the selected font work without a child Tf',async()=>{
  const {doc,page,resources}=await document();
  const ref=font(doc);
  resources.set(N('ExtGState'),doc.context.obj({GS:{Font:[ref,12]}}));
  const child=doc.context.register(doc.context.flateStream('BT (q) Tj ET',
    {Type:'XObject',Subtype:'Form',BBox:[0,0,20,20],Resources:{}}));
  page.node.setXObject(N('Child'),child);
  content(doc,page,'/GS gs q /Child Do Q');
  const r=await inspect(doc);assert.equal(r.tutti.status,'likely');assert.equal(r.pdf.pages[0].complete,true);
});

test('inspection budgets are per page, so a long vector document retains later pages',async()=>{
  const {doc,page}=await document();
  content(doc,page,'0 0 m 1 1 l S\n'.repeat(18000)+'BT /Music 12 Tf (q) Tj ET');
  for(let i=0;i<2;i++) {
    const p=doc.addPage();p.node.setFontDictionary(N('Music'),font(doc));content(doc,p,'0 0 m 1 1 l S\n'.repeat(18000)+'BT /Music 12 Tf (q) Tj ET');
  }
  const r=await inspect(doc);assert.equal(r.tutti.status,'likely');assert.ok(r.pdf.pages.every(p=>p.complete));
});


test('text-only covers and single-pixel color fills do not turn vector scores into mixed',async()=>{
  const {doc,page}=await document();
  content(doc,page,'BT /Text 12 Tf (title only) Tj ET');
  const music=doc.addPage();music.node.setFontDictionary(N('Music'),font(doc));
  image(doc,music,1,1);content(doc,music,'BT /Music 12 Tf (q) Tj ET');
  const r=await inspect(doc);assert.equal(r.pdf.kind,'vector');assert.equal(r.tutti.status,'likely');
  assert.equal(r.pdf.pages[0].kind,'unknown');assert.equal(r.pdf.pages[1].imagePaints,1);
  assert.equal(r.pdf.pages[1].rasterImagePaints,0);
  assert.deepEqual(r.pdf.pages[1].images,[{width:1,height:1,kind:'color_swatch',paints:1}]);
});

test('an ordinary bitmap inside a painted tiling pattern still prevents likely',async()=>{
  const {doc,page,resources}=await document();
  const other=doc.addPage();const img=image(doc,other);
  const pattern=doc.context.register(doc.context.flateStream('/Scan Do',
    {Type:'Pattern',PatternType:1,PaintType:1,TilingType:1,BBox:[0,0,20,20],XStep:20,YStep:20,
      Resources:{XObject:{Scan:img}}}));
  resources.set(N('Pattern'),doc.context.obj({P1:pattern}));
  content(doc,page,'/Pattern cs /P1 scn 0 0 20 20 re f BT /Music 12 Tf (q) Tj ET');
  const r=await inspect(doc);assert.equal(r.pdf.pages[0].kind,'mixed');assert.notEqual(r.tutti.status,'likely');
});

test('an unpainted pattern does not contribute fonts or images',async()=>{
  const {doc,page,resources}=await document();
  const pattern=doc.context.register(doc.context.flateStream('BT (unterminated',
    {Type:'Pattern',PatternType:1,PaintType:1,TilingType:1,BBox:[0,0,20,20],XStep:20,YStep:20}));
  resources.set(N('Pattern'),doc.context.obj({P1:pattern}));
  content(doc,page,'/Pattern cs /P1 scn 0 0 0 rg BT /Music 12 Tf (q) Tj ET');
  const r=await inspect(doc);assert.equal(r.tutti.status,'likely');assert.equal(r.pdf.pages[0].complete,true);
});


test('legacy source fingerprints establish vector evidence without granting unsupported font releases',async()=>{
  const {doc,page}=await document();
  page.node.setFontDictionary(N('Legacy'),font(doc,'Helsinki'));
  content(doc,page,'BT /Text 12 Tf (title) Tj /Legacy 12 Tf (q) Tj ET 0 0 m 20 20 l S');
  const r=await inspect(doc);assert.equal(r.pdf.kind,'vector');assert.equal(r.tutti.status,'unknown');
  assert.deepEqual(r.pdf.pages[0].candidateMusicFonts,['Helsinki']);
  assert.deepEqual(r.pdf.pages[0].musicFonts,[]);
});

test('Contents array members share operands, tokens and strings as one logical content stream',async()=>{
  const {doc,page}=await document();
  for (const chunk of ['BT /Mu','sic 12 ','Tf (q',') Tj ET']) {
    page.node.addContentStream(doc.context.register(doc.context.flateStream(chunk)));
  }
  const r=await inspect(doc);assert.equal(r.pdf.kind,'vector');assert.equal(r.tutti.status,'likely');
  assert.equal(r.pdf.pages[0].complete,true);assert.equal(r.pdf.pages[0].textShows,1);
});


for(const mapping of ['1 beginbfchar <71> <E050> endbfchar', '1 beginbfchar <71> <E0 50> endbfchar',
  '1 beginbfrange <71> <72> [<E050> <E051>] endbfrange',
  '1 beginbfrange <71> <72> <E050> endbfrange',
  '1 beginbfchar <71> <DB80DC01> endbfchar']) {
  test(`unregistered private-use-only symbols require confirmation: ${mapping}`,async()=>{
    const {doc,page}=await document();const custom=font(doc,'CustomSymbols');
    doc.context.lookup(custom).set(N('ToUnicode'),doc.context.register(doc.context.stream(
      `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Custom def /CMapType 2 def
1 begincodespacerange <00> <FF> endcodespacerange
${mapping}
endcmap CMapName currentdict /CMap defineresource pop end end`)));
    page.node.setFontDictionary(N('Custom'),custom);
    content(doc,page,'BT /Music 12 Tf (q) Tj /Custom 12 Tf (q) Tj ET');
    const r=await inspect(doc);assert.equal(r.pdf.kind,'vector');assert.equal(r.tutti.status,'unknown');
    assert.equal(r.tutti.reasons[0].code,'unregistered_symbols');
    assert.ok(r.pdf.pages[0].privateUseOnlyFonts.includes('CustomSymbols'));
  });
}

test('ordinary text with an occasional private-use character is not a private-use-only font',async()=>{
  const {doc,page}=await document();const custom=font(doc,'OrdinaryText');
  doc.context.lookup(custom).set(N('ToUnicode'),doc.context.register(doc.context.stream(
    '2 beginbfchar <71> <0071> <72> <E033> endbfchar')));
  page.node.setFontDictionary(N('Custom'),custom);
  content(doc,page,'BT /Music 12 Tf (q) Tj /Custom 12 Tf (q) Tj ET');
  const r=await inspect(doc);assert.equal(r.tutti.status,'likely');
});


test('an inherited Unicode CMap cannot establish that a font has only private-use mappings',async()=>{
  const {doc,page}=await document();const custom=font(doc,'InheritedText');
  doc.context.lookup(custom).set(N('ToUnicode'),doc.context.register(doc.context.stream(
    '/Base-CMap usecmap 1 beginbfchar <71> <E050> endbfchar')));
  page.node.setFontDictionary(N('Custom'),custom);
  content(doc,page,'BT /Music 12 Tf (q) Tj /Custom 12 Tf (q) Tj ET');
  const r=await inspect(doc);assert.equal(r.tutti.status,'likely');
});
