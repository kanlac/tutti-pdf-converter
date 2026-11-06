import {readPdf} from './read.js';
import {decide} from './decide.js';
export {readPdf, decide};

/** Offline only. Inject pdf-lib and a schemaVersion=1 public data snapshot. */
export async function identify(bytes, {pdfLib, rules} = {}) {
  if (!pdfLib?.PDFDocument) throw new TypeError('pdfLib is required');
  if (rules?.schemaVersion !== 1 || !rules.dataVersion) throw new TypeError('A versioned rules snapshot is required');
  return decide(await readPdf(bytes, pdfLib), rules);
}
