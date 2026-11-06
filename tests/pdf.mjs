import * as lib from '../packages/identify/vendor/pdf-lib.esm.min.js';
import {createHash} from 'node:crypto';
export {lib};

const name = lib.PDFName.of;
export function content(doc, page, text) {
  page.node.addContentStream(doc.context.register(doc.context.flateStream(text)));
}
export function image(doc, page, width = 8, height = 8) {
  const ref = doc.context.register(doc.context.stream(new Uint8Array(width * height).fill(255),
    {Type:'XObject', Subtype:'Image', Width:width, Height:height, ColorSpace:'DeviceGray', BitsPerComponent:8}));
  page.node.setXObject(name('Image'),ref); content(doc,page,'q 300 0 0 400 0 0 cm /Image Do Q');
  return ref;
}
export function font(doc, fontName = 'OpusStd') {
  return doc.context.register(doc.context.obj({Type:'Font', Subtype:'Type1', BaseFont:fontName}));
}
export async function pdf(kinds, {creator = 'Sibelius 7.5', producer = '', unusedMusic = false} = {}) {
  const doc = await lib.PDFDocument.create();
  doc.setCreator(creator); doc.setProducer(producer);
  for (const kind of kinds) {
    const page = doc.addPage([300,400]);
    if (['scan','ocr','imageMusic'].includes(kind)) {
      image(doc,page);
    }
    if (['vector','renamed','ocr','text','imageMusic'].includes(kind)) {
      page.node.setFontDictionary(name('F1'), font(doc, ['ocr','text'].includes(kind) ? 'Helvetica' : kind === 'renamed' ? 'RenamedMusic' : 'ABCDEF+OpusStd'));
      content(doc,page,'BT /F1 12 Tf 20 200 Td (q) Tj ET');
    }
    if (kind === 'outlined') content(doc,page,'20 20 m 40 20 l 30 40 l h f');
    if (kind === 'inline') content(doc,page,'BI /W 1 /H 1 /BPC 8 /CS /G ID x EI');
    if (kind === 'invalidContent') content(doc,page,'BT (unterminated');
    if (unusedMusic) page.node.setFontDictionary(name('Unused'),font(doc));
  }
  return doc.save();
}

function rc4(key, data) {
  const box = Array.from({length:256},(_,i)=>i);
  let j=0;
  for(let i=0;i<256;i++) { j=(j+box[i]+key[i%key.length])%256; [box[i],box[j]]=[box[j],box[i]]; }
  let i=0; j=0;
  return Buffer.from(data.map(byte=>{i=(i+1)%256;j=(j+box[i])%256;[box[i],box[j]]=[box[j],box[i]];return byte^box[(box[i]+box[j])%256];}));
}
export function encrypted() {
  const pad=Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A','hex');
  const padded=s=>Buffer.concat([Buffer.from(s),pad]).subarray(0,32);
  const md5=data=>createHash('md5').update(data).digest();
  const fileID=md5(Buffer.from('generated encrypted test'));
  const owner=rc4(md5(padded('owner')).subarray(0,5),padded('secret'));
  const permissions=Buffer.alloc(4);permissions.writeInt32LE(-44);
  const key=md5(Buffer.concat([padded('secret'),owner,permissions,fileID])).subarray(0,5);
  const user=rc4(key,pad);
  const bodies=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -44 >>`];
  let out='%PDF-1.7\n';const offsets=[0];
  for(const [i,body] of bodies.entries()){offsets.push(out.length);out+=`${i+1} 0 obj\n${body}\nendobj\n`;}
  const xref=out.length;
  out+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  out+=`trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${fileID.toString('hex')}> <${fileID.toString('hex')}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}
