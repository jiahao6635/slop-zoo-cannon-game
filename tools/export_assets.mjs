import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceBlend = join(projectRoot, 'blender', 'slop_zoo_game_assets.blend');
const exporter = join(projectRoot, 'tools', 'export_game_glb.py');
const validator = join(projectRoot, 'tools', 'validate_game_glb.mjs');
const outputGlb = join(projectRoot, 'public', 'assets', 'slop-cannon.glb');
const outputManifest = join(projectRoot, 'public', 'assets', 'slop-cannon.asset.json');
const buildDir = join(projectRoot, 'public', 'assets', '.asset-build');
const rawGlb = join(buildDir, 'slop-cannon.raw.glb');
const dedupGlb = join(buildDir, 'slop-cannon.dedup.glb');
const finalGlb = join(buildDir, 'slop-cannon.final.glb');
const finalManifest = join(buildDir, 'slop-cannon.asset.json');
const gltfTransform = join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'gltf-transform.cmd' : 'gltf-transform',
);

const candidates = [
  process.env.BLENDER_BIN,
  'blender',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe',
].filter(Boolean);

function works(candidate) {
  if (candidate.includes('/') || candidate.includes('\\')) {
    if (!existsSync(candidate)) return false;
  }
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  return probe.status === 0 && /^Blender 5\.2\./m.test(`${probe.stdout}${probe.stderr}`);
}

const blender = candidates.find(works);
if (!blender) {
  console.error('Blender 5.2 LTS was not found. Install it or set BLENDER_BIN to its executable path.');
  process.exit(1);
}

if (!existsSync(gltfTransform)) {
  console.error('gltf-transform was not found. Run npm install before exporting assets.');
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

try {
  run(blender, [
    '--background',
    '--factory-startup',
    '--disable-autoexec',
    '--python-exit-code',
    '1',
    sourceBlend,
    '--python',
    exporter,
    '--',
    '--output-glb',
    rawGlb,
  ]);
  run(gltfTransform, ['dedup', rawGlb, dedupGlb]);
  run(gltfTransform, [
    'meshopt',
    dedupGlb,
    finalGlb,
    '--level',
    'high',
    '--quantization-volume',
    'mesh',
    '--quantize-position',
    '14',
    '--quantize-normal',
    '10',
  ]);
  run(gltfTransform, ['validate', finalGlb]);
  run(process.execPath, [validator, finalGlb, '--manifest', finalManifest]);
  renameSync(finalGlb, outputGlb);
  renameSync(finalManifest, outputManifest);
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}

console.log(`PUBLISH_OK glb=${outputGlb} manifest=${outputManifest}`);
