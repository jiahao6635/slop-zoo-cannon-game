import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const upgrader = join(projectRoot, 'tools', 'upgrade_game_assets.py');
const variants = Object.freeze({
  classic: {
    sourceBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets.blend'),
    outputBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets.blend'),
  },
  'dragon-new-year': {
    sourceBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets.blend'),
    outputBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets_dragon_new_year.blend'),
  },
  'bamboo-guardian': {
    sourceBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets.blend'),
    outputBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets_bamboo_guardian.blend'),
  },
  'abyssal-whale': {
    sourceBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets.blend'),
    outputBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets_abyssal_whale.blend'),
  },
  'stellar-voyager': {
    sourceBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets.blend'),
    outputBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets_stellar_voyager.blend'),
  },
});
const variantNames = Object.keys(variants);
const candidates = [
  process.env.BLENDER_BIN,
  'blender',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe',
].filter(Boolean);

function parseVariant() {
  const args = process.argv.slice(2);
  let variant = 'classic';
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--variant') {
      if (!args[index + 1]) {
        console.error(`Missing value for --variant. Expected one of: ${variantNames.join(', ')}.`);
        process.exit(1);
      }
      variant = args[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith('--variant=')) {
      variant = argument.slice('--variant='.length);
      continue;
    }
    console.error(`Unknown argument: ${argument}`);
    process.exit(1);
  }
  if (!Object.hasOwn(variants, variant)) {
    console.error(`Unknown asset variant: ${variant}. Expected one of: ${variantNames.join(', ')}.`);
    process.exit(1);
  }
  return variant;
}

const variant = parseVariant();
const { sourceBlend, outputBlend } = variants[variant];

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
    outputBlend,
    '--skin',
    variant,
  ],
  { cwd: projectRoot, stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
