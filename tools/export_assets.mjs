import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceBlend = join(projectRoot, 'blender', 'slop_zoo_game_assets.blend');
const exporter = join(projectRoot, 'tools', 'export_game_glb.py');
const outputGlb = join(projectRoot, 'public', 'assets', 'slop-cannon.glb');

const candidates = [
  process.env.BLENDER_BIN,
  'blender',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe',
  'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe',
].filter(Boolean);

function works(candidate) {
  if (candidate.includes('/') || candidate.includes('\\')) {
    if (!existsSync(candidate)) return false;
  }
  const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

const blender = candidates.find(works);
if (!blender) {
  console.error('Blender was not found. Install Blender or set BLENDER_BIN to its executable path.');
  process.exit(1);
}

const result = spawnSync(
  blender,
  [
    '--background',
    sourceBlend,
    '--python',
    exporter,
    '--',
    '--output-glb',
    outputGlb,
  ],
  { cwd: projectRoot, stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
