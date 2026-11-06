import test from 'node:test';
import assert from 'node:assert/strict';
import {identify} from '../packages/identify/src/index.js';
import rules from '../packages/identify/data/identify-data.json' with {type:'json'};
import {lib, pdf, encrypted, font, content} from './pdf.mjs';
const inspect = (bytes, data=rules) => identify(bytes,{pdfLib:lib,rules:data});

for (const [label, kinds, expected, status] of [
  ['registered music',['vector'],'vector','likely'],
  ['image only',['scan'],'scan','unlikely'],
  ['OCR image and text',['ocr'],'mixed','unknown'],
  ['text cover then scans',['text','scan'],'mixed','unknown'],
  ['scans and music',['scan','vector'],'mixed','unknown'],
  ['outlined paths',['outlined'],'outlined','unlikely'],
  ['renamed vector fonts',['renamed'],'unknown','unknown'],
  ['text only',['text'],'unknown','unknown'],
  ['blank',['blank'],'unknown','unknown'],
  ['image plus music',['imageMusic'],'mixed','unknown'],
  ['inline image',['inline'],'unknown','unknown'],
  ['malformed content',['invalidContent'],'unknown','unknown'],
]) test(label,async()=>{
  const result=await inspect(await pdf(kinds));
  assert.equal(result.pdf.kind,expected);
  assert.equal(result.tutti.status,status);
  assert.equal(result.pdf.pages.length,kinds.length);
  assert.deepEqual(result.pdf.pages.map(p=>p.page),kinds.map((_,i)=>i+1));
  assert.ok(result.tutti.reasons.every(r=>r.code&&r.text));
});

test('sources retain conflicting candidates without claiming likely',async()=>{
  const result=await inspect(await pdf(['vector'],{creator:'Finale 27'}));
  assert.deepEqual(result.sources.map(s=>s.id),['finale','sibelius']);
  assert.equal(result.tutti.status,'unknown');
  assert.equal(result.tutti.reasons[0].code,'source_conflict');
});

test('unused registered fonts cannot turn a scan or text page into vector music',async()=>{
  for(const kind of ['scan','ocr','text']) {
    const result=await inspect(await pdf([kind],{unusedMusic:true}));
    assert.notEqual(result.tutti.status,'likely');
    assert.equal(result.pdf.pages[0].musicFonts.length,0);
    assert.ok(result.pdf.pages[0].fonts.includes('OpusStd'));
  }
});

test('rule parameters and website limits are injected, limits do not affect routing',async()=>{
  const bytes=await pdf(['vector']);
  const result=await inspect(bytes,{...rules,limits:{pdfBytes:1,pdfPages:0}});
  assert.equal(result.tutti.status,'likely');
  assert.equal(result.websiteLimits.exceedsBytes,true);assert.equal(result.websiteLimits.exceedsPages,true);
  const disabled={...rules,profiles:rules.profiles.map(r=>({...r,enabled:false}))};
  assert.equal((await inspect(bytes,disabled)).tutti.status,'unlikely');
});

test('font release status is honored',async()=>{
  const data={...rules,releases:rules.releases.map(r=>({...r,enabled:false}))};
  const result=await inspect(await pdf(['vector']),data);
  assert.equal(result.tutti.status,'unlikely');
  assert.equal(result.tutti.reasons[0].code,'snapshot_disabled');
});

for(const [label,bytes,code] of [['encrypted',encrypted(),'encrypted'],['empty',new Uint8Array(),'empty'],
  ['not PDF',Buffer.from('not a PDF'),'not_pdf'],['broken',Buffer.from('%PDF-1.7\ninvalid'),'parse_error']]) {
  test(label,async()=>{
    const result=await inspect(bytes);
    assert.equal(result.pdf.kind,'unreadable');assert.equal(result.pdf.reasons[0].code,code);
    assert.equal(result.tutti.status,'unlikely');assert.deepEqual(result.pdf.pages,[]);
  });
}

test('ArrayBuffer, Buffer slice and typed array offsets give identical results',async()=>{
  const bytes=await pdf(['vector']);const padded=Buffer.concat([Buffer.from('xx'),bytes,Buffer.from('yy')]);
  assert.deepEqual(await inspect(padded.subarray(2,-2)),await inspect(bytes.buffer));
  assert.deepEqual(await inspect(new DataView(padded.buffer,padded.byteOffset+2,bytes.length)),await inspect(bytes));
});

test('nested forms and inherited resources are inspected; unused forms are not painted',async()=>{
  const doc=await lib.PDFDocument.create();doc.setCreator('Sibelius');
  const page=doc.addPage();const f=font(doc);
  const form=doc.context.register(doc.context.flateStream('BT /F1 12 Tf (q) Tj ET',
    {Type:'XObject',Subtype:'Form',BBox:[0,0,100,100],Resources:{Font:{F1:f}}}));
  const outer=doc.context.register(doc.context.flateStream('/Inner Do',
    {Type:'XObject',Subtype:'Form',BBox:[0,0,100,100],Resources:{XObject:{Inner:form}}}));
  page.node.setXObject(lib.PDFName.of('Outer'),outer);content(doc,page,'/Outer Do');
  assert.equal((await inspect(await doc.save())).tutti.status,'likely');
  const inherited=await lib.PDFDocument.create();inherited.setCreator('Sibelius');const p=inherited.addPage();
  p.node.Parent().set(lib.PDFName.of('Resources'),inherited.context.obj({Font:{F1:font(inherited)}}));
  p.node.delete(lib.PDFName.of('Resources'));content(inherited,p,'BT /F1 12 Tf (q) Tj ET');
  assert.equal((await inspect(await inherited.save())).tutti.status,'likely');
});

test('cyclic forms finish with incomplete evidence',async()=>{
  const doc=await lib.PDFDocument.create();const p=doc.addPage();
  const stream=doc.context.flateStream('/Self Do',{Type:'XObject',Subtype:'Form',BBox:[0,0,100,100]});
  const ref=doc.context.register(stream);stream.dict.set(lib.PDFName.of('Resources'),doc.context.obj({XObject:{Self:ref}}));
  p.node.setXObject(lib.PDFName.of('Self'),ref);content(doc,p,'/Self Do');
  const result=await inspect(await doc.save());assert.equal(result.tutti.status,'unknown');
  assert.equal(result.pdf.pages[0].complete,false);
});

test('literal strings cannot introduce operators and dependencies are required',async()=>{
  const doc=await lib.PDFDocument.create();doc.setCreator('Sibelius');const p=doc.addPage();
  p.node.setFontDictionary(lib.PDFName.of('F1'),font(doc));
  content(doc,p,'BT /F1 12 Tf (hello \\(literal\\) BI /Image Do) Tj ET');
  assert.equal((await inspect(await doc.save())).tutti.status,'likely');
  await assert.rejects(()=>identify(new Uint8Array()),/pdfLib/);
  await assert.rejects(()=>identify(new Uint8Array(),{pdfLib:lib,rules:{}}),/rules/);
});

for(const [creator,fontName,id] of [['Sibelius','HelsinkiStd','sibelius'],['MuseScore Studio 4.5','Leland','musescore'],
  ['Dorico 6','Bravura','dorico'],['Finale 27','Maestro','finale']]) {
  test(`released vector family ${fontName}`,async()=>{
    const doc=await lib.PDFDocument.create();doc.setCreator(creator);doc.setProducer('');const page=doc.addPage();
    page.node.setFontDictionary(lib.PDFName.of('F1'),font(doc,fontName));
    content(doc,page,'BT /F1 12 Tf (q) Tj ET');
    const result=await inspect(await doc.save());
    assert.equal(result.pdf.kind,'vector');assert.equal(result.tutti.status,'likely');
    assert.ok(result.sources.some(source=>source.id===id));
  });
}

test('the generated encrypted fixture opens with its password',async()=>{
  const doc=await lib.PDFDocument.load(encrypted(),{password:'secret',updateMetadata:false});
  assert.equal(doc.getPageCount(),1);
});
