#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import * as pdfLib from './vendor/pdf-lib.esm.min.js';
import rules from './data/identify-data.json' with {type: 'json'};
import {identify} from './src/index.js';

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2 || args.some(arg => arg.startsWith('--') && arg !== '--json')
  || args.filter(arg => arg !== '--json').length !== 1) {
  console.error('Usage: identify <pdf> [--json]');
  process.exitCode = 2;
} else {
  try {
    const result = await identify(await readFile(args.find(arg => arg !== '--json')), {pdfLib, rules});
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else console.log(`PDF: ${result.pdf.kind}\nSources: ${result.sources.map(s => s.name).join(', ') || 'Unknown'}\nTutti: ${result.tutti.status}\n${result.tutti.reasons.map(r => r.text).join(' ')}`);
    if (result.pdf.kind === 'unreadable') process.exitCode = 1;
  } catch (error) {
    console.error(`identify: ${error.message}`);
    process.exitCode = 2;
  }
}
