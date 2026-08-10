import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const REQUIRED_CANNON_NODES = Object.freeze([
  'CannonYaw',
  'CannonPitch',
  'CannonRecoil',
  'MuzzleAnchor',
]);

const FX_NODE_NAMES = new Set([
  'CannonChargeGlow',
  'CannonAmmoGlow',
  'CannonGaugeNeedle',
  'CannonStatusLight',
  'CannonMuzzleGlow',
]);

export function createCannonAssetLoader() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

function hasFxAncestor(node) {
  let current = node;
  while (current) {
    if (FX_NODE_NAMES.has(current.name)) return true;
    current = current.parent;
  }
  return false;
}

function configureMaterial(material) {
  if (!material) return;
  material.side = THREE.FrontSide;
  material.envMapIntensity = /Energy/i.test(material.name) ? 1.1 : 1.35;
  if (/Gunmetal/i.test(material.name)) {
    material.metalness = Math.min(material.metalness, 0.78);
    material.roughness = Math.max(material.roughness, 0.28);
  }
  if (/(?:Brass|ImperialGold|BambooGold|OceanCopper|StellarChrome)/i.test(material.name)) {
    material.metalness = Math.min(material.metalness, 0.9);
    material.roughness = Math.max(material.roughness, 0.2);
  }
  if (/(?:DragonRed|InkBamboo|AbyssNavy|NebulaMidnight)/i.test(material.name)) {
    material.metalness = Math.min(material.metalness, 0.24);
    material.roughness = Math.max(material.roughness, 0.19);
  }
  if (/(?:JadePorcelain|PandaPorcelain|CoralPearl|SolarCeramic)/i.test(material.name)) {
    material.metalness = Math.min(material.metalness, 0.08);
    material.roughness = Math.max(material.roughness, 0.15);
  }
  material.needsUpdate = true;
}

export function prepareCannonAsset(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    const isEffect = hasFxAncestor(node);
    node.castShadow = !isEffect;
    node.receiveShadow = !isEffect;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach(configureMaterial);
  });
  return root;
}

function cloneNodeMaterials(node) {
  if (!node) return;
  node.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone();
  });
}

export function collectNodeMeshes(node) {
  const meshes = [];
  node?.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  return meshes;
}

export function resolveCannonRig(root) {
  const nodes = Object.fromEntries(
    [...REQUIRED_CANNON_NODES, ...FX_NODE_NAMES].map((name) => [name, root.getObjectByName(name)]),
  );
  const missing = REQUIRED_CANNON_NODES.filter((name) => !nodes[name]);
  for (const name of FX_NODE_NAMES) cloneNodeMaterials(nodes[name]);
  return {
    missing,
    yaw: nodes.CannonYaw,
    pitch: nodes.CannonPitch,
    recoil: nodes.CannonRecoil,
    muzzle: nodes.MuzzleAnchor,
    chargeGlow: nodes.CannonChargeGlow,
    ammoGlow: nodes.CannonAmmoGlow,
    gaugeNeedle: nodes.CannonGaugeNeedle,
    statusLight: nodes.CannonStatusLight,
    muzzleGlow: nodes.CannonMuzzleGlow,
  };
}
