import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const exporter = join(projectRoot, 'tools', 'export_game_glb.py');
const validator = join(projectRoot, 'tools', 'validate_game_glb.mjs');
const buildRoot = join(projectRoot, 'public', 'assets', '.asset-build');
const variants = Object.freeze({
  classic: {
    sourceBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets.blend'),
    source: 'blender/slop_zoo_game_assets.blend',
    output: 'public/assets/slop-cannon.glb',
    manifest: 'public/assets/slop-cannon.asset.json',
    buildStem: 'slop-cannon',
    assetId: 'slop-zoo-cannon',
    skinId: null,
  },
  'dragon-new-year': {
    sourceBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets_dragon_new_year.blend'),
    source: 'blender/slop_zoo_game_assets_dragon_new_year.blend',
    output: 'public/assets/slop-cannon-dragon-new-year.glb',
    manifest: 'public/assets/slop-cannon-dragon-new-year.asset.json',
    buildStem: 'slop-cannon-dragon-new-year',
    assetId: 'slop-zoo-cannon-dragon-new-year',
    skinId: 'dragon-new-year',
  },
  'bamboo-guardian': {
    sourceBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets_bamboo_guardian.blend'),
    source: 'blender/slop_zoo_game_assets_bamboo_guardian.blend',
    output: 'public/assets/slop-cannon-bamboo-guardian.glb',
    manifest: 'public/assets/slop-cannon-bamboo-guardian.asset.json',
    buildStem: 'slop-cannon-bamboo-guardian',
    assetId: 'slop-zoo-cannon-bamboo-guardian',
    skinId: 'bamboo-guardian',
  },
  'abyssal-whale': {
    sourceBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets_abyssal_whale.blend'),
    source: 'blender/slop_zoo_game_assets_abyssal_whale.blend',
    output: 'public/assets/slop-cannon-abyssal-whale.glb',
    manifest: 'public/assets/slop-cannon-abyssal-whale.asset.json',
    buildStem: 'slop-cannon-abyssal-whale',
    assetId: 'slop-zoo-cannon-abyssal-whale',
    skinId: 'abyssal-whale',
  },
  'stellar-voyager': {
    sourceBlend: join(projectRoot, 'blender', 'slop_zoo_game_assets_stellar_voyager.blend'),
    source: 'blender/slop_zoo_game_assets_stellar_voyager.blend',
    output: 'public/assets/slop-cannon-stellar-voyager.glb',
    manifest: 'public/assets/slop-cannon-stellar-voyager.asset.json',
    buildStem: 'slop-cannon-stellar-voyager',
    assetId: 'slop-zoo-cannon-stellar-voyager',
    skinId: 'stellar-voyager',
  },
});
const variantNames = Object.keys(variants);
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
const asset = variants[variant];
const buildDir = join(buildRoot, asset.buildStem);
const outputGlb = join(projectRoot, asset.output);
const outputManifest = join(projectRoot, asset.manifest);
const rawGlb = join(buildDir, `${asset.buildStem}.raw.glb`);
const dedupGlb = join(buildDir, `${asset.buildStem}.dedup.glb`);
const finalGlb = join(buildDir, `${asset.buildStem}.final.glb`);
const finalManifest = join(buildDir, `${asset.buildStem}.asset.json`);

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
    asset.sourceBlend,
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
  const validationArgs = [
    validator,
    finalGlb,
    '--manifest',
    finalManifest,
    '--asset-id',
    asset.assetId,
    '--source',
    asset.source,
    '--output',
    asset.output,
  ];
  if (asset.skinId) validationArgs.push('--skin-id', asset.skinId);
  run(process.execPath, validationArgs);
  renameSync(finalGlb, outputGlb);
  renameSync(finalManifest, outputManifest);
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}

console.log(`PUBLISH_OK glb=${outputGlb} manifest=${outputManifest}`);
