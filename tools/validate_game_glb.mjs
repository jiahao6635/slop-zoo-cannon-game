import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const MAX_BYTES = 350_000;
const MAX_MESHES = 12;
const MAX_PRIMITIVES = 16;
const MAX_MATERIALS = 6;
const MAX_TRIANGLES = 40_000;

const requiredNodes = Object.freeze({
  CannonAssetRoot: { parent: null, extra: ['asset_role', 'game_cannon'] },
  CannonYaw: { parent: 'CannonAssetRoot', extra: ['runtime_control', 'yaw'] },
  CannonPitch: { parent: 'CannonYaw', extra: ['runtime_control', 'pitch'] },
  CannonRecoil: { parent: 'CannonPitch', extra: ['runtime_control', 'recoil'] },
  MuzzleAnchor: { parent: 'CannonRecoil', extra: ['runtime_control', 'projectile_origin'] },
  CannonChargeGlow: { parent: 'CannonRecoil', extra: ['runtime_control', 'charge_glow'] },
  CannonAmmoGlow: { parent: 'CannonRecoil', extra: ['runtime_control', 'ammo_reservoir'] },
  CannonGaugeNeedle: { parent: 'CannonRecoil', extra: ['runtime_control', 'charge_gauge'] },
  CannonStatusLight: { parent: 'CannonRecoil', extra: ['runtime_control', 'status_light'] },
  CannonMuzzleGlow: { parent: 'CannonRecoil', extra: ['runtime_control', 'muzzle_glow'] },
});

function fail(message) {
  throw new Error(`Asset validation failed: ${message}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (!args[0]) fail('usage: node tools/validate_game_glb.mjs <asset.glb> [--manifest path]');
  const manifestIndex = args.indexOf('--manifest');
  return {
    assetPath: resolve(args[0]),
    manifestPath: manifestIndex >= 0 && args[manifestIndex + 1]
      ? resolve(args[manifestIndex + 1])
      : null,
  };
}

function parseGlb(buffer) {
  if (buffer.length < 20) fail('file is too small to be a GLB');
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) fail('invalid GLB magic');
  if (buffer.readUInt32LE(4) !== 2) fail('only glTF 2.0 is supported');
  if (buffer.readUInt32LE(8) !== buffer.length) fail('header length does not match file size');

  let offset = 12;
  let json = null;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > buffer.length) fail('chunk extends past end of file');
    if (chunkType === JSON_CHUNK) {
      json = JSON.parse(buffer.subarray(start, end).toString('utf8').replace(/[\u0000\s]+$/u, ''));
    }
    offset = end;
  }
  if (!json) fail('JSON chunk is missing');
  return json;
}

function finiteTransform(node, name) {
  for (const key of ['translation', 'rotation', 'scale', 'matrix']) {
    if (node[key] && node[key].some((value) => !Number.isFinite(value))) {
      fail(`${name}.${key} contains a non-finite value`);
    }
  }
}

function inspectDocument(document) {
  const nodes = document.nodes ?? [];
  const nodeIndices = new Map();
  nodes.forEach((node, index) => {
    if (!node.name) return;
    const list = nodeIndices.get(node.name) ?? [];
    list.push(index);
    nodeIndices.set(node.name, list);
  });

  const parents = new Map();
  nodes.forEach((node, index) => {
    for (const child of node.children ?? []) {
      if (parents.has(child)) fail(`node ${child} has more than one parent`);
      parents.set(child, index);
    }
  });

  for (const [name, contract] of Object.entries(requiredNodes)) {
    const matches = nodeIndices.get(name) ?? [];
    if (matches.length !== 1) fail(`${name} must exist exactly once; found ${matches.length}`);
    const index = matches[0];
    const node = nodes[index];
    finiteTransform(node, name);
    if (node.mesh !== undefined) fail(`${name} must remain an empty transform node`);
    const parentIndex = parents.get(index);
    const parentName = parentIndex === undefined ? null : nodes[parentIndex]?.name ?? null;
    if (parentName !== contract.parent) {
      fail(`${name} parent must be ${contract.parent}; found ${parentName}`);
    }
    const [extraKey, extraValue] = contract.extra;
    if (node.extras?.[extraKey] !== extraValue) {
      fail(`${name} extras.${extraKey} must be ${extraValue}`);
    }
  }

  const root = nodes[nodeIndices.get('CannonAssetRoot')[0]];
  if (root.extras?.asset_id !== 'slop-zoo-cannon') fail('root asset_id is missing');
  if (!Number.isInteger(root.extras?.asset_version) || root.extras.asset_version < 2) {
    fail('root asset_version must be at least 2');
  }
  if (root.extras?.license !== 'MIT') fail('root license must be MIT');

  const meshes = document.meshes ?? [];
  const materials = document.materials ?? [];
  const accessors = document.accessors ?? [];
  let primitiveCount = 0;
  let triangleCount = 0;
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives ?? []) {
      primitiveCount += 1;
      const mode = primitive.mode ?? 4;
      if (mode !== 4) fail(`only triangle primitives are allowed; found mode ${mode}`);
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      const count = accessors[accessorIndex]?.count ?? 0;
      triangleCount += Math.floor(count / 3);
    }
  }

  if (meshes.length > MAX_MESHES) fail(`mesh budget exceeded: ${meshes.length} > ${MAX_MESHES}`);
  if (primitiveCount > MAX_PRIMITIVES) fail(`primitive budget exceeded: ${primitiveCount} > ${MAX_PRIMITIVES}`);
  if (materials.length > MAX_MATERIALS) fail(`material budget exceeded: ${materials.length} > ${MAX_MATERIALS}`);
  if (triangleCount > MAX_TRIANGLES) fail(`triangle budget exceeded: ${triangleCount} > ${MAX_TRIANGLES}`);
  if ((document.animations?.length ?? 0) > 0) fail('cannon asset must not contain animations');
  if ((document.textures?.length ?? 0) > 0) fail('cannon asset must remain texture-free');
  if (!document.asset?.copyright?.includes('SPDX-License-Identifier: MIT')) {
    fail('glTF copyright/SPDX metadata is missing');
  }

  return {
    assetId: root.extras.asset_id,
    assetVersion: root.extras.asset_version,
    license: root.extras.license,
    nodeCount: nodes.length,
    meshCount: meshes.length,
    primitiveCount,
    materialCount: materials.length,
    triangleCount,
    extensionsUsed: document.extensionsUsed ?? [],
  };
}

const { assetPath, manifestPath } = parseArgs();
const buffer = readFileSync(assetPath);
if (buffer.length > MAX_BYTES) fail(`file budget exceeded: ${buffer.length} > ${MAX_BYTES} bytes`);
const document = parseGlb(buffer);
const stats = inspectDocument(document);
const manifest = {
  ...stats,
  source: 'blender/slop_zoo_game_assets.blend',
  output: 'public/assets/slop-cannon.glb',
  bytes: buffer.length,
  sha256: createHash('sha256').update(buffer).digest('hex'),
  toolchain: {
    blender: '5.2 LTS',
    gltfTransform: '4.4.2',
  },
};

if (manifestPath) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `ASSET_OK bytes=${manifest.bytes} nodes=${manifest.nodeCount} meshes=${manifest.meshCount} `
  + `primitives=${manifest.primitiveCount} materials=${manifest.materialCount} triangles=${manifest.triangleCount}`,
);
