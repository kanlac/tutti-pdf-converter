// Object-model evidence adapted from Tutti browser precheck-read.js (MIT).
import {inspectPage} from './content.js';

export async function readPdf(input, lib) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input)
    : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!bytes) throw new TypeError('PDF bytes must be an ArrayBuffer or an ArrayBuffer view');
  const base = {size: bytes.byteLength, header: new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-', pages: []};
  if (!base.size) return {...base, failure: 'empty'};
  if (!base.header) return {...base, failure: 'not_pdf'};
  let doc;
  try {
    doc = await lib.PDFDocument.load(bytes, {updateMetadata: false, throwOnInvalidObject: true});
  } catch (error) {
    // pdf-lib cannot reliably decrypt all handlers. Never inspect encrypted bytes as plaintext.
    return {...base, failure: error?.name === 'EncryptedPDFError' || /encrypt|password/i.test(error?.message || '')
      ? 'encrypted' : 'parse_error'};
  }
  try {
    const pages = doc.getPages().map((page, i) => ({page: i + 1, ...inspectPage(page, lib)}));
    const metadata = getter => { try { return getter() || ''; } catch { return ''; } };
    return {...base, pageCount: pages.length, pages, producer: metadata(() => doc.getProducer()),
      creator: metadata(() => doc.getCreator()), failure: pages.length ? null : 'no_pages'};
  } catch {
    return {...base, failure: 'parse_error'};
  }
}
