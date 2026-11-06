import {build} from 'esbuild';
import {readFile, chmod} from 'node:fs/promises';
const license = await readFile(new URL('../packages/identify/vendor/pdf-lib.LICENSE.txt', import.meta.url), 'utf8');
const check = process.argv.includes('--check');
const outfile = 'plugins/sheet-music-pdf-convert/skills/sheet-music-pdf-convert/scripts/identify.mjs';
const result = await build({entryPoints: ['packages/identify/cli.js'], bundle: true, platform: 'node', format: 'esm',
  target: 'node22', outfile, write: !check, minify: true, legalComments: 'inline',
  banner: {js: `/* Vendored pdf-lib license:\n${license}*/`}});
if (check) {
  if (!(await readFile(outfile)).equals(Buffer.from(result.outputFiles[0].contents))) {
    throw new Error('Stale bundled identify CLI; run npm run build');
  }
} else await chmod(outfile, 0o755);
