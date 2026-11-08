#!/usr/bin/env node
import {readFile, readdir, mkdir, writeFile, access} from 'node:fs/promises';
import path from 'node:path';
import {review} from './src/index.js';

const usage = 'Usage: node review.mjs <score.mxl|score.musicxml> <original.pdf> [--omr file.omr] [--log file.log] [--out-dir directory]\nNode 22+. Writes *-marked.musicxml, *-review.pdf, *-review.json; never overwrites existing files.\n';
async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(usage); return; }
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('-')) {
      if (!['--omr', '--log', '--out-dir'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('-') || options[args[i]]) throw new Error(usage);
      options[args[i]] = args[++i];
    } else positional.push(args[i]);
  }
  if (positional.length !== 2) throw new Error(usage);
  const [input, pdf] = positional.map(p => path.resolve(p)), dir = path.dirname(input);
  const name = path.basename(input).replace(/\.(mxl|musicxml|xml)$/i, '');
  const stem = name.replace(/\.mvt[^.]+$/, '');
  const omr = path.resolve(options['--omr'] || path.join(dir, stem + '.omr'));
  let log = options['--log'];
  if (!log) {
    const logs = (await readdir(dir)).filter(n => n.endsWith('.log') && (n === `${stem}.log` || n.startsWith(`${stem}-`)));
    if (logs.length !== 1) throw new Error(`Expected one matching .log, found ${logs.length}; specify --log.`);
    log = path.join(dir, logs[0]);
  }
  const out = path.resolve(options['--out-dir'] || dir);
  const files = {musicxml: path.join(out, name + '-marked.musicxml'), pdf: path.join(out, name + '-review.pdf'), json: path.join(out, name + '-review.json')};
  for (const file of Object.values(files)) {
    let exists = false; try { await access(file); exists = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (exists) throw new Error('Refusing to overwrite: ' + file);
  }
  const [musicBytes, omrBytes, logText, pdfBytes] = await Promise.all([readFile(input), readFile(omr), readFile(log, 'utf8'), readFile(pdf)]);
  const result = await review({musicBytes, omrBytes, log: logText, pdfBytes, pdfName: pdf});
  await mkdir(out, {recursive: true});
  const summary = {...result.summary, outputs: files};
  await writeFile(files.musicxml, result.markedXml, {flag: 'wx'});
  await writeFile(files.pdf, result.pdfBytes, {flag: 'wx'});
  await writeFile(files.json, JSON.stringify(summary, null, 2) + '\n', {flag: 'wx'});
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n\n' + result.human + '\n');
}
main(process.argv.slice(2)).catch(error => { process.stderr.write(`review: ${error.message}\n`); process.exitCode = 2; });
