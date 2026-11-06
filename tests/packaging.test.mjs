import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, copyFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {build} from 'esbuild';
import {pdf} from './pdf.mjs';
const script='plugins/sheet-music-pdf-convert/skills/sheet-music-pdf-convert/scripts/identify.mjs';

test('single bundled CLI runs from an isolated directory with no data or dependencies',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'tutti-identify-test-'));
  try {
    const local=path.join(dir,'identify.mjs'), input=path.join(dir,'input.pdf');
    await copyFile(script,local);await writeFile(input,await pdf(['vector']));
    const json=spawnSync(process.execPath,[local,input,'--json'],{encoding:'utf8',cwd:dir});
    assert.equal(json.status,0,json.stderr);
    assert.equal(JSON.parse(json.stdout).tutti.status,'likely');
    const human=spawnSync(process.execPath,[local,input],{encoding:'utf8',cwd:dir});
    assert.equal(human.status,0);assert.match(human.stdout,/PDF: vector\nSources: Sibelius\nTutti: likely/);
    await writeFile(input,'not a PDF');
    const unreadable=spawnSync(process.execPath,[local,input,'--json'],{encoding:'utf8',cwd:dir});
    assert.equal(unreadable.status,1);assert.equal(JSON.parse(unreadable.stdout).pdf.kind,'unreadable');
    assert.equal(spawnSync(process.execPath,[local,'--bad'],{cwd:dir}).status,2);
    assert.equal(spawnSync(process.execPath,[local,'absent.pdf'],{cwd:dir}).status,2);
    assert.match(await readFile(local,'utf8'),/Copyright \(c\) 2019 Andrew Dillon/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('browser target bundle runs without Node globals, filesystem or network',async()=>{
  const built=await build({stdin:{contents:`
    import {identify} from './packages/identify/src/index.js';
    import * as pdfLib from './packages/identify/vendor/pdf-lib.esm.min.js';
    import rules from './packages/identify/data/identify-data.json';
    globalThis.inspect = bytes => identify(bytes, {pdfLib, rules});`,resolveDir:process.cwd()},
    bundle:true,platform:'browser',format:'iife',write:false});
  const sandbox=vm.createContext({TextDecoder, Uint8Array, ArrayBuffer, setTimeout, clearTimeout});
  vm.runInContext(built.outputFiles[0].text,sandbox);
  for(const [kinds,kind,status] of [[['vector'],'vector','likely'],[['ocr'],'mixed','unknown'],[['scan'],'scan','unlikely']]) {
    const result=await sandbox.inspect(await pdf(kinds));
    assert.equal(result.pdf.kind,kind);assert.equal(result.tutti.status,status);
  }
});

test('both marketplaces resolve the same self-contained plugin and placeholder skill',async()=>{
  const claude=JSON.parse(await readFile('.claude-plugin/marketplace.json','utf8'));
  const codex=JSON.parse(await readFile('.agents/plugins/marketplace.json','utf8'));
  assert.equal(claude.plugins[0].source,codex.plugins[0].source.path);
  const plugin=claude.plugins[0].source;
  for(const file of ['.claude-plugin/plugin.json','.codex-plugin/plugin.json']) {
    assert.equal(JSON.parse(await readFile(path.join(plugin,file),'utf8')).name,'sheet-music-pdf-convert');
  }
  assert.equal(await readFile(path.join(plugin,'skills/sheet-music-pdf-convert/SKILL.md'),'utf8'),'待编排者撰写\n');
});

test('bundled CLI is the reproducible projection of the SDK, vendor and data',()=>{
  const check=spawnSync(process.execPath,['tools/build.mjs','--check'],{encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
});
