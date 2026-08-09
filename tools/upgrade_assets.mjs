import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceBlend = join(projectRoot, 'blender', 'slop_zoo_game_assets.blend');
const upgrader = join(projectRoot, 'tools', 'upgrade_game_assets.py');
const candidates = [
  process.env.BLENDER_BIN,
  'blender',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe',
].filter(Boolean);

function works(candidate) {
  if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) return false;
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  return probe.status === 0 && /^Blender 5\.2\./m.test(`${probe.stdout}${probe.stderr}`);
}

const blender = candidates.find(works);
if (!blender) {
  console.error('Blender 5.2 LTS was not found. Install it or set BLENDER_BIN to its executable path.');
  process.exit(1);
}

const result = spawnSync(
  blender,
  [
    '--background',
    '--factory-startup',
    '--disable-autoexec',
    '--python-exit-code',
    '1',
    sourceBlend,
    '--python',
    upgrader,
    '--',
    '--output-blend',
    sourceBlend,
  ],
  { cwd: projectRoot, stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
