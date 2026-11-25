// Node 22 entrypoint: sealed input only, no network, no clock-dependent output.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './dashboard/calibration.js';
import './dashboard/engine.js';
import { buildDossier } from './vendor/makefun-board.ts';

const root = dirname(fileURLToPath(import.meta.url));
const engine = (globalThis as any).RadarEngine;
function arg(name: string, fallback: string): string {
  const equal = process.argv.find(x => x.startsWith(`--${name}=`));
  if (equal) return equal.slice(name.length + 3);
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return fallback;
  if (!process.argv[at + 1] || process.argv[at + 1].startsWith('--')) throw Error(`--${name} needs a value`);
  return process.argv[at + 1];
}
if (process.argv.includes('--help')) {
  console.log('Aperture radar: node main.ts [--input /input/snapshot.json|directory] [--output /output] [--preview]\nMAKEFUN_OUTPUT_DIR sets the output directory. --preview builds before screenshots exist.');
  process.exit(0);
}
try {
  const input = arg('input', '/input/snapshot.json');
  const file = input.endsWith('.json') ? input : join(input, 'snapshot.json');
  const out = resolve(arg('output', process.env.MAKEFUN_OUTPUT_DIR || '/output'));
  if (out === root || out === join(root, 'dashboard')) throw Error('Choose a separate output directory');
  const snapshot = engine.parseSnapshot(readFileSync(file, 'utf8'));
  const radar = engine.buildRadar(snapshot);
  const issue = engine.boardIssue(radar, snapshot);
  if (issue) throw Error(issue);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), JSON.stringify(radar) + '\n');
  // Same snapshot and shared engine power the page and the board: no duplicated value model.
  writeFileSync(join(out, 'data.js'), `globalThis.SNAPSHOT=${JSON.stringify(snapshot).replace(/</g, '\\u003c')};\n`);
  cpSync(join(root, 'dashboard'), join(out, 'dashboard'), { recursive: true });
  if (existsSync(join(root, 'screenshots'))) cpSync(join(root, 'screenshots'), join(out, 'screenshots'), { recursive: true });
  if (!process.argv.includes('--preview')) writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } }));
  console.log(`Aperture: ${radar.rows.length} ranked | ${snapshot.watchlist.length}/${snapshot.watchlist.length} watchlist | ${radar.recorded.length} token records set aside | ${radar.excluded.length} derivatives | output ${out}`);
} catch (err) {
  console.error(`Aperture: ${(err as Error).message}`);
  process.exitCode = 1;
}
