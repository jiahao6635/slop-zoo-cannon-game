import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  AMMO_TYPES,
  HAZARD_TYPES,
  MISSIONS,
  MODULES,
  getAmmoTypeById,
  getMissionById,
  getMissionRating,
  getNextMissionId,
  validateGameContent,
} from './content/gameContent.js';
import {
  getBestMissionResult,
  isMissionUnlocked,
  loadSave,
  recordMissionResult,
  saveProgress,
} from './systems/saveSystem.js';
import { createInputSystem } from './systems/inputSystem.js';
import {
  DEFAULT_SETTINGS,
  applySettings,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from './systems/settingsSystem.js';
import {
  collectNodeMeshes,
  createCannonAssetLoader,
  prepareCannonAsset,
  resolveCannonRig,
} from './render/cannonAsset.js';
import { createObjectPool } from './render/objectPool.js';
import { createPerformanceMonitor } from './render/performanceMonitor.js';
import { createDynamicResolutionController } from './render/dynamicResolution.js';

const GRAVITY = 9.8;
const CLASSIC_DURATION = 75;
const MAX_ACTIVE_TARGETS = 7;
const FIXED_TIME_STEP = 1 / 60;
const MAX_SIMULATION_STEPS = 3;
const RUNTIME_POOL_CAPACITIES = Object.freeze({
  projectiles: 48,
  particles: 384,
  splats: 24,
  bloomCharges: 16,
});
const RUNTIME_QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({ shadowQuality: 'low', particleQuality: 'low', renderScale: 0.75 }),
  medium: Object.freeze({ shadowQuality: 'medium', particleQuality: 'medium', renderScale: 1 }),
  high: Object.freeze({ shadowQuality: 'high', particleQuality: 'high', renderScale: 1.25 }),
});
const DYNAMIC_RESOLUTION_QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({ minScale: 0.5, maxScale: 0.85 }),
  medium: Object.freeze({ minScale: 0.65, maxScale: 1 }),
  high: Object.freeze({ minScale: 0.75, maxScale: 1.25 }),
});
const SHADOW_QUALITY_PROFILES = Object.freeze({
  off: Object.freeze({ enabled: false, mapSize: 512, type: THREE.BasicShadowMap }),
  low: Object.freeze({ enabled: true, mapSize: 512, type: THREE.BasicShadowMap }),
  medium: Object.freeze({ enabled: true, mapSize: 1024, type: THREE.PCFShadowMap }),
  high: Object.freeze({ enabled: true, mapSize: 2048, type: THREE.PCFSoftShadowMap }),
});
const PARTICLE_QUALITY_PROFILES = Object.freeze({
  low: Object.freeze({ multiplier: 0.35, splatLimit: 8 }),
  medium: Object.freeze({ multiplier: 0.65, splatLimit: 16 }),
  high: Object.freeze({ multiplier: 1, splatLimit: 24 }),
});
const DISTANT_PARTICLE_LOD_DISTANCE_SQ = 18 ** 2;
const ANIMAL_NAMES = Object.freeze({ panda: '熊猫', rabbit: '跃跃兔', bunny: '跃跃兔', frog: '弹簧蛙', bear: '月牙熊', otter: '月牙熊' });
const AMMO_UI_CLASS = Object.freeze({
  'nutrient-gel': 'nutrition',
  'adhesive-bloom': 'bloom',
  'bounce-bubble': 'bounce',
});

const $ = (id) => document.getElementById(id);
const dom = {
  shell: $('game-shell'),
  canvas: $('game-canvas'),
  loading: $('loading-screen'),
  loadingProgress: $('loading-progress'),
  start: $('start-screen'),
  mainMenu: $('main-menu-screen'),
  mainContinueButton: $('main-continue-button'),
  mainMissionsButton: $('main-missions-button'),
  mainSettingsButton: $('main-settings-button'),
  startButton: $('start-button'),
  missionSelect: $('mission-select-screen'),
  missionList: $('mission-list'),
  missionBackButton: $('mission-back-button'),
  missionLoadoutButton: $('mission-loadout-button'),
  selectedMissionName: $('selected-mission-name'),
  selectedMissionDescription: $('selected-mission-description'),
  selectedMissionObjective: $('selected-mission-objective'),
  loadout: $('loadout-screen'),
  loadoutBackButton: $('loadout-back-button'),
  launchMissionButton: $('launch-mission-button'),
  settings: $('settings-screen'),
  settingsForm: $('settings-form'),
  settingsBackButton: $('settings-back-button'),
  settingsDefaultButton: $('settings-default-button'),
  hud: $('hud'),
  score: $('score-value'),
  combo: $('combo-value'),
  time: $('time-value'),
  wave: $('wave-value'),
  ammo: $('ammo-pips'),
  currentAmmoName: $('current-ammo-name'),
  currentAmmoIcon: $('current-ammo-icon'),
  specialAmmoBloom: $('special-ammo-bloom'),
  specialAmmoBounce: $('special-ammo-bounce'),
  mission: $('mission-text'),
  missionProgressValue: $('mission-progress-value'),
  missionProgressMeter: $('mission-progress-meter'),
  stabilityValue: $('stability-value'),
  stabilityMeter: $('stability-meter'),
  secondaryActionHint: $('secondary-action-hint'),
  pauseButton: $('pause-button'),
  pauseScreen: $('pause-screen'),
  pauseMissionName: $('pause-mission-name'),
  pauseMissionProgress: $('pause-mission-progress'),
  pauseStabilityValue: $('pause-stability-value'),
  resumeButton: $('resume-button'),
  retryButton: $('retry-button'),
  pauseSettingsButton: $('pause-settings-button'),
  quitMissionButton: $('quit-mission-button'),
  charge: $('charge-meter'),
  crosshair: $('crosshair'),
  hitMarker: $('hit-marker'),
  gameOver: $('gameover-screen'),
  gameOverTitle: $('gameover-title'),
  resultStatus: $('result-status'),
  resultGrade: $('result-grade'),
  finalScore: $('final-score'),
  bestScore: $('best-score'),
  resultAccuracy: $('result-accuracy'),
  resultBullseye: $('result-bullseye'),
  resultLongestCombo: $('result-longest-combo'),
  resultSpecialUsed: $('result-special-used'),
  resultStability: $('result-stability'),
  resultTime: $('result-time'),
  resultUnlock: $('result-unlock'),
  resultMissionButton: $('result-mission-button'),
  resultNextButton: $('result-next-button'),
  restartButton: $('restart-button'),
  fireButton: $('fire-button'),
  toastRegion: $('toast-region'),
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x061516);
scene.fog = new THREE.FogExp2(0x061516, 0.018);

const renderer = new THREE.WebGLRenderer({
  canvas: dom.canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const environmentGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.72;
environmentGenerator.dispose();

const camera = new THREE.PerspectiveCamera(49, 1, 0.1, 120);
camera.position.set(-6.2, 5.4, 11.8);

let lastFrameTime = performance.now();
let simulationAccumulator = 0;
const pointer = {
  active: false,
  id: null,
  startX: 0,
  startY: 0,
  startYaw: 0,
  startPitch: 0,
};

const projectiles = [];
const targets = [];
const particles = [];
const splats = [];
const bloomCharges = [];
const animatedProps = [];

let saveData = null;
let settings = null;
let inputSystem = null;
let settingsReturnPhase = 'main-menu';
let bossMachine = null;
let keyLight = null;

const runtimeGraphics = {
  qualityPreset: DEFAULT_SETTINGS.graphics.qualityPreset,
  dynamicRenderScale: DEFAULT_SETTINGS.graphics.dynamicRenderScale,
  shadowQuality: DEFAULT_SETTINGS.graphics.shadowQuality,
  particleQuality: DEFAULT_SETTINGS.graphics.particleQuality,
  particleMultiplier: PARTICLE_QUALITY_PROFILES[DEFAULT_SETTINGS.graphics.particleQuality].multiplier,
  splatLimit: PARTICLE_QUALITY_PROFILES[DEFAULT_SETTINGS.graphics.particleQuality].splatLimit,
  userRenderScale: DEFAULT_SETTINGS.graphics.renderScale,
  actualRenderScale: DEFAULT_SETTINGS.graphics.renderScale,
  pixelRatio: 1,
  lastDynamicDecision: null,
};

const dynamicResolutionController = createDynamicResolutionController({
  enabled: runtimeGraphics.dynamicRenderScale,
  qualityPreset: runtimeGraphics.qualityPreset,
  qualityPresets: DYNAMIC_RESOLUTION_QUALITY_PRESETS,
  downSamples: 2,
  upSamples: 5,
  cooldownSamples: 4,
});

const game = {
  phase: 'loading',
  mode: 'campaign',
  selectedMissionId: MISSIONS[0]?.id ?? null,
  mission: null,
  equippedAmmo: ['nutrient-gel'],
  equippedModule: 'pressure-stabilizer',
  activeAmmoIndex: 0,
  inventory: {},
  score: 0,
  combo: 0,
  time: 0,
  wave: 1,
  stability: 100,
  feeds: 0,
  threatProgress: 0,
  bossPhase: 0,
  bossPhaseHits: 0,
  bossPhaseTarget: 0,
  supplyCratesRemaining: 0,
  lastSuccessReason: '',
  lastFailureReason: '',
  spawnTimer: 0,
  yaw: 0,
  pitch: 0.2,
  charging: false,
  charge: 0,
  chargeDirection: 1,
  lastShotAt: -10,
  elapsed: 0,
  recoil: 0,
  shake: 0,
  modelReady: false,
  stats: null,
  lastResult: null,
  pendingOutcome: null,
};

const colors = {
  slime: 0x79ff9a,
  slimeDark: 0x1fa96b,
  brass: 0xd49a42,
  gunmetal: 0x172225,
  cyan: 0x58e6dd,
  orange: 0xffa04d,
  red: 0xff4f5e,
  cream: 0xe7f1d7,
};

const materials = {
  floor: new THREE.MeshStandardMaterial({ color: 0x132426, roughness: 0.92, metalness: 0.08 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x173033, roughness: 0.8, metalness: 0.18 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: colors.gunmetal, roughness: 0.32, metalness: 0.78 }),
  brass: new THREE.MeshStandardMaterial({ color: colors.brass, roughness: 0.26, metalness: 0.86 }),
  slime: new THREE.MeshPhysicalMaterial({
    color: colors.slime,
    emissive: 0x143d22,
    emissiveIntensity: 0.9,
    roughness: 0.16,
    metalness: 0.02,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  }),
  warning: new THREE.MeshStandardMaterial({ color: colors.orange, roughness: 0.42, metalness: 0.3 }),
  hazard: new THREE.MeshStandardMaterial({ color: colors.red, emissive: 0x4d0710, emissiveIntensity: 0.9, roughness: 0.35 }),
};

const ammoMaterials = {
  'nutrient-gel': materials.slime,
  'adhesive-bloom': new THREE.MeshPhysicalMaterial({
    color: 0xffcf62,
    emissive: 0x5a2d08,
    emissiveIntensity: 1.1,
    roughness: 0.18,
    clearcoat: 1,
  }),
  'bounce-bubble': new THREE.MeshPhysicalMaterial({
    color: 0x62dfff,
    emissive: 0x063e55,
    emissiveIntensity: 1.25,
    roughness: 0.08,
    transmission: 0.12,
    clearcoat: 1,
  }),
};

const cannonMount = new THREE.Group();
cannonMount.name = 'GameplayCannonMount';
scene.add(cannonMount);

const aimYawRig = new THREE.Group();
const aimPitchRig = new THREE.Group();
const logicalMuzzle = new THREE.Object3D();
aimPitchRig.position.y = 1.55;
logicalMuzzle.position.set(3.48, 0.29, 0);
aimPitchRig.add(logicalMuzzle);
aimYawRig.add(aimPitchRig);
cannonMount.add(aimYawRig);

let modelYaw = null;
let modelPitch = null;
let modelRecoil = null;
let modelMuzzle = null;
let modelRecoilBase = new THREE.Vector3();
let modelGaugeNeedle = null;
let modelGaugeNeedleBase = 0;
let modelChargeMeshes = [];
let modelAmmoMeshes = [];
let modelStatusMeshes = [];
let modelMuzzleMeshes = [];

const trajectoryGeometry = new THREE.BufferGeometry();
const trajectoryPoints = new Float32Array(42 * 3);
trajectoryGeometry.setAttribute('position', new THREE.BufferAttribute(trajectoryPoints, 3));
const trajectory = new THREE.Line(
  trajectoryGeometry,
  new THREE.LineDashedMaterial({
    color: colors.slime,
    transparent: true,
    opacity: 0.68,
    dashSize: 0.28,
    gapSize: 0.2,
    depthWrite: false,
  }),
);
trajectory.frustumCulled = false;
scene.add(trajectory);

const projectileGeometry = new THREE.IcosahedronGeometry(0.3, 2);
const dropletGeometry = new THREE.IcosahedronGeometry(0.1, 1);
const dropletLowGeometry = new THREE.IcosahedronGeometry(0.1, 0);
const splatGeometry = new THREE.CircleGeometry(1, 18);
const bloomBulbGeometry = new THREE.DodecahedronGeometry(0.35, 1);
const bloomRingGeometry = new THREE.TorusGeometry(0.55, 0.045, 8, 28);
const unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
const unitCylinderGeometry12 = new THREE.CylinderGeometry(1, 1, 1, 12);
const unitCylinderGeometry18 = new THREE.CylinderGeometry(1, 1, 1, 18);
const unitCylinderGeometry24 = new THREE.CylinderGeometry(1, 1, 1, 24);
const targetPlateGeometry = new THREE.CylinderGeometry(0.88, 0.88, 0.18, 32);
const targetRingGeometry = new THREE.TorusGeometry(0.89, 0.075, 10, 32);
const eyeGeometry = new THREE.SphereGeometry(0.09, 16, 12);

const temp = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  d: new THREE.Vector3(),
  color: new THREE.Color(),
  quaternion: new THREE.Quaternion(),
};

function mesh(geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(...position);
  result.rotation.set(...rotation);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function disableObjectShadows(object) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = false;
    node.receiveShadow = false;
  });
  return object;
}

function resetPooledObject3D(object) {
  object.removeFromParent();
  object.visible = false;
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.quaternion.identity();
  object.scale.set(1, 1, 1);
}

const projectilePool = createObjectPool({
  capacity: RUNTIME_POOL_CAPACITIES.projectiles,
  create: () => {
    const projectileMesh = new THREE.Group();
    const core = mesh(projectileGeometry, materials.slime);
    core.scale.set(1.18, 0.9, 0.9);
    const tail = mesh(dropletGeometry, materials.slime, [-0.36, 0, 0]);
    tail.scale.set(2.1, 0.85, 0.85);
    projectileMesh.add(core, tail);
    disableObjectShadows(projectileMesh);
    projectileMesh.visible = false;
    return {
      mesh: projectileMesh,
      core,
      tail,
      position: new THREE.Vector3(),
      previous: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      impactPoint: null,
      radius: 0.29,
      ammoId: 'nutrient-gel',
      gravityMultiplier: 1,
      bouncesRemaining: 0,
      bounces: 0,
      hitSomething: false,
      age: 0,
    };
  },
  reset: (projectile) => {
    resetPooledObject3D(projectile.mesh);
    projectile.core.material = materials.slime;
    projectile.tail.material = materials.slime;
    projectile.position.set(0, 0, 0);
    projectile.previous.set(0, 0, 0);
    projectile.velocity.set(0, 0, 0);
    projectile.impactPoint = null;
    projectile.radius = 0.29;
    projectile.ammoId = 'nutrient-gel';
    projectile.gravityMultiplier = 1;
    projectile.bouncesRemaining = 0;
    projectile.bounces = 0;
    projectile.hitSomething = false;
    projectile.age = 0;
  },
});

const particlePool = createObjectPool({
  capacity: RUNTIME_POOL_CAPACITIES.particles,
  create: () => {
    const material = new THREE.MeshStandardMaterial({
      color: colors.slime,
      emissive: colors.slime,
      emissiveIntensity: 0.75,
      roughness: 0.32,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const particleMesh = mesh(dropletGeometry, material);
    disableObjectShadows(particleMesh);
    particleMesh.visible = false;
    return {
      mesh: particleMesh,
      material,
      velocity: new THREE.Vector3(),
      life: 0,
      age: 0,
      gravity: 0,
    };
  },
  reset: (particle) => {
    resetPooledObject3D(particle.mesh);
    particle.mesh.geometry = dropletGeometry;
    particle.material.color.setHex(colors.slime);
    particle.material.emissive.setHex(colors.slime);
    particle.material.emissiveIntensity = 0.75;
    particle.material.opacity = 1;
    particle.velocity.set(0, 0, 0);
    particle.life = 0;
    particle.age = 0;
    particle.gravity = 0;
  },
  dispose: (particle) => particle.material.dispose(),
});

const splatPool = createObjectPool({
  capacity: RUNTIME_POOL_CAPACITIES.splats,
  create: () => {
    const material = new THREE.MeshBasicMaterial({
      color: colors.slime,
      transparent: true,
      opacity: 0.66,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const splatMesh = mesh(splatGeometry, material);
    disableObjectShadows(splatMesh);
    splatMesh.visible = false;
    return { mesh: splatMesh, material, age: 0, life: 8 };
  },
  reset: (splat) => {
    resetPooledObject3D(splat.mesh);
    splat.material.color.setHex(colors.slime);
    splat.material.opacity = 0.66;
    splat.age = 0;
    splat.life = 8;
  },
  dispose: (splat) => splat.material.dispose(),
});

const bloomChargePool = createObjectPool({
  capacity: RUNTIME_POOL_CAPACITIES.bloomCharges,
  create: () => {
    const chargeMesh = new THREE.Group();
    const material = ammoMaterials['adhesive-bloom'];
    const bulb = mesh(bloomBulbGeometry, material);
    const ring = mesh(bloomRingGeometry, material, [0, 0, 0], [Math.PI / 2, 0, 0]);
    chargeMesh.add(bulb, ring);
    disableObjectShadows(chargeMesh);
    chargeMesh.visible = false;
    return {
      mesh: chargeMesh,
      sourceProjectile: {
        ammoId: 'adhesive-bloom',
        bounces: 0,
        hitSomething: false,
      },
      age: 0,
      armed: false,
      autoDelay: 1.15,
      life: 10,
    };
  },
  reset: (charge) => {
    resetPooledObject3D(charge.mesh);
    charge.sourceProjectile.ammoId = 'adhesive-bloom';
    charge.sourceProjectile.bounces = 0;
    charge.sourceProjectile.hitSomething = false;
    charge.age = 0;
    charge.armed = false;
    charge.autoDelay = 1.15;
    charge.life = 10;
  },
});

function resetAnimalPoolTarget(target) {
  resetPooledObject3D(target.group);
  target.base.set(0, 0, 0);
  target.phase = 0;
  target.speed = 0;
  target.amplitude = 0;
  target.age = 0;
  target.lifetime = 0;
  target.value = 0;
  target.feedRequired = target.kind === 'panda' ? 2 : 1;
  target.feedProgress = 0;
  target.mouthOpen = target.kind !== 'bear';
  target.apexWindow = false;
  target.shielded = false;
  target.lane = 1;

  const { ring, requestRing, mouthIndicator } = target.group.userData;
  ring.material.color.copy(materials.brass.color);
  ring.material.emissive?.setHex(0x000000);
  ring.material.emissiveIntensity = materials.brass.emissiveIntensity ?? 1;
  ring.material.opacity = 1;
  requestRing.material.color.setHex(colors.slime);
  requestRing.material.emissive.setHex(colors.slime);
  requestRing.material.emissiveIntensity = 1.8;
  requestRing.material.opacity = 0.9;
  requestRing.scale.set(1, 1, 1);
  if (mouthIndicator) {
    mouthIndicator.scale.set(1, 1, 1);
    mouthIndicator.material.color.setHex(colors.orange);
    mouthIndicator.material.emissive.setHex(0x56210a);
    mouthIndicator.material.emissiveIntensity = 1.4;
  }
}

function createAnimalTargetPool(kind) {
  return createObjectPool({
    capacity: 8,
    create: () => {
      const group = createAnimalTarget(kind);
      group.visible = false;
      return {
        type: 'animal',
        group,
        base: new THREE.Vector3(),
        kind,
        radius: kind === 'panda' ? 1.12 : 1.02,
        phase: 0,
        speed: 0,
        amplitude: 0,
        age: 0,
        lifetime: 0,
        value: 0,
        feedRequired: kind === 'panda' ? 2 : 1,
        feedProgress: 0,
        mouthOpen: kind !== 'bear',
        apexWindow: false,
        shielded: false,
        lane: 1,
      };
    },
    reset: resetAnimalPoolTarget,
  });
}

function resetHazardPoolTarget(target) {
  resetPooledObject3D(target.group);
  target.base.set(0, 0, 0);
  target.phase = 0;
  target.speed = 0;
  target.amplitude = 0;
  target.age = 0;
  target.lifetime = 0;
  target.disabled = false;
  target.interceptCooldown = 0;
}

function createHazardTargetPool(kind) {
  return createObjectPool({
    capacity: 8,
    create: () => {
      const group = createHazardTarget(kind);
      group.visible = false;
      return {
        type: 'hazard',
        kind,
        group,
        base: new THREE.Vector3(),
        radius: kind === 'barrier-drone' ? 1.08 : 0.9,
        phase: 0,
        speed: 0,
        amplitude: 0,
        age: 0,
        lifetime: 0,
        disabled: false,
        interceptCooldown: 0,
      };
    },
    reset: resetHazardPoolTarget,
  });
}

const animalTargetPools = Object.freeze({
  panda: createAnimalTargetPool('panda'),
  rabbit: createAnimalTargetPool('rabbit'),
  frog: createAnimalTargetPool('frog'),
  bear: createAnimalTargetPool('bear'),
});

const hazardTargetPools = Object.freeze({
  'cleaner-drone': createHazardTargetPool('cleaner-drone'),
  'snack-thief': createHazardTargetPool('snack-thief'),
  'barrier-drone': createHazardTargetPool('barrier-drone'),
});

function resetBossPoolTarget(target) {
  resetPooledObject3D(target.group);
  target.base.set(0, 0, 0);
  target.health = 0;
  target.maxHealth = 0;
  target.phase = 0;
  target.age = 0;
  target.openWindow = false;
  target.ring.material.color.copy(materials.brass.color);
  target.ring.material.emissive?.setHex(0x000000);
  target.ring.material.opacity = 1;
}

function createBossTargetPool(kind, capacity) {
  return createObjectPool({
    capacity,
    create: (index) => buildBossComponentTarget(kind, index),
    reset: resetBossPoolTarget,
  });
}

const bossTargetPools = Object.freeze({
  'feed-port': createBossTargetPool('feed-port', 1),
  'storage-tank': createBossTargetPool('storage-tank', 2),
  'mobile-core': createBossTargetPool('mobile-core', 1),
});

const runtimePools = Object.freeze({
  projectiles: projectilePool,
  particles: particlePool,
  splats: splatPool,
  bloomCharges: bloomChargePool,
  animalPanda: animalTargetPools.panda,
  animalRabbit: animalTargetPools.rabbit,
  animalFrog: animalTargetPools.frog,
  animalBear: animalTargetPools.bear,
  hazardCleaner: hazardTargetPools['cleaner-drone'],
  hazardThief: hazardTargetPools['snack-thief'],
  hazardBarrier: hazardTargetPools['barrier-drone'],
  bossFeedPort: bossTargetPools['feed-port'],
  bossStorageTank: bossTargetPools['storage-tank'],
  bossMobileCore: bossTargetPools['mobile-core'],
});

function getRuntimePoolStats() {
  return Object.fromEntries(Object.entries(runtimePools).map(([name, pool]) => [name, pool.snapshot()]));
}

const performanceAlertLog = [];
let latestPerformanceSnapshot = null;
let performanceHudElement = null;
let performanceHudEnabled = false;

const performanceMonitor = createPerformanceMonitor({
  windowSeconds: 10,
  warmupSeconds: 2,
  sampleIntervalSeconds: 1,
  alertDebounceSamples: 3,
  budgets: {
    avgFps: { min: 55 },
    onePercentLowFps: { min: 45 },
    frameP95Ms: { max: 24 },
    drawCalls: { max: 250 },
    triangles: { max: 500_000 },
    geometries: { max: 300 },
    textures: { max: 192 },
    activeEntities: { max: 600 },
  },
  onAlert: (event) => {
    performanceAlertLog.push({ ...event, limits: { ...event.limits } });
    if (performanceAlertLog.length > 40) performanceAlertLog.shift();
    const label = event.type === 'budget-exceeded' ? 'exceeded' : 'recovered';
    console[event.type === 'budget-exceeded' ? 'warn' : 'info'](
      `[performance] ${event.metric} ${label}`,
      event.value,
      event.limits,
    );
  },
});

function markShadowMaterialsForUpdate() {
  scene.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) material.needsUpdate = true;
  });
}

function disposeKeyLightShadowTargets() {
  if (!keyLight?.shadow) return;
  keyLight.shadow.map?.dispose();
  keyLight.shadow.mapPass?.dispose();
  keyLight.shadow.map = null;
  keyLight.shadow.mapPass = null;
}

function setRuntimeShadowQuality(shadowQuality) {
  const profile = SHADOW_QUALITY_PROFILES[shadowQuality] ?? SHADOW_QUALITY_PROFILES.medium;
  const previousEnabled = renderer.shadowMap.enabled;
  const previousType = renderer.shadowMap.type;
  const previousMapSize = keyLight?.shadow?.mapSize?.width ?? 0;
  const configurationChanged = previousEnabled !== profile.enabled
    || previousType !== profile.type
    || previousMapSize !== profile.mapSize;

  runtimeGraphics.shadowQuality = shadowQuality in SHADOW_QUALITY_PROFILES ? shadowQuality : 'medium';
  renderer.shadowMap.enabled = profile.enabled;
  renderer.shadowMap.type = profile.type;
  renderer.shadowMap.needsUpdate = true;

  if (keyLight) {
    if (configurationChanged) disposeKeyLightShadowTargets();
    keyLight.castShadow = profile.enabled;
    keyLight.shadow.mapSize.set(profile.mapSize, profile.mapSize);
    keyLight.shadow.needsUpdate = profile.enabled;
  }

  if (configurationChanged) markShadowMaterialsForUpdate();
}

function setRuntimeParticleQuality(particleQuality) {
  const resolvedQuality = particleQuality in PARTICLE_QUALITY_PROFILES ? particleQuality : 'medium';
  const profile = PARTICLE_QUALITY_PROFILES[resolvedQuality];
  runtimeGraphics.particleQuality = resolvedQuality;
  runtimeGraphics.particleMultiplier = profile.multiplier;
  runtimeGraphics.splatLimit = Math.min(profile.splatLimit, splatPool.capacity);
  while (splats.length > runtimeGraphics.splatLimit) releaseSplat(splats[0]);
}

function setRuntimeQualityPreset(qualityPreset) {
  const resolvedPreset = qualityPreset in RUNTIME_QUALITY_PRESETS ? qualityPreset : 'medium';
  runtimeGraphics.qualityPreset = resolvedPreset;
  dynamicResolutionController.setQualityPreset(resolvedPreset);
}

function setRuntimeDynamicRenderScale(enabled) {
  runtimeGraphics.dynamicRenderScale = Boolean(enabled);
  dynamicResolutionController.setEnabled(runtimeGraphics.dynamicRenderScale);
}

function setRuntimeUserRenderScale(renderScale) {
  runtimeGraphics.userRenderScale = THREE.MathUtils.clamp(Number(renderScale) || 1, 0.5, 1.5);
}

function setActualRenderScale(renderScale, { resizeRenderer = true } = {}) {
  const nextScale = THREE.MathUtils.clamp(Number(renderScale) || 1, 0.5, 1.5);
  const changed = Math.abs(runtimeGraphics.actualRenderScale - nextScale) > 0.0001;
  runtimeGraphics.actualRenderScale = nextScale;
  if (changed && resizeRenderer) resize();
  return changed;
}

function resetDynamicRenderScale() {
  dynamicResolutionController.reset();
  runtimeGraphics.lastDynamicDecision = null;
  const bounds = dynamicResolutionController.bounds;
  const nextScale = runtimeGraphics.dynamicRenderScale
    ? THREE.MathUtils.clamp(runtimeGraphics.userRenderScale, bounds.minScale, bounds.maxScale)
    : runtimeGraphics.userRenderScale;
  setActualRenderScale(nextScale, { resizeRenderer: false });
}

function sampleDynamicRenderScale(snapshot) {
  const decision = dynamicResolutionController.recordSample(snapshot, runtimeGraphics.actualRenderScale);
  runtimeGraphics.lastDynamicDecision = decision;
  if (decision.changed) setActualRenderScale(decision.renderScale);
  return decision;
}

function getRuntimeGraphicsReport() {
  return {
    qualityPreset: runtimeGraphics.qualityPreset,
    dynamicRenderScale: runtimeGraphics.dynamicRenderScale,
    shadowQuality: runtimeGraphics.shadowQuality,
    particleQuality: runtimeGraphics.particleQuality,
    particleMultiplier: runtimeGraphics.particleMultiplier,
    splatLimit: runtimeGraphics.splatLimit,
    userRenderScale: runtimeGraphics.userRenderScale,
    actualRenderScale: runtimeGraphics.actualRenderScale,
    pixelRatio: renderer.getPixelRatio(),
    dynamicResolution: dynamicResolutionController.snapshot(),
    lastDynamicDecision: runtimeGraphics.lastDynamicDecision,
  };
}

function getRuntimeEntityCounts() {
  return {
    targets: targets.length,
    projectiles: projectiles.length,
    particles: particles.length,
    splats: splats.length,
    bloomCharges: bloomCharges.length,
  };
}

function getPerformanceReport() {
  return {
    snapshot: latestPerformanceSnapshot ?? performanceMonitor.snapshot(),
    graphics: getRuntimeGraphicsReport(),
    pools: getRuntimePoolStats(),
    entities: getRuntimeEntityCounts(),
    alerts: performanceAlertLog.map((alert) => ({ ...alert, limits: { ...alert.limits } })),
  };
}

function runPoolStressTest(options = {}) {
  const cycles = THREE.MathUtils.clamp(Math.trunc(Number(options.cycles) || 10_000), 1, 200_000);
  const requestedBatchSize = THREE.MathUtils.clamp(Math.trunc(Number(options.batchSize) || 32), 1, 256);
  const before = getRuntimePoolStats();

  const runPass = () => {
    for (const [name, pool] of Object.entries(runtimePools)) {
      const availableCapacity = Math.max(0, pool.capacity - pool.stats.active);
      const targetWarmupLimit = name.startsWith('animal') || name.startsWith('hazard') ? 2 : requestedBatchSize;
      const batchSize = Math.min(targetWarmupLimit, availableCapacity);
      if (batchSize === 0) continue;
      let remaining = cycles;
      const acquired = [];
      while (remaining > 0) {
        const currentBatch = Math.min(batchSize, remaining);
        for (let index = 0; index < currentBatch; index += 1) {
          const item = pool.acquire();
          if (item) acquired.push(item);
        }
        while (acquired.length > 0) pool.release(acquired.pop());
        remaining -= currentBatch;
      }
    }
  };

  const startedAt = performance.now();
  runPass();
  const warmed = getRuntimePoolStats();
  runPass();
  const after = getRuntimePoolStats();
  const names = Object.keys(runtimePools);
  return {
    cyclesPerPass: cycles,
    batchSize: requestedBatchSize,
    passes: 2,
    durationMs: performance.now() - startedAt,
    before,
    warmed,
    after,
    createdPlateau: names.every((name) => after[name].created === warmed[name].created),
    activeRestored: names.every((name) => after[name].active === before[name].active),
    withinCapacity: names.every((name) => after[name].created <= after[name].capacity),
  };
}

function addBox(parent, size, position, material = materials.wall, rotation = [0, 0, 0]) {
  const result = mesh(new THREE.BoxGeometry(...size), material, position, rotation);
  parent.add(result);
  return result;
}

function addCylinder(parent, radius, depth, position, material, rotation = [0, 0, 0], segments = 24) {
  const result = mesh(new THREE.CylinderGeometry(radius, radius, depth, segments), material, position, rotation);
  parent.add(result);
  return result;
}

function addInstancedBoxes(parent, instances, material) {
  const result = new THREE.InstancedMesh(unitBoxGeometry, material, instances.length);
  const transform = new THREE.Object3D();
  instances.forEach(({ size, position, rotation = [0, 0, 0] }, index) => {
    transform.position.set(...position);
    transform.rotation.set(...rotation);
    transform.scale.set(...size);
    transform.updateMatrix();
    result.setMatrixAt(index, transform.matrix);
  });
  result.instanceMatrix.needsUpdate = true;
  result.computeBoundingSphere();
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

function addInstancedCylinders(parent, instances, material, segments = 12) {
  const geometry = segments === 24
    ? unitCylinderGeometry24
    : segments === 18
      ? unitCylinderGeometry18
      : unitCylinderGeometry12;
  const result = new THREE.InstancedMesh(geometry, material, instances.length);
  const transform = new THREE.Object3D();
  instances.forEach(({ radius, depth, position, rotation = [0, 0, 0] }, index) => {
    transform.position.set(...position);
    transform.rotation.set(...rotation);
    transform.scale.set(radius, depth, radius);
    transform.updateMatrix();
    result.setMatrixAt(index, transform.matrix);
  });
  result.instanceMatrix.needsUpdate = true;
  result.computeBoundingSphere();
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

function createTextTexture(lines, accent = '#79ff9a') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#071517';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 12;
  ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
  ctx.fillStyle = accent;
  ctx.font = '700 86px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(lines[0], canvas.width / 2, 102);
  ctx.fillStyle = '#d9eee4';
  ctx.font = '500 33px system-ui, sans-serif';
  ctx.fillText(lines[1], canvas.width / 2, 190);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  return texture;
}

function buildEnvironment() {
  const environment = new THREE.Group();
  environment.name = 'SlopZooRange';
  scene.add(environment);

  const ground = mesh(new THREE.PlaneGeometry(58, 34), materials.floor, [9, -0.035, 0], [-Math.PI / 2, 0, 0]);
  ground.receiveShadow = true;
  ground.castShadow = false;
  environment.add(ground);

  const grid = new THREE.GridHelper(58, 58, 0x2f7b70, 0x1c3a3c);
  grid.position.set(9, 0.012, 0);
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  environment.add(grid);

  addBox(environment, [0.5, 8.5, 21], [25.5, 4.2, 0], materials.wall);
  addBox(environment, [34, 7.2, 0.45], [8.5, 3.55, -10.3], materials.wall);

  const archMaterial = new THREE.MeshStandardMaterial({ color: 0x23464a, roughness: 0.55, metalness: 0.52 });
  const archInstances = [];
  for (const x of [5.5, 11.5, 17.5, 23.5]) {
    archInstances.push(
      { size: [0.28, 6.7, 0.32], position: [x, 3.35, -8.7] },
      { size: [0.28, 6.7, 0.32], position: [x, 3.35, 8.7] },
      { size: [0.28, 0.32, 17.7], position: [x, 6.62, 0] },
    );
  }
  addInstancedBoxes(environment, archInstances, archMaterial);

  const railMaterial = new THREE.MeshStandardMaterial({ color: colors.brass, roughness: 0.33, metalness: 0.8 });
  const railInstances = [];
  for (const z of [-2.2, 2.2]) {
    railInstances.push({ radius: 0.045, depth: 4.3, position: [0, 0.85, z], rotation: [0, 0, Math.PI / 2] });
    for (const x of [-2, 0, 2]) {
      railInstances.push({ radius: 0.05, depth: 1.45, position: [x, 0.72, z] });
    }
  }
  addInstancedCylinders(environment, railInstances, railMaterial, 12);

  addBox(environment, [4.8, 0.28, 4.8], [0, 0.13, 0], new THREE.MeshStandardMaterial({ color: 0xd9e1d8, roughness: 0.78 }));

  const pipeMaterial = new THREE.MeshStandardMaterial({ color: 0x356c69, roughness: 0.42, metalness: 0.58 });
  const pipeInstances = [];
  for (const y of [1.2, 1.75, 2.3]) {
    pipeInstances.push({ radius: 0.11, depth: 28, position: [10, y, -9.95], rotation: [0, 0, Math.PI / 2] });
  }
  for (const x of [7, 14, 21]) {
    pipeInstances.push({ radius: 0.12, depth: 4.5, position: [x, 2.3, -9.95] });
  }
  addInstancedCylinders(environment, pipeInstances, pipeMaterial, 18);

  const sign = mesh(
    new THREE.PlaneGeometry(6.8, 1.7),
    new THREE.MeshBasicMaterial({ map: createTextTexture(['SLOP ZOO', '营养补给实验场 · FEED LAB']), toneMapped: false }),
    [25.22, 6.55, 0],
    [0, -Math.PI / 2, 0],
  );
  sign.castShadow = false;
  environment.add(sign);

  const neonMaterial = new THREE.MeshStandardMaterial({
    color: colors.slime,
    emissive: colors.slime,
    emissiveIntensity: 3.5,
    roughness: 0.22,
  });
  addInstancedBoxes(environment, [-7.6, 0, 7.6].map((z) => ({
    size: [0.08, 4.8, 0.12],
    position: [25.18, 3.2, z],
  })), neonMaterial);

  const platformBases = [];
  const platformPosts = [];
  for (let i = 0; i < 7; i += 1) {
    const x = 13 + (i % 4) * 3.15;
    const z = -6.3 + Math.floor(i / 4) * 12.6 + (i % 2) * 0.8;
    const heightOffset = (i % 3) * 0.35;
    platformBases.push({ size: [1.5, 0.2, 1.5], position: [x, 0.75 + heightOffset, z] });
    platformPosts.push({ radius: 0.14, depth: 1 + heightOffset, position: [x, 0.2 + heightOffset, z] });
  }
  addInstancedBoxes(environment, platformBases, materials.darkMetal);
  addInstancedCylinders(environment, platformPosts, materials.brass, 24);

  const fan = new THREE.Group();
  fan.position.set(25.1, 3.4, -6.2);
  fan.rotation.y = -Math.PI / 2;
  const hub = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 24), materials.brass, [0, 0, 0], [Math.PI / 2, 0, 0]);
  fan.add(hub);
  addInstancedBoxes(fan, Array.from({ length: 4 }, (_, index) => {
    const rotation = index * Math.PI / 2;
    return {
      size: [0.18, 1.5, 0.12],
      position: [-Math.sin(rotation) * 0.75, Math.cos(rotation) * 0.75, 0],
      rotation: [0, 0, rotation],
    };
  }), materials.darkMetal);
  environment.add(fan);
  animatedProps.push({ object: fan, type: 'fan' });

  const hemi = new THREE.HemisphereLight(0x9ee7dd, 0x071011, 1.75);
  scene.add(hemi);

  keyLight = new THREE.DirectionalLight(0xffedd1, 4.1);
  keyLight.position.set(-5, 10, 8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -18;
  keyLight.shadow.camera.right = 24;
  keyLight.shadow.camera.top = 16;
  keyLight.shadow.camera.bottom = -12;
  keyLight.shadow.bias = -0.0003;
  scene.add(keyLight);

  const rangeLight = new THREE.PointLight(colors.slime, 28, 22, 1.8);
  rangeLight.position.set(19, 5, 0);
  scene.add(rangeLight);

  const warmLight = new THREE.PointLight(colors.orange, 22, 16, 2);
  warmLight.position.set(1, 4.5, 4.5);
  scene.add(warmLight);
}

function createFallbackCannon() {
  const root = new THREE.Group();
  root.name = 'FallbackCannon';
  cannonMount.add(root);

  addCylinder(root, 1.05, 0.14, [0, 0.16, 0], materials.darkMetal);
  addCylinder(root, 0.78, 0.24, [0, 0.34, 0], materials.brass);
  addCylinder(root, 0.48, 0.95, [0, 0.82, 0], materials.darkMetal);

  const yaw = new THREE.Group();
  const pitch = new THREE.Group();
  const recoil = new THREE.Group();
  yaw.name = 'FallbackYaw';
  pitch.name = 'FallbackPitch';
  recoil.name = 'FallbackRecoil';
  pitch.position.y = 1.55;
  yaw.add(pitch);
  pitch.add(recoil);
  root.add(yaw);

  addCylinder(recoil, 0.52, 1.25, [0.1, 0, 0], materials.darkMetal, [0, 0, Math.PI / 2]);
  addCylinder(recoil, 0.33, 2.75, [1.75, 0.18, 0], materials.darkMetal, [0, 0, Math.PI / 2]);
  addCylinder(recoil, 0.44, 0.18, [3.15, 0.18, 0], materials.brass, [0, 0, Math.PI / 2]);
  addCylinder(recoil, 0.48, 0.72, [-0.62, 0, 0], materials.darkMetal, [0, 0, Math.PI / 2]);
  const hopper = mesh(new THREE.ConeGeometry(0.58, 0.85, 24), materials.brass, [-0.25, 0.93, 0], [0, 0, Math.PI]);
  recoil.add(hopper);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'FallbackMuzzleAnchor';
  muzzle.position.set(3.48, 0.29, 0);
  recoil.add(muzzle);

  modelYaw = yaw;
  modelPitch = pitch;
  modelRecoil = recoil;
  modelMuzzle = muzzle;
  modelRecoilBase.copy(recoil.position);
  modelGaugeNeedle = null;
  modelChargeMeshes = [];
  modelAmmoMeshes = [];
  modelStatusMeshes = [];
  modelMuzzleMeshes = [];
  game.modelReady = true;
  return root;
}

function loadCannonAsset() {
  return new Promise((resolve) => {
    const loader = createCannonAssetLoader();
    loader.load(
      `${import.meta.env.BASE_URL}assets/slop-cannon.glb`,
      (gltf) => {
        const root = gltf.scene;
        root.name = 'BlenderSlopCannon';
        prepareCannonAsset(root);
        cannonMount.add(root);
        const rig = resolveCannonRig(root);
        if (rig.missing.length > 0) {
          cannonMount.remove(root);
          createFallbackCannon();
          toast(`Blender 素材层级缺失：${rig.missing.join('、')}，已启用备用炮台`, 'warning');
        } else {
          modelYaw = rig.yaw;
          modelPitch = rig.pitch;
          modelRecoil = rig.recoil;
          modelMuzzle = rig.muzzle;
          modelRecoilBase.copy(modelRecoil.position);
          modelGaugeNeedle = rig.gaugeNeedle;
          modelGaugeNeedleBase = modelGaugeNeedle?.rotation.y ?? 0;
          modelChargeMeshes = collectNodeMeshes(rig.chargeGlow);
          modelAmmoMeshes = collectNodeMeshes(rig.ammoGlow);
          modelStatusMeshes = collectNodeMeshes(rig.statusLight);
          modelMuzzleMeshes = collectNodeMeshes(rig.muzzleGlow);
          game.modelReady = true;
        }
        dom.loadingProgress.style.width = '100%';
        resolve();
      },
      (event) => {
        if (!event.total) return;
        const percent = Math.min(96, Math.round((event.loaded / event.total) * 100));
        dom.loadingProgress.style.width = `${percent}%`;
      },
      () => {
        createFallbackCannon();
        dom.loadingProgress.style.width = '100%';
        toast('未找到 GLB，已启用程序化备用炮台', 'warning');
        resolve();
      },
    );
  });
}

function createAnimalTarget(kind) {
  const normalizedKind = kind === 'bunny' ? 'rabbit' : kind === 'otter' ? 'bear' : kind;
  const group = new THREE.Group();
  group.name = `${normalizedKind}SupplyRequest`;

  const palette = {
    panda: 0xf0f4de,
    rabbit: 0xffa6c6,
    bear: 0xe6a35d,
    frog: 0x67df7c,
  };
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: palette[normalizedKind] ?? 0xf0f4de,
    roughness: 0.5,
    metalness: 0.02,
  });
  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0x203b3c, roughness: 0.55, metalness: 0.5 });

  const plate = mesh(targetPlateGeometry, plateMaterial, [0, 0, 0], [0, 0, Math.PI / 2]);
  const ringMaterial = materials.brass.clone();
  const ring = mesh(targetRingGeometry, ringMaterial, [-0.11, 0, 0], [0, Math.PI / 2, 0]);
  group.add(plate, ring);

  const face = mesh(new THREE.SphereGeometry(0.58, 24, 18), faceMaterial, [-0.2, 0, 0]);
  face.scale.x = 0.34;
  group.add(face);

  const dark = new THREE.MeshStandardMaterial({ color: 0x172123, roughness: 0.65 });
  const leftEye = mesh(eyeGeometry, dark, [-0.43, 0.13, -0.21]);
  const rightEye = mesh(eyeGeometry, dark, [-0.43, 0.13, 0.21]);
  const nose = mesh(new THREE.SphereGeometry(0.08, 14, 10), dark, [-0.48, -0.08, 0]);
  group.add(leftEye, rightEye, nose);

  if (normalizedKind === 'rabbit') {
    for (const z of [-0.27, 0.27]) {
      const ear = mesh(new THREE.SphereGeometry(0.19, 18, 12), faceMaterial, [-0.18, 0.72, z]);
      ear.scale.set(0.42, 1.8, 0.82);
      group.add(ear);
    }
  } else if (normalizedKind === 'frog') {
    for (const z of [-0.32, 0.32]) {
      const eyeBump = mesh(new THREE.SphereGeometry(0.2, 18, 12), faceMaterial, [-0.2, 0.45, z]);
      group.add(eyeBump);
    }
  } else {
    for (const z of [-0.39, 0.39]) {
      const ear = mesh(new THREE.SphereGeometry(0.22, 18, 12), faceMaterial, [-0.18, 0.42, z]);
      group.add(ear);
    }
  }

  if (normalizedKind === 'panda') {
    for (const z of [-0.21, 0.21]) {
      const patch = mesh(new THREE.SphereGeometry(0.16, 16, 10), dark, [-0.47, 0.13, z]);
      patch.scale.set(0.4, 1.2, 1.25);
      group.add(patch);
    }
  }

  let mouthIndicator = null;
  if (normalizedKind === 'bear') {
    const mouthMaterial = new THREE.MeshStandardMaterial({ color: colors.orange, emissive: 0x56210a, emissiveIntensity: 1.4 });
    mouthIndicator = mesh(new THREE.TorusGeometry(0.19, 0.055, 10, 24), mouthMaterial, [-0.51, -0.18, 0], [0, Math.PI / 2, 0]);
    group.add(mouthIndicator);
  }

  const stem = addCylinder(group, 0.09, 1.45, [0.12, -1.52, 0], materials.darkMetal);
  stem.castShadow = true;
  addBox(group, [0.6, 0.15, 1.1], [0.12, -2.25, 0], materials.brass);

  const requestMaterial = new THREE.MeshStandardMaterial({
    color: colors.slime,
    emissive: colors.slime,
    emissiveIntensity: 1.8,
    transparent: true,
    opacity: 0.9,
  });
  const requestRing = mesh(new THREE.TorusGeometry(1.07, 0.045, 8, 40), requestMaterial, [-0.13, 0, 0], [0, Math.PI / 2, 0]);
  requestRing.castShadow = false;
  group.add(requestRing);
  group.userData = { ring, requestRing, mouthIndicator, normalizedKind };

  return group;
}

function createHazardTarget(kind) {
  const group = new THREE.Group();
  group.name = `${kind}Hazard`;
  const palette = {
    'cleaner-drone': 0xff4f5e,
    'snack-thief': 0xff9b45,
    'barrier-drone': 0xc76dff,
  };
  const accent = palette[kind] ?? colors.red;
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 1.2,
    roughness: 0.3,
    metalness: 0.48,
  });
  const plate = mesh(targetPlateGeometry, new THREE.MeshStandardMaterial({ color: 0x2d1b24, roughness: 0.5, metalness: 0.6 }), [0, 0, 0], [0, 0, Math.PI / 2]);
  const ring = mesh(targetRingGeometry, accentMaterial, [-0.11, 0, 0], [0, Math.PI / 2, 0]);
  group.add(plate, ring);

  if (kind === 'cleaner-drone') {
    group.add(mesh(new THREE.OctahedronGeometry(0.52, 1), accentMaterial, [-0.2, 0, 0]));
    for (const z of [-0.5, 0.5]) group.add(mesh(new THREE.BoxGeometry(0.12, 0.9, 0.2), materials.darkMetal, [-0.18, 0, z]));
  } else if (kind === 'snack-thief') {
    const jaw = mesh(new THREE.ConeGeometry(0.48, 0.9, 4), accentMaterial, [-0.25, 0, 0], [0, 0, -Math.PI / 2]);
    group.add(jaw);
    for (const z of [-0.55, 0.55]) group.add(mesh(new THREE.SphereGeometry(0.16, 12, 8), materials.darkMetal, [-0.1, 0, z]));
  } else {
    group.add(mesh(new THREE.TorusKnotGeometry(0.36, 0.11, 48, 8), accentMaterial, [-0.2, 0, 0], [0, Math.PI / 2, 0]));
    const shieldMaterial = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
    const shield = mesh(new THREE.SphereGeometry(2.15, 24, 16, 0, Math.PI), shieldMaterial, [0.5, 0, 0], [0, Math.PI / 2, 0]);
    shield.castShadow = false;
    group.add(shield);
    group.userData.shield = shield;
  }

  const warningBar = addBox(group, [0.12, 0.95, 0.16], [-0.5, 0, 0], accentMaterial);
  warningBar.rotation.x = Math.PI / 4;
  group.userData.ring = ring;
  return group;
}

function createBossMachine() {
  const group = new THREE.Group();
  group.name = 'MechanicalBearTongTong';
  group.position.set(20, 3.1, 0);
  const body = mesh(new THREE.SphereGeometry(2.25, 32, 20), materials.darkMetal);
  body.scale.x = 0.8;
  group.add(body);
  addCylinder(group, 1.5, 0.5, [-1.75, -1.7, 0], materials.brass, [0, 0, Math.PI / 2]);
  for (const z of [-1.4, 1.4]) {
    group.add(mesh(new THREE.SphereGeometry(0.62, 20, 14), materials.brass, [-0.2, 1.75, z]));
    addCylinder(group, 0.3, 2.3, [-0.1, -1.35, z], materials.brass);
  }
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: colors.cyan, emissive: colors.cyan, emissiveIntensity: 2.2 });
  for (const z of [-0.65, 0.65]) group.add(mesh(new THREE.SphereGeometry(0.18, 16, 12), eyeMaterial, [-1.75, 0.6, z]));
  const labelTexture = createTextTexture(['桶桶 T-07', 'CARE CORE // REPAIR'], '#ffcf62');
  const label = mesh(new THREE.PlaneGeometry(2.5, 0.7), new THREE.MeshBasicMaterial({ map: labelTexture, toneMapped: false }), [-1.85, -0.45, 0], [0, -Math.PI / 2, 0]);
  label.castShadow = false;
  group.add(label);
  scene.add(group);
  return group;
}

function buildBossComponentTarget(kind, index = 0) {
  const group = new THREE.Group();
  group.name = `Boss-${kind}-${index}`;
  let geometry = new THREE.CylinderGeometry(0.72, 0.72, 0.26, 32);
  if (kind === 'mobile-core') geometry = new THREE.IcosahedronGeometry(0.78, 2);
  const material = new THREE.MeshStandardMaterial({
    color: kind === 'feed-port' ? colors.orange : kind === 'storage-tank' ? 0xffcf62 : colors.cyan,
    emissive: kind === 'mobile-core' ? 0x07586b : 0x4a2105,
    emissiveIntensity: 1.45,
    roughness: 0.24,
    metalness: 0.46,
  });
  const core = mesh(geometry, material, [0, 0, 0], kind === 'mobile-core' ? [0, 0, 0] : [0, 0, Math.PI / 2]);
  group.add(core);
  const ring = mesh(new THREE.TorusGeometry(0.88, 0.09, 10, 32), materials.brass.clone(), [-0.12, 0, 0], [0, Math.PI / 2, 0]);
  group.add(ring);
  group.visible = false;
  return {
    type: 'boss',
    kind,
    group,
    base: new THREE.Vector3(),
    radius: 0.92,
    health: 0,
    maxHealth: 0,
    phase: 0,
    age: 0,
    openWindow: false,
    ring,
    core,
  };
}

function createBossComponent(kind, health, base, index = 0) {
  const pool = bossTargetPools[kind];
  const target = pool?.acquire() ?? null;
  if (!target) return null;
  target.group.name = `Boss-${kind}-${index}`;
  target.group.position.copy(base);
  target.group.visible = true;
  target.base.copy(base);
  target.radius = 0.92;
  target.health = health;
  target.maxHealth = health;
  target.phase = Math.random() * Math.PI * 2;
  target.age = 0;
  target.openWindow = false;
  target.ring.material.color.copy(materials.brass.color);
  scene.add(target.group);
  return target;
}

function chooseTargetPosition(kind = 'panda', result = new THREE.Vector3()) {
  const x = THREE.MathUtils.randFloat(13.5, game.wave === 1 ? 19.5 : 23.2);
  const z = THREE.MathUtils.randFloat(-7.2, 7.2);
  const highTarget = kind === 'frog' || game.wave > 1;
  const y = THREE.MathUtils.randFloat(kind === 'bear' ? 2.25 : 2.5, highTarget ? 4.5 : 3.7);
  return result.set(x, y, z);
}

function currentEncounter() {
  const encounters = game.mission?.encounters ?? [];
  if (encounters.length === 0) return null;
  return encounters.find((entry) => game.elapsed >= entry.startAt && game.elapsed < entry.startAt + entry.duration)
    ?? encounters.at(-1);
}

function chooseSpawnKind() {
  const encounter = currentEncounter();
  const entries = Object.entries(encounter?.spawn ?? {});
  if (entries.length > 0) {
    const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, Number(weight) || 0), 0);
    let roll = Math.random() * Math.max(total, 1);
    for (const [kind, weight] of entries) {
      roll -= Math.max(0, Number(weight) || 0);
      if (roll <= 0) return kind;
    }
  }
  const animals = game.mission?.animals?.length ? game.mission.animals : ['panda', 'rabbit', 'frog', 'bear'];
  return animals[Math.floor(Math.random() * animals.length)];
}

function spawnTarget(requestedKind = null) {
  if (game.mission?.missionType === 'boss') return null;
  const kind = requestedKind ?? chooseSpawnKind();
  if (HAZARD_TYPES.some((entry) => entry.id === kind)) return spawnHazard(kind);
  return spawnAnimal(kind);
}

function spawnAnimal(kind) {
  const normalizedKind = kind === 'bunny' ? 'rabbit' : kind === 'otter' ? 'bear' : kind;
  const pool = animalTargetPools[normalizedKind];
  const target = pool?.acquire() ?? null;
  if (!target) return null;
  chooseTargetPosition(normalizedKind, target.base);
  target.group.position.copy(target.base);
  target.group.rotation.y = 0;
  target.group.visible = true;
  scene.add(target.group);

  const feedRequired = normalizedKind === 'panda' ? 2 : 1;
  target.radius = normalizedKind === 'panda' ? 1.12 : 1.02;
  target.phase = Math.random() * Math.PI * 2;
  target.speed = THREE.MathUtils.randFloat(0.7, 1.15) * (1 + game.wave * 0.08);
  target.amplitude = normalizedKind === 'panda' ? 0.45 : THREE.MathUtils.randFloat(0.8, 1.65);
  target.age = 0;
  target.lifetime = THREE.MathUtils.randFloat(12.5, 17.5);
  target.value = Math.round(115 + target.base.x * 5 + target.base.y * 14);
  target.feedRequired = feedRequired;
  target.feedProgress = 0;
  target.mouthOpen = normalizedKind !== 'bear';
  target.apexWindow = false;
  target.shielded = false;
  target.lane = Math.sign(target.base.z) || 1;
  targets.push(target);
  return target;
}

function spawnHazard(kind) {
  if (!game.mission?.hazards?.includes(kind) && game.mode !== 'classic') return null;
  const pool = hazardTargetPools[kind];
  const target = pool?.acquire() ?? null;
  if (!target) return null;
  chooseTargetPosition('hazard', target.base);
  target.group.position.copy(target.base);
  target.group.visible = true;
  scene.add(target.group);
  target.radius = kind === 'barrier-drone' ? 1.08 : 0.9;
  target.phase = Math.random() * Math.PI * 2;
  target.speed = kind === 'snack-thief' ? 1.65 : 1.05;
  target.amplitude = THREE.MathUtils.randFloat(1.2, 2.4);
  target.age = 0;
  target.lifetime = THREE.MathUtils.randFloat(13, 19);
  target.disabled = false;
  target.interceptCooldown = THREE.MathUtils.randFloat(0.7, 1.6);
  targets.push(target);
  return target;
}

function removeObject(object) {
  if (object?.parent) object.parent.remove(object);
}

function getTargetPool(target) {
  if (target?.type === 'animal') return animalTargetPools[target.kind] ?? null;
  if (target?.type === 'hazard') return hazardTargetPools[target.kind] ?? null;
  if (target?.type === 'boss') return bossTargetPools[target.kind] ?? null;
  return null;
}

function releaseTargetObject(target) {
  const pool = getTargetPool(target);
  if (pool) return pool.release(target);
  removeObject(target?.group);
  return false;
}

function releaseParticle(particle) {
  const index = particles.indexOf(particle);
  if (index >= 0) particles.splice(index, 1);
  return particlePool.release(particle);
}

function releaseParticleAt(index) {
  const [particle] = particles.splice(index, 1);
  return particle ? particlePool.release(particle) : false;
}

function releaseSplat(splat) {
  const index = splats.indexOf(splat);
  if (index >= 0) splats.splice(index, 1);
  return splatPool.release(splat);
}

function releaseSplatAt(index) {
  const [splat] = splats.splice(index, 1);
  return splat ? splatPool.release(splat) : false;
}

function releaseBloomCharge(charge) {
  const index = bloomCharges.indexOf(charge);
  if (index >= 0) bloomCharges.splice(index, 1);
  return bloomChargePool.release(charge);
}

function removeTarget(target) {
  const index = targets.indexOf(target);
  if (index >= 0) targets.splice(index, 1);
  releaseTargetObject(target);
}

function clearRoundObjects() {
  clearActiveOrdnance();
  for (const target of targets.splice(0)) releaseTargetObject(target);
  for (const particle of particles.splice(0)) particlePool.release(particle);
  for (const splat of splats.splice(0)) splatPool.release(splat);
  removeObject(bossMachine);
}

function clearActiveOrdnance() {
  for (const projectile of projectiles.splice(0)) projectilePool.release(projectile);
  for (const charge of bloomCharges.splice(0)) bloomChargePool.release(charge);
  updateAmmoUI();
}

function currentShotPower() {
  const ammo = getAmmoTypeById(activeAmmoId());
  return (15 + (game.charging ? game.charge : 0.48) * 8.5) * (ammo?.projectile?.speedMultiplier ?? 1);
}

function activeAmmoId() {
  return game.equippedAmmo[game.activeAmmoIndex] ?? game.equippedAmmo[0] ?? 'nutrient-gel';
}

function activeInventory() {
  return game.inventory[activeAmmoId()] ?? null;
}

function equippedModuleDefinition() {
  return MODULES.find((entry) => entry.id === game.equippedModule) ?? null;
}

function maximumShotLimit() {
  const value = game.mission?.objectives?.primary?.maximumShots;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function cancelCharge() {
  game.charging = false;
  game.charge = 0;
  game.chargeDirection = 1;
  const pointerId = pointer.id;
  pointer.active = false;
  pointer.id = null;
  if (pointerId !== null && dom.canvas?.hasPointerCapture?.(pointerId)) {
    dom.canvas.releasePointerCapture(pointerId);
  }
  updateChargeUI();
}

function maybeDeploySupplyCrate() {
  if (game.phase !== 'playing' || game.supplyCratesRemaining <= 0 || !game.mission?.ammoRules?.rechargeDisabled) return false;
  const inventories = Object.entries(game.inventory);
  const currentTotal = inventories.reduce((sum, [, inventory]) => sum + inventory.current, 0);
  if (currentTotal > 2) return false;

  const shotLimit = maximumShotLimit();
  const shotsRemaining = shotLimit === null ? Infinity : Math.max(0, shotLimit - game.stats.shotsFired);
  const availableSpace = inventories.reduce((sum, [, inventory]) => sum + Math.max(0, inventory.capacity - inventory.current), 0);
  let grantBudget = Math.min(3, availableSpace, Math.max(0, shotsRemaining - currentTotal));
  if (grantBudget <= 0) return false;

  const prioritized = [
    ...inventories.filter(([ammoId]) => ammoId === activeAmmoId()),
    ...inventories.filter(([ammoId]) => ammoId !== activeAmmoId()),
  ];
  let granted = 0;
  while (grantBudget > 0) {
    const recipient = prioritized.find(([, inventory]) => inventory.current < inventory.capacity);
    if (!recipient) break;
    recipient[1].current += 1;
    grantBudget -= 1;
    granted += 1;
  }
  if (granted <= 0) return false;

  game.supplyCratesRemaining -= 1;
  updateAmmoUI();
  updateMission();
  toast(`应急补给箱送达 · 恢复 ${granted} 发 · 剩余 ${game.supplyCratesRemaining} 箱`, 'success');
  return true;
}

function updateAimRigs() {
  aimYawRig.rotation.y = -game.yaw;
  aimPitchRig.rotation.z = game.pitch;
  if (modelYaw) modelYaw.rotation.y = -game.yaw;
  if (modelPitch) modelPitch.rotation.z = game.pitch;
  if (modelRecoil) {
    modelRecoil.position.copy(modelRecoilBase);
    modelRecoil.position.x -= game.recoil * 0.32;
  }
}

function setCannonGlow(meshes, intensity, color = null) {
  for (const cannonMesh of meshes) {
    const list = Array.isArray(cannonMesh.material) ? cannonMesh.material : [cannonMesh.material];
    for (const material of list) {
      if (!material) continue;
      if ('emissiveIntensity' in material) material.emissiveIntensity = intensity;
      if (color !== null) {
        material.color?.setHex(color);
        material.emissive?.setHex(color);
      }
    }
  }
}

function updateCannonModelFeedback() {
  const inventory = activeInventory();
  const ammoRatio = inventory?.capacity > 0 ? inventory.current / inventory.capacity : 1;
  const charge = game.charging ? game.charge : 0;
  const reducedMotion = settings?.accessibility?.reducedMotion;
  const pulse = reducedMotion ? 0 : (Math.sin(game.elapsed * 5.5) + 1) * 0.12;
  const firingFlash = Math.min(1, game.recoil * 4.5);

  setCannonGlow(modelChargeMeshes, 0.8 + charge * 4.8 + pulse + firingFlash * 2.4);
  setCannonGlow(modelAmmoMeshes, 0.85 + ammoRatio * 2.65 + pulse * 0.5);
  setCannonGlow(modelMuzzleMeshes, 0.35 + firingFlash * 10);

  const statusCritical = game.phase === 'playing' && game.stability <= 25;
  const statusWarning = game.phase === 'playing' && game.stability <= 50;
  const statusColor = statusCritical ? colors.red : statusWarning ? colors.orange : colors.slime;
  setCannonGlow(modelStatusMeshes, 1.5 + pulse * 4, statusColor);

  if (modelGaugeNeedle) {
    const target = modelGaugeNeedleBase + THREE.MathUtils.lerp(-0.15, 1.25, charge);
    modelGaugeNeedle.rotation.y = THREE.MathUtils.lerp(modelGaugeNeedle.rotation.y, target, 0.22);
  }
}

function getMuzzleState(position, direction) {
  const muzzle = modelMuzzle ?? logicalMuzzle;
  muzzle.getWorldPosition(position);
  muzzle.getWorldQuaternion(temp.quaternion);
  direction.set(1, 0, 0).applyQuaternion(temp.quaternion).normalize();
}

function startCharge() {
  const inventory = activeInventory();
  const shotLimit = maximumShotLimit();
  if (shotLimit !== null && game.stats?.shotsFired >= shotLimit) {
    toast(`本任务最多发射 ${shotLimit} 发`, 'warning');
    checkMissionFailure();
    return;
  }
  if (game.phase !== 'playing' || !inventory || inventory.current <= 0) {
    if (game.phase === 'playing') toast('当前弹药库存不足，切换弹种继续', 'warning');
    return;
  }
  game.charge = Math.max(game.charge, 0.42);
  game.charging = true;
  game.chargeDirection = 1;
  updateChargeUI();
  ensureAudio();
}

function releaseShot() {
  if (!game.charging) return;
  const speed = 15 + game.charge * 8.5;
  game.charging = false;
  shoot(speed);
  game.charge = 0;
  updateChargeUI();
}

function shoot(speed) {
  if (game.phase !== 'playing') return;
  const now = performance.now() / 1000;
  const ammoId = activeAmmoId();
  const ammo = getAmmoTypeById(ammoId);
  const inventory = game.inventory[ammoId];
  const shotLimit = maximumShotLimit();
  if (shotLimit !== null && game.stats.shotsFired >= shotLimit) {
    toast(`已达到 ${shotLimit} 发上限`, 'warning');
    checkMissionFailure();
    return;
  }
  if (!ammo || !inventory || inventory.current <= 0 || now - game.lastShotAt < 0.22) {
    if (!inventory || inventory.current <= 0) toast('黏液罐正在补充', 'warning');
    return;
  }

  const projectile = projectilePool.acquire();
  if (!projectile) {
    toast('发射器负载过高，请稍后再试', 'warning');
    return;
  }

  game.lastShotAt = now;
  inventory.current -= 1;
  game.recoil = 1;
  game.shake = 0.22;
  game.stats.shotsFired += 1;
  if (ammoId !== 'nutrient-gel') game.stats.specialUsed += 1;
  maybeDeploySupplyCrate();
  updateAmmoUI();

  const projectileMaterial = ammoMaterials[ammoId] ?? materials.slime;
  getMuzzleState(projectile.position, projectile.velocity);
  const launchSpeed = speed * (ammo.projectile.speedMultiplier ?? 1);
  projectile.previous.copy(projectile.position);
  projectile.velocity.multiplyScalar(launchSpeed);
  projectile.radius = ammo.projectile.radius ?? 0.29;
  projectile.ammoId = ammoId;
  projectile.gravityMultiplier = ammo.projectile.gravityMultiplier ?? 1;
  projectile.bouncesRemaining = ammo.projectile.bounceCount ?? 0;
  projectile.bounces = 0;
  projectile.hitSomething = false;
  projectile.age = 0;
  projectile.impactPoint = null;
  projectile.core.material = projectileMaterial;
  projectile.tail.material = projectileMaterial;
  projectile.mesh.position.copy(projectile.position);
  projectile.mesh.visible = true;
  scene.add(projectile.mesh);
  projectiles.push(projectile);

  muzzleBurst(projectile.position, temp.a.copy(projectile.velocity).normalize(), projectileMaterial);
  playShotSound(launchSpeed);
  inputSystem?.vibrate(0.28, 70);
}

function muzzleBurst(position, direction, material = materials.slime) {
  const scaledCount = Math.max(1, Math.round(7 * runtimeGraphics.particleMultiplier));
  const count = settings?.accessibility?.reducedMotion ? Math.min(3, scaledCount) : scaledCount;
  const particleColor = material?.color ?? temp.color.setHex(colors.slime);
  const particleEmissive = material?.emissive ?? particleColor;
  for (let i = 0; i < count; i += 1) {
    const particle = particlePool.acquire();
    if (!particle) break;
    particle.mesh.geometry = dropletGeometry;
    particle.material.color.copy(particleColor);
    particle.material.emissive.copy(particleEmissive);
    particle.material.emissiveIntensity = material?.emissiveIntensity ?? 0.75;
    particle.material.opacity = 1;
    particle.mesh.scale.setScalar(THREE.MathUtils.randFloat(0.45, 1.1));
    particle.mesh.position.copy(position);
    particle.mesh.visible = true;
    particle.velocity.copy(direction).multiplyScalar(THREE.MathUtils.randFloat(2.5, 5.5));
    particle.velocity.x += THREE.MathUtils.randFloatSpread(1.4);
    particle.velocity.y += THREE.MathUtils.randFloatSpread(1.4);
    particle.velocity.z += THREE.MathUtils.randFloatSpread(1.4);
    particle.life = THREE.MathUtils.randFloat(0.3, 0.62);
    particle.age = 0;
    particle.gravity = 4.5;
    scene.add(particle.mesh);
    particles.push(particle);
  }
}

function segmentSphereHit(a, b, center, radius) {
  const segment = temp.c.copy(b).sub(a);
  const lengthSq = segment.lengthSq();
  if (lengthSq === 0) {
    temp.d.copy(a);
    return a.distanceToSquared(center) <= radius * radius;
  }
  const t = THREE.MathUtils.clamp(temp.d.copy(center).sub(a).dot(segment) / lengthSq, 0, 1);
  temp.d.copy(a).addScaledVector(segment, t);
  return temp.d.distanceToSquared(center) <= radius * radius;
}

function removeProjectile(projectile) {
  const projectileIndex = projectiles.indexOf(projectile);
  if (projectileIndex >= 0) projectiles.splice(projectileIndex, 1);
  return projectilePool.release(projectile);
}

function markProjectileHit(projectile) {
  if (projectile.hitSomething) return;
  projectile.hitSomething = true;
  game.stats.shotsHit += 1;
}

function targetIsShielded(target) {
  if (target.type !== 'animal') return false;
  return targets.some((entry) => (
    entry.type === 'hazard'
    && entry.kind === 'barrier-drone'
    && !entry.disabled
    && entry.group.position.distanceTo(target.group.position) < 4.2
  ));
}

function hitTarget(target, projectile) {
  const hitPosition = (projectile.impactPoint ?? projectile.position).clone();
  projectile.impactPoint = null;
  const center = new THREE.Vector3();
  target.group.getWorldPosition(center);
  const bullseye = hitPosition.distanceTo(center) <= target.radius * 0.42;

  if (target.type === 'animal' && targetIsShielded(target) && !(projectile.ammoId === 'bounce-bubble' && projectile.bounces > 0)) {
    removeProjectile(projectile);
    game.combo = 0;
    toast('屏障拦截：用黏附弹停机，或反弹绕到背面', 'warning');
    createImpactParticles(hitPosition, 0xc76dff, 9);
    playHazardSound();
    return;
  }

  if (projectile.ammoId === 'adhesive-bloom' && target.type === 'animal') {
    markProjectileHit(projectile);
    const charge = createBloomCharge(hitPosition, projectile, 0.42);
    removeProjectile(projectile);
    toast(charge ? '花苞已附着 · 再按 Shift / A 可立即绽放' : '花苞效果已达上限', charge ? 'success' : 'warning');
    return;
  }

  if (target.type === 'animal') {
    if (target.kind === 'bear' && !target.mouthOpen) {
      removeProjectile(projectile);
      game.combo = 0;
      game.stats.bearClosedHits += 1;
      toast('月牙熊还没张嘴，等待橙色投食环亮起', 'warning');
      createImpactParticles(hitPosition, colors.orange, 8);
      playMissSound();
      return;
    }
    markProjectileHit(projectile);
    applyAnimalFeed(target, projectile, { bullseye, hitPosition, area: false });
    removeProjectile(projectile);
    return;
  }

  if (target.type === 'hazard') {
    handleHazardHit(target, projectile, hitPosition);
    removeProjectile(projectile);
    return;
  }

  if (target.type === 'boss') {
    handleBossHit(target, projectile, hitPosition, bullseye);
    removeProjectile(projectile);
  }
}

function applyAnimalFeed(target, projectile, options = {}) {
  if (!targets.includes(target) || target.type !== 'animal') return false;
  if (target.kind === 'bear' && !target.mouthOpen && !options.area) return false;
  markProjectileHit(projectile);
  const bullseye = Boolean(options.bullseye);
  const hitPosition = options.hitPosition ?? target.group.position;
  target.feedProgress += 1;
  if (bullseye) game.stats.bullseyes += 1;

  const frogApex = target.kind === 'frog' && target.apexWindow;
  let points = target.value;
  if (bullseye) points = Math.round(points * 1.25);
  if (frogApex) {
    points += 220;
    game.stats.frogApexFeeds += 1;
  }

  if (target.feedProgress < target.feedRequired) {
    game.score += Math.round(points * 0.45);
    target.lifetime += 3;
    target.group.userData.ring.material.color.setHex(colors.orange);
    target.group.userData.ring.material.emissive?.setHex(0x4f2107);
    toast('熊猫还需要一份补给 · 1 / 2', 'warning');
    createImpactParticles(hitPosition, colors.slime, 10);
    playHitSound(Math.max(1, game.combo));
    return true;
  }

  game.combo += 1;
  game.stats.maxCombo = Math.max(game.stats.maxCombo, game.combo);
  const multiplier = 1 + Math.min(game.combo - 1, 10) * 0.15;
  points = Math.round(points * multiplier);
  game.score += points;
  game.feeds += 1;
  if (projectile.bounces > 0) game.stats.ricochetFeeds += 1;

  let inventoryChanged = false;
  const module = equippedModuleDefinition();
  if (bullseye && projectile.ammoId === 'nutrient-gel') {
    const inventory = game.inventory['nutrient-gel'];
    const refund = module?.effects?.bullseyeRefund ?? 0;
    if (inventory && refund > 0) {
      const previous = inventory.current;
      inventory.current = Math.min(inventory.capacity, inventory.current + refund);
      inventoryChanged ||= inventory.current !== previous;
    } else if (inventory?.rechargeSeconds && inventory.current < inventory.capacity) {
      const reloadProgress = getAmmoTypeById('nutrient-gel')?.perfectHit?.reloadProgress ?? 0;
      inventory.rechargeTimer += inventory.rechargeSeconds * reloadProgress;
      if (inventory.rechargeTimer >= inventory.rechargeSeconds) {
        inventory.current += 1;
        inventory.rechargeTimer -= inventory.rechargeSeconds;
        inventoryChanged = true;
      }
    }
  }
  const capacitorHits = module?.effects?.hitsPerSpecialAmmo;
  const capacitorLimit = module?.effects?.maxTriggersPerMission ?? Infinity;
  if (
    capacitorHits
    && game.combo % capacitorHits === 0
    && game.stats.comboCapacitorTriggers < capacitorLimit
  ) {
    const specialAmmoIds = game.equippedAmmo.filter((ammoId) => ammoId !== 'nutrient-gel');
    const activeSpecial = activeAmmoId() !== 'nutrient-gel' ? activeAmmoId() : null;
    const refillAmmoId = [activeSpecial, ...specialAmmoIds]
      .filter(Boolean)
      .find((ammoId, index, list) => list.indexOf(ammoId) === index && game.inventory[ammoId]?.current < game.inventory[ammoId]?.capacity);
    const special = refillAmmoId ? game.inventory[refillAmmoId] : null;
    if (special) {
      special.current += 1;
      game.stats.comboCapacitorTriggers += 1;
      inventoryChanged = true;
    }
  }
  if (inventoryChanged) updateAmmoUI();

  const apexCopy = frogApex ? ' · 顶点空接 +220' : '';
  toast(`${ANIMAL_NAMES[target.kind]} 已补给 · +${points}${apexCopy}`, 'success');
  playHitSound(game.combo);
  inputSystem?.vibrate(bullseye ? 0.48 : 0.32, 90);
  createImpactParticles(hitPosition, colors.slime, 14 + Math.min(game.combo, 8));
  pulseHitMarker(false);
  addSplat(hitPosition, colors.slime);
  removeTarget(target);
  updateHUD();
  checkMissionCompletion();
  return true;
}

function handleHazardHit(target, projectile, hitPosition) {
  if (projectile.ammoId === 'adhesive-bloom') {
    markProjectileHit(projectile);
    neutralizeHazard(target, hitPosition, '黏附停机');
    return;
  }

  if (target.kind === 'snack-thief' && projectile.ammoId === 'bounce-bubble') {
    markProjectileHit(projectile);
    neutralizeHazard(target, hitPosition, '泡胶震荡');
    return;
  }

  if (target.kind === 'cleaner-drone' && projectile.ammoId === 'nutrient-gel') {
    markProjectileHit(projectile);
    game.score = Math.max(0, game.score - 250);
    game.stability = Math.max(0, game.stability - 8);
    game.combo = 0;
    game.stats.cleanerDroneHits += 1;
    game.stats.hazardsHit += 1;
    toast('误中清洁无人机 · -250 · 稳定度 -8%', 'danger');
    playHazardSound();
    createImpactParticles(hitPosition, colors.red, 18);
    pulseHitMarker(true);
    removeTarget(target);
    updateHUD();
    checkMissionFailure();
    return;
  }

  if (target.kind === 'snack-thief') {
    game.combo = 0;
    game.stability = Math.max(0, game.stability - 5);
    toast('补给被偷食无人机吞掉 · 稳定度 -5%', 'danger');
  } else if (target.kind === 'barrier-drone') {
    toast('屏障发生器挡住了直射弹', 'warning');
  } else {
    toast('清洁机被擦过：黏附花苞才能安全停机', 'warning');
  }
  playHazardSound();
  createImpactParticles(hitPosition, target.kind === 'barrier-drone' ? 0xc76dff : colors.orange, 9);
  updateHUD();
  checkMissionFailure();
}

function neutralizeHazard(target, hitPosition = target.group.position, method = '停机') {
  if (!targets.includes(target)) return;
  target.disabled = true;
  const hazardDefinition = HAZARD_TYPES.find((entry) => entry.id === target.kind);
  const countsAsActiveThreat = hazardDefinition?.category !== 'avoid';
  if (countsAsActiveThreat) {
    game.stats.hazardsNeutralized += 1;
    game.threatProgress += 1;
  }
  game.score += 260;
  game.combo += 1;
  game.stats.maxCombo = Math.max(game.stats.maxCombo, game.combo);
  const progressCopy = countsAsActiveThreat ? '' : ' · 中立目标不计停机进度';
  toast(`${method}：${target.kind === 'cleaner-drone' ? '清洁无人机' : target.kind === 'snack-thief' ? '偷食无人机' : '屏障无人机'} · +260${progressCopy}`, 'success');
  createImpactParticles(hitPosition, 0xffcf62, 15);
  pulseHitMarker(false);
  removeTarget(target);
  updateHUD();
  checkMissionCompletion();
}

function handleBossHit(target, projectile, hitPosition, bullseye) {
  const phase = game.bossPhase;
  const preferredAmmo = phase === 0 ? 'nutrient-gel' : phase === 1 ? 'adhesive-bloom' : 'bounce-bubble';
  if (phase === 0 && !target.openWindow) {
    game.combo = 0;
    toast('投食口关闭：等待绿色窗口', 'warning');
    createImpactParticles(hitPosition, colors.red, 10);
    playMissSound();
    return;
  }
  if (phase === 2 && targetIsBossShielded() && !(projectile.ammoId === 'bounce-bubble' && projectile.bounces > 0)) {
    game.stats.bossCoreMisses += 1;
    toast('核心仍被屏障保护：先停机，或用反弹泡胶绕过', 'warning');
    createImpactParticles(hitPosition, 0xc76dff, 10);
    return;
  }

  markProjectileHit(projectile);
  let damage = 1;
  if (phase === 1 && projectile.ammoId === preferredAmmo) damage = 2;
  if (phase === 2 && projectile.ammoId === preferredAmmo) damage = projectile.bounces > 0 ? 3 : 2;
  target.health = Math.max(0, target.health - damage);
  game.bossPhaseHits += damage;
  game.score += 280 * damage + (bullseye ? 120 : 0);
  if (bullseye) game.stats.bullseyes += 1;
  game.combo += 1;
  game.stats.maxCombo = Math.max(game.stats.maxCombo, game.combo);
  target.ring.material.color.setHex(target.health > 0 ? colors.orange : colors.slime);
  toast(`${preferredAmmo === projectile.ammoId ? '有效维修' : '低效维修'} · +${280 * damage}`, 'success');
  createImpactParticles(hitPosition, preferredAmmo === projectile.ammoId ? colors.slime : colors.orange, 17);
  playHitSound(game.combo);

  if (target.health <= 0) {
    removeTarget(target);
    if (!targets.some((entry) => entry.type === 'boss')) advanceBossPhase();
  }
  updateHUD();
}

function targetIsBossShielded() {
  return targets.some((target) => target.type === 'hazard' && target.kind === 'barrier-drone' && !target.disabled);
}

function createBloomCharge(position, sourceProjectile, autoDelay = 1.15) {
  const charge = bloomChargePool.acquire();
  if (!charge) return null;
  charge.sourceProjectile.ammoId = sourceProjectile?.ammoId ?? 'adhesive-bloom';
  charge.sourceProjectile.bounces = sourceProjectile?.bounces ?? 0;
  charge.sourceProjectile.hitSomething = Boolean(sourceProjectile?.hitSomething);
  charge.age = 0;
  charge.armed = false;
  charge.autoDelay = autoDelay;
  charge.life = 10;
  charge.mesh.position.copy(position);
  charge.mesh.visible = true;
  scene.add(charge.mesh);
  bloomCharges.push(charge);
  return charge;
}

function detonateBloomCharge(charge) {
  if (!charge || !bloomCharges.includes(charge)) return;
  const position = charge.mesh.position.clone();
  const sourceProjectile = { ...charge.sourceProjectile };
  const fed = areaFeedAt(position, 2.45, sourceProjectile, { bloom: true });
  if (fed >= 2) game.stats.adhesiveMultiFeeds += 1;
  createImpactParticles(position, 0xffcf62, 22);
  addSplat(position, 0xffcf62);
  releaseBloomCharge(charge);
  tone(520, 0.18, 'triangle', 0.04);
}

function burstBounceProjectile(projectile) {
  const position = projectile.position.clone();
  areaFeedAt(position, 1.35, projectile, { bloom: false });
  createImpactParticles(position, 0x62dfff, 18);
  removeProjectile(projectile);
  tone(680, 0.15, 'sine', 0.035);
}

function areaFeedAt(position, radius, projectile, options = {}) {
  let fed = 0;
  for (const target of [...targets]) {
    if (target.group.position.distanceTo(position) > radius + target.radius) continue;
    if (target.type === 'animal') {
      if (targetIsShielded(target) && !(projectile.ammoId === 'bounce-bubble' && projectile.bounces > 0)) continue;
      if (applyAnimalFeed(target, projectile, { hitPosition: target.group.position.clone(), area: true })) fed += 1;
    } else if (target.type === 'hazard' && (options.bloom || target.kind === 'snack-thief')) {
      markProjectileHit(projectile);
      neutralizeHazard(target, target.group.position.clone(), options.bloom ? '花苞过载' : '泡胶震荡');
    } else if (target.type === 'boss' && game.bossPhase === 1 && options.bloom) {
      handleBossHit(target, projectile, target.group.position.clone(), false);
    }
  }
  return fed;
}

function triggerSecondaryAction() {
  if (game.phase !== 'playing') return false;
  const flying = [...projectiles].reverse().find((entry) => entry.ammoId === 'adhesive-bloom' || entry.ammoId === 'bounce-bubble');
  if (flying?.ammoId === 'bounce-bubble') {
    burstBounceProjectile(flying);
    return true;
  }
  if (flying?.ammoId === 'adhesive-bloom') {
    const charge = createBloomCharge(flying.position, flying, 0);
    if (!charge) return false;
    removeProjectile(flying);
    detonateBloomCharge(charge);
    return true;
  }
  const charge = bloomCharges.find((entry) => entry.armed) ?? bloomCharges[0];
  if (charge) {
    detonateBloomCharge(charge);
    return true;
  }
  return false;
}

function createImpactParticles(position, color, count) {
  const scaledCount = Math.max(1, Math.round(count * runtimeGraphics.particleMultiplier));
  const actualCount = settings?.accessibility?.reducedMotion ? Math.min(6, scaledCount) : scaledCount;
  const useLowDetail = runtimeGraphics.particleQuality === 'low'
    || camera.position.distanceToSquared(position) >= DISTANT_PARTICLE_LOD_DISTANCE_SQ;
  const particleGeometry = useLowDetail ? dropletLowGeometry : dropletGeometry;
  for (let i = 0; i < actualCount; i += 1) {
    const particle = particlePool.acquire();
    if (!particle) break;
    particle.mesh.geometry = particleGeometry;
    particle.material.color.setHex(color);
    particle.material.emissive.setHex(color);
    particle.material.emissiveIntensity = 0.75;
    particle.material.opacity = 1;
    particle.mesh.scale.setScalar(THREE.MathUtils.randFloat(0.5, 1.55));
    particle.mesh.position.copy(position);
    particle.mesh.visible = true;
    particle.velocity.set(
      THREE.MathUtils.randFloat(-2.5, 1.5),
      THREE.MathUtils.randFloat(1.2, 5.8),
      THREE.MathUtils.randFloatSpread(5.2),
    );
    particle.life = THREE.MathUtils.randFloat(0.55, 1.2);
    particle.age = 0;
    particle.gravity = 8;
    scene.add(particle.mesh);
    particles.push(particle);
  }
}

function addSplat(position, color = colors.slime) {
  const splatLimit = Math.min(runtimeGraphics.splatLimit, splatPool.capacity);
  if (splatLimit <= 0) return null;
  while (splats.length >= splatLimit) releaseSplat(splats[0]);
  const splat = splatPool.acquire();
  if (!splat) return null;
  const radius = THREE.MathUtils.randFloat(0.34, 0.7);
  splat.material.color.setHex(color);
  splat.material.opacity = 0.66;
  splat.mesh.position.copy(position);
  splat.mesh.position.y = 0.025;
  splat.mesh.rotation.x = -Math.PI / 2;
  splat.mesh.rotation.z = Math.random() * Math.PI;
  splat.mesh.scale.set(radius, radius * THREE.MathUtils.randFloat(0.55, 1.15), 1);
  splat.mesh.visible = true;
  splat.age = 0;
  splat.life = 8;
  scene.add(splat.mesh);
  splats.push(splat);
  return splat;
}

function pulseHitMarker(hazard) {
  dom.hitMarker.classList.remove('is-active', 'is-hazard');
  void dom.hitMarker.offsetWidth;
  dom.hitMarker.classList.add('is-active');
  if (hazard) dom.hitMarker.classList.add('is-hazard');
  window.setTimeout(() => dom.hitMarker.classList.remove('is-active', 'is-hazard'), 280);
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const projectile = projectiles[i];
    if (!projectile) continue;
    projectile.age += dt;
    projectile.previous.copy(projectile.position);
    projectile.velocity.y -= GRAVITY * projectile.gravityMultiplier * dt;
    if (game.mission?.missionType === 'boss' && game.bossPhase >= 1) {
      projectile.velocity.z += Math.sin(game.elapsed * 1.7) * (game.bossPhase === 2 ? 2.1 : 1.15) * dt;
    }
    projectile.position.addScaledVector(projectile.velocity, dt);
    projectile.mesh.position.copy(projectile.position);
    projectile.mesh.rotation.z -= dt * 5;

    const velocityLength = projectile.velocity.length();
    if (velocityLength > 0.01) {
      temp.a.copy(projectile.velocity).normalize();
      projectile.mesh.quaternion.setFromUnitVectors(temp.b.set(1, 0, 0), temp.a);
    }

    const thief = targets.find((target) => (
      target.type === 'hazard'
      && target.kind === 'snack-thief'
      && !target.disabled
      && target.interceptCooldown <= 0
      && target.group.position.distanceTo(projectile.position) < 1.45
    ));
    if (thief && projectile.ammoId === 'nutrient-gel') {
      thief.interceptCooldown = 3.2;
      temp.d.copy(projectile.position);
      removeProjectile(projectile);
      game.combo = 0;
      game.stability = Math.max(0, game.stability - 4);
      toast('偷食无人机拦截了飞行补给 · 稳定度 -4%', 'danger');
      createImpactParticles(temp.d, 0xff934f, 12);
      playHazardSound();
      checkMissionFailure();
      continue;
    }

    let collided = false;
    for (const target of [...targets]) {
      target.group.getWorldPosition(temp.a);
      if (segmentSphereHit(projectile.previous, projectile.position, temp.a, target.radius + projectile.radius)) {
        projectile.impactPoint = temp.d.clone();
        hitTarget(target, projectile);
        collided = true;
        break;
      }
    }
    if (collided) continue;

    const hitGround = projectile.position.y <= 0.08;
    const hitSideWall = Math.abs(projectile.position.z) >= 9.7;
    const hitBackWall = projectile.position.x >= 25.15;
    if (projectile.ammoId === 'bounce-bubble' && projectile.bouncesRemaining > 0 && (hitGround || hitSideWall || hitBackWall)) {
      const restitution = getAmmoTypeById('bounce-bubble')?.projectile?.restitution ?? 0.82;
      if (hitGround) {
        projectile.position.y = 0.12;
        projectile.velocity.y = Math.abs(projectile.velocity.y) * restitution;
      }
      if (hitSideWall) {
        projectile.position.z = Math.sign(projectile.position.z) * 9.55;
        projectile.velocity.z *= -restitution;
      }
      if (hitBackWall) {
        projectile.position.x = 25;
        projectile.velocity.x *= -restitution;
      }
      projectile.bouncesRemaining -= 1;
      projectile.bounces += 1;
      createImpactParticles(projectile.position, 0x62dfff, 7);
      tone(610 + projectile.bounces * 80, 0.08, 'sine', 0.025);
      continue;
    }

    if (hitGround || hitSideWall || hitBackWall || projectile.position.x < -5 || projectile.age > 6) {
      if (projectile.ammoId === 'adhesive-bloom' && (hitGround || hitSideWall || hitBackWall)) {
        const position = projectile.position.clone();
        position.y = Math.max(0.08, position.y);
        const charge = createBloomCharge(position, projectile);
        removeProjectile(projectile);
        toast(charge ? '花苞已预埋 · 将自动绽放' : '花苞效果已达上限', charge ? 'success' : 'warning');
        continue;
      }
      if (hitGround) {
        projectile.position.y = 0.025;
        addSplat(projectile.position, projectile.ammoId === 'bounce-bubble' ? 0x62dfff : colors.slime);
        createImpactParticles(projectile.position, projectile.ammoId === 'bounce-bubble' ? 0x62dfff : colors.slimeDark, 5);
      }
      if (game.mission?.missionType === 'boss' && game.bossPhase === 2) game.stats.bossCoreMisses += 1;
      removeProjectile(projectile);
      game.combo = 0;
      playMissSound();
      updateHUD();
    }
  }
}

function updateTargets(dt) {
  for (const target of [...targets]) {
    target.age += dt;
    if (target.type === 'animal') updateAnimalTarget(target, dt);
    else if (target.type === 'hazard') updateHazardTarget(target, dt);
    else if (target.type === 'boss') updateBossTarget(target, dt);
  }

  for (const charge of [...bloomCharges]) {
    if (!bloomCharges.includes(charge)) continue;
    charge.age += dt;
    charge.mesh.rotation.y += dt * 1.7;
    charge.mesh.scale.setScalar(1 + Math.sin(charge.age * 8) * 0.06);
    charge.armed = charge.age >= 0.28;
    if (charge.age >= charge.autoDelay && charge.autoDelay >= 0) detonateBloomCharge(charge);
    else if (charge.age >= charge.life) detonateBloomCharge(charge);
  }
}

function updateAnimalTarget(target) {
  const reduced = settings?.accessibility?.reducedMotion ? 0.35 : 1;
  const time = target.age * target.speed + target.phase;
  target.group.position.copy(target.base);
  target.group.rotation.x = Math.sin(target.age * 1.5 + target.phase) * 0.04 * reduced;

  if (target.kind === 'panda') {
    target.group.position.z += Math.sin(time * 0.65) * target.amplitude;
    target.group.position.y += Math.sin(time * 1.4) * 0.08 * reduced;
  } else if (target.kind === 'rabbit') {
    const cycle = target.age % 3.4;
    const dash = cycle < 2.35 ? 0 : THREE.MathUtils.smoothstep(cycle, 2.35, 3.2);
    const lanePosition = THREE.MathUtils.lerp(-target.amplitude, target.amplitude, dash);
    const direction = Math.floor(target.age / 3.4) % 2 === 0 ? lanePosition : -lanePosition;
    target.group.position.z += direction;
    target.group.position.y += (cycle > 2.25 ? Math.sin(((cycle - 2.25) / 1.15) * Math.PI) * 0.85 : 0) * reduced;
  } else if (target.kind === 'frog') {
    const jump = Math.max(0, Math.sin(time * 1.5));
    target.group.position.z += Math.sin(time * 0.65) * target.amplitude;
    target.group.position.y += jump * 2.05 * reduced;
    target.apexWindow = jump > 0.91;
    target.group.userData.ring.material.color.setHex(target.apexWindow ? colors.cyan : colors.brass);
  } else {
    target.group.position.z += Math.sin(time * 0.72) * target.amplitude * 0.75;
    target.group.position.y += Math.sin(time * 1.1) * 0.12 * reduced;
    target.mouthOpen = Math.sin(time * 1.75) > 0.34;
    const mouth = target.group.userData.mouthIndicator;
    if (mouth) {
      mouth.scale.setScalar(target.mouthOpen ? 1.28 : 0.72);
      mouth.material.color.setHex(target.mouthOpen ? colors.slime : colors.orange);
      mouth.material.emissive.setHex(target.mouthOpen ? 0x0c512d : 0x56210a);
    }
  }

  const remaining = THREE.MathUtils.clamp(1 - target.age / target.lifetime, 0, 1);
  const requestRing = target.group.userData.requestRing;
  if (requestRing) {
    requestRing.material.color.setHex(remaining < 0.25 ? colors.red : targetIsShielded(target) ? 0xc76dff : colors.slime);
    requestRing.material.opacity = 0.45 + remaining * 0.5;
    requestRing.scale.setScalar(0.88 + remaining * 0.18);
  }

  if (target.age >= target.lifetime) handleRequestTimeout(target);
}

function updateHazardTarget(target, dt) {
  target.interceptCooldown = Math.max(0, target.interceptCooldown - dt);
  target.group.position.copy(target.base);
  if (target.kind === 'barrier-drone') {
    const animal = targets.find((entry) => entry.type === 'animal');
    if (animal) {
      target.group.position.lerpVectors(target.base, animal.group.position, 0.64);
      target.group.position.x += 0.4;
      target.group.position.y += 0.45;
    }
    target.group.rotation.x = target.age * 0.45;
  } else if (target.kind === 'snack-thief') {
    const nutrient = projectiles.find((entry) => entry.ammoId === 'nutrient-gel');
    if (nutrient && target.interceptCooldown <= 0) {
      target.group.position.lerp(nutrient.position, 1 - Math.exp(-dt * 1.8));
      target.base.lerp(target.group.position, 0.08);
    } else {
      target.group.position.z += Math.sin(target.age * target.speed + target.phase) * target.amplitude;
    }
    target.group.rotation.z = -target.age * 1.2;
  } else {
    target.group.position.z += Math.sin(target.age * target.speed + target.phase) * target.amplitude;
    target.group.position.y += Math.sin(target.age * 2.4 + target.phase) * 0.22;
    target.group.rotation.x = target.age * 1.1;
  }

  if (target.age >= target.lifetime) removeTarget(target);
}

function updateBossTarget(target) {
  const time = target.age + target.phase;
  target.group.position.copy(target.base);
  if (target.kind === 'feed-port') {
    target.group.position.y += Math.sin(time * 1.8) * 1.15;
    target.group.position.z += Math.cos(time * 1.8) * 1.65;
    target.openWindow = Math.sin(time * 2.6) > -0.05;
    target.ring.material.color.setHex(target.openWindow ? colors.slime : colors.red);
    target.group.rotation.x = time * 0.8;
  } else if (target.kind === 'storage-tank') {
    target.group.position.y += Math.sin(time * 1.4) * 0.35;
    target.group.rotation.x = Math.sin(time) * 0.15;
  } else {
    target.group.position.y += Math.sin(time * 1.5) * 1.35;
    target.group.position.z += Math.sin(time * 0.95) * 3.2;
    target.group.rotation.x += 0.02;
    target.group.rotation.z += 0.018;
  }
}

function handleRequestTimeout(target) {
  if (!targets.includes(target)) return;
  const penalty = target.kind === 'panda' ? 14 : target.kind === 'bear' ? 13 : 10;
  game.stability = Math.max(0, game.stability - penalty);
  game.combo = 0;
  game.stats.requestsMissed += 1;
  toast(`${ANIMAL_NAMES[target.kind]} 请求超时 · 稳定度 -${penalty}%`, 'danger');
  createImpactParticles(target.group.position, colors.red, 11);
  removeTarget(target);
  updateHUD();
  checkMissionFailure();
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.age += dt;
    particle.velocity.y -= particle.gravity * dt;
    particle.mesh.position.addScaledVector(particle.velocity, dt);
    particle.mesh.rotation.x += dt * 5;
    const remaining = 1 - particle.age / particle.life;
    particle.mesh.scale.multiplyScalar(Math.max(0.96, 1 - dt * 1.8));
    if (particle.mesh.material?.transparent) particle.mesh.material.opacity = remaining;
    if (particle.age >= particle.life) {
      releaseParticleAt(i);
    }
  }

  for (let i = splats.length - 1; i >= 0; i -= 1) {
    const splat = splats[i];
    splat.age += dt;
    if (splat.age > splat.life - 2) splat.mesh.material.opacity = Math.max(0, (splat.life - splat.age) / 2 * 0.66);
    if (splat.age >= splat.life) {
      releaseSplatAt(i);
    }
  }
}

function updateTrajectory() {
  const start = new THREE.Vector3();
  const direction = new THREE.Vector3();
  getMuzzleState(start, direction);
  const velocity = direction.multiplyScalar(currentShotPower());
  const ammo = getAmmoTypeById(activeAmmoId());
  const gravity = GRAVITY * (ammo?.projectile?.gravityMultiplier ?? 1);
  const point = new THREE.Vector3();
  const trajectoryMode = settings?.gameplay?.trajectoryMode ?? (settings?.gameplay?.trajectoryLine === false ? 'off' : 'full');
  const maximumPoints = trajectoryMode === 'short' ? 22 : 42;
  let used = maximumPoints;
  let crosshairPoint = null;

  for (let i = 0; i < maximumPoints; i += 1) {
    const t = i * 0.055;
    point.copy(start).addScaledVector(velocity, t);
    point.y -= 0.5 * gravity * t * t;
    trajectoryPoints[i * 3] = point.x;
    trajectoryPoints[i * 3 + 1] = point.y;
    trajectoryPoints[i * 3 + 2] = point.z;
    crosshairPoint = point.clone();
    if (point.y <= 0.05 || point.x >= 25) {
      used = i + 1;
      for (let j = used; j < 42; j += 1) {
        trajectoryPoints[j * 3] = point.x;
        trajectoryPoints[j * 3 + 1] = point.y;
        trajectoryPoints[j * 3 + 2] = point.z;
      }
      break;
    }
  }

  trajectoryGeometry.attributes.position.needsUpdate = true;
  trajectoryGeometry.setDrawRange(0, used);
  trajectory.computeLineDistances();
  trajectory.visible = game.phase === 'playing' && trajectoryMode !== 'off';
  updateCrosshair(applyAimAssist(crosshairPoint));
}

function applyAimAssist(worldPoint) {
  const strength = settings?.gameplay?.aimAssist ?? 0;
  if (!worldPoint || strength <= 0 || targets.length === 0) return worldPoint;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const target of targets) {
    if (target.type === 'hazard' && target.kind === 'cleaner-drone') continue;
    const distance = target.group.position.distanceTo(worldPoint);
    if (distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }
  if (!nearest || nearestDistance > 2.2 + strength * 2.5) return worldPoint;
  return worldPoint.clone().lerp(nearest.group.position, strength * 0.35);
}

function updateCrosshair(worldPoint) {
  if (!worldPoint || game.phase !== 'playing') {
    dom.crosshair.hidden = true;
    return;
  }
  const projected = worldPoint.clone().project(camera);
  const rect = dom.canvas.getBoundingClientRect();
  const x = (projected.x * 0.5 + 0.5) * rect.width;
  const y = (-projected.y * 0.5 + 0.5) * rect.height;
  dom.crosshair.hidden = projected.z < -1 || projected.z > 1;
  dom.crosshair.style.left = `${x}px`;
  dom.crosshair.style.top = `${y}px`;
  dom.crosshair.style.transform = 'translate(-50%, -50%)';
  dom.hitMarker.style.left = `${x}px`;
  dom.hitMarker.style.top = `${y}px`;
}

function updateGame(dt) {
  if (game.phase !== 'playing') return;
  game.elapsed += dt;
  game.time = Math.max(0, game.time - dt);
  const encounters = game.mission?.encounters ?? [];
  const encounterIndex = Math.max(0, encounters.findIndex((entry) => (
    game.elapsed >= entry.startAt && game.elapsed < entry.startAt + entry.duration
  )));
  const nextWave = encounters.length > 0
    ? Math.min(3, (encounterIndex < 0 ? encounters.length - 1 : encounterIndex) + 1)
    : Math.min(3, Math.floor((game.elapsed / Math.max(1, game.mission?.timeLimitSeconds ?? CLASSIC_DURATION)) * 3) + 1);
  if (nextWave !== game.wave) {
    game.wave = nextWave;
    if (game.mission?.missionType !== 'boss') {
      toast(nextWave === 2 ? '第二阶段：新的动物行为与机关上线' : '最终阶段：完成主目标并守住稳定度', 'warning');
    }
    updateMission();
  }

  if (game.charging) {
    const module = MODULES.find((entry) => entry.id === game.equippedModule);
    const rate = 0.85 * (module?.effects?.chargeRateMultiplier ?? 1);
    game.charge += dt * rate * game.chargeDirection;
    if (game.charge >= 1) {
      game.charge = 1;
      game.chargeDirection = -1;
    } else if (game.charge <= 0.18) {
      game.charge = 0.18;
      game.chargeDirection = 1;
    }
    updateChargeUI();
  }

  updateInventoryRecharge(dt);

  game.spawnTimer -= dt;
  if (game.mission?.missionType === 'boss') {
    if (game.bossPhase === 2 && game.spawnTimer <= 0 && targets.filter((entry) => entry.type === 'hazard').length < 2) {
      const hasBarrier = targets.some((entry) => entry.type === 'hazard' && entry.kind === 'barrier-drone');
      spawnHazard(hasBarrier ? 'snack-thief' : 'barrier-drone');
      game.spawnTimer = THREE.MathUtils.randFloat(4.2, 6.5);
    }
  } else {
    const encounter = currentEncounter();
    const maxTargets = Math.min(MAX_ACTIVE_TARGETS, encounter?.maxConcurrent ?? (2 + game.wave));
    if (game.spawnTimer <= 0 && targets.length < maxTargets) {
      spawnTarget();
      const baseInterval = game.mode === 'classic' ? 1.35 : Math.max(1.15, 2.2 - game.wave * 0.28);
      game.spawnTimer = baseInterval * THREE.MathUtils.randFloat(0.82, 1.18);
    }
  }

  updateTargets(dt);
  updateProjectiles(dt);
  updateParticles(dt);
  updateHUD();

  checkMissionCompletion();
  checkMissionFailure();
  flushPendingOutcome();
}

function updateInventoryRecharge(dt) {
  const rechargeDisabled = Boolean(game.mission?.ammoRules?.rechargeDisabled);
  let inventoryChanged = false;
  for (const [ammoId, inventory] of Object.entries(game.inventory)) {
    if (rechargeDisabled || inventory.current >= inventory.capacity || !inventory.rechargeSeconds) {
      inventory.rechargeTimer = 0;
      continue;
    }
    inventory.rechargeTimer += dt;
    if (inventory.rechargeTimer >= inventory.rechargeSeconds) {
      inventory.current += 1;
      inventory.rechargeTimer = 0;
      inventoryChanged = true;
    }
  }
  if (inventoryChanged) updateAmmoUI();
}

function primaryTargetCounts() {
  const primary = game.mission?.objectives?.primary ?? {};
  return {
    feeds: primary.target ?? primary.feedTarget ?? 0,
    hazards: primary.neutralizeTarget ?? 0,
    phases: primary.phases ?? 0,
  };
}

function requestMissionFinish(completed, reason) {
  if (game.phase !== 'playing') return false;
  const nextOutcome = { completed: Boolean(completed), reason };
  if (!game.pendingOutcome || (!nextOutcome.completed && game.pendingOutcome.completed)) {
    game.pendingOutcome = nextOutcome;
  }
  return true;
}

function flushPendingOutcome() {
  if (!game.pendingOutcome || game.phase !== 'playing') return false;
  const outcome = game.pendingOutcome;
  game.pendingOutcome = null;
  finishMission(outcome.completed, outcome.reason);
  return true;
}

function checkMissionCompletion() {
  if (game.phase !== 'playing') return false;
  if (game.mode === 'classic') return false;
  const target = primaryTargetCounts();
  let completed = false;
  if (game.mission?.missionType === 'boss') completed = game.bossPhase >= target.phases;
  else if (game.mission?.missionType === 'threat') completed = game.feeds >= target.feeds && game.threatProgress >= target.hazards;
  else completed = game.feeds >= target.feeds;
  if (completed) requestMissionFinish(true, '主要照护目标已经完成');
  return completed;
}

function checkMissionFailure() {
  if (game.phase !== 'playing') return false;
  if (game.stability <= 0) {
    requestMissionFinish(false, '园区稳定度归零');
    return true;
  }
  if (game.time <= 0) {
    if (game.mode === 'classic') requestMissionFinish(true, '经典轮班计时结束');
    else requestMissionFinish(false, '任务时间耗尽');
    return true;
  }
  const shotLimit = maximumShotLimit();
  if (
    shotLimit !== null
    && game.stats.shotsFired >= shotLimit
    && projectiles.length === 0
    && bloomCharges.length === 0
    && game.feeds < primaryTargetCounts().feeds
  ) {
    requestMissionFinish(false, `已达到 ${shotLimit} 发上限`);
    return true;
  }
  if (game.mission?.ammoRules?.rechargeDisabled) {
    const remaining = Object.values(game.inventory).reduce((sum, inventory) => sum + inventory.current, 0);
    if (remaining <= 0 && projectiles.length === 0 && bloomCharges.length === 0 && game.feeds < primaryTargetCounts().feeds) {
      requestMissionFinish(false, '现场库存已经耗尽');
      return true;
    }
  }
  return false;
}

function setupBossPhase(phaseIndex) {
  clearActiveOrdnance();
  cancelCharge();
  for (const target of [...targets]) removeTarget(target);
  game.bossPhase = phaseIndex;
  game.bossPhaseHits = 0;
  if (!bossMachine) bossMachine = createBossMachine();
  else if (!bossMachine.parent) scene.add(bossMachine);
  const center = new THREE.Vector3(18.4, 3.4, 0);
  if (phaseIndex === 0) {
    game.bossPhaseTarget = 6;
    const target = createBossComponent('feed-port', 6, center);
    if (target) targets.push(target);
    toast('Boss 阶段 1：旋转投食口 · 绿色窗口时命中', 'warning');
  } else if (phaseIndex === 1) {
    game.bossPhaseTarget = 8;
    const leftTank = createBossComponent('storage-tank', 4, center.clone().add(new THREE.Vector3(0.2, 0.2, -2.2)), 0);
    const rightTank = createBossComponent('storage-tank', 4, center.clone().add(new THREE.Vector3(0.2, 0.2, 2.2)), 1);
    if (leftTank) targets.push(leftTank);
    if (rightTank) targets.push(rightTank);
    refillSpecialAmmo('adhesive-bloom');
    toast('Boss 阶段 2：双侧储粮罐 · 黏附花苞效率翻倍', 'warning');
  } else if (phaseIndex === 2) {
    game.bossPhaseTarget = 10;
    const target = createBossComponent('mobile-core', 10, center);
    if (target) targets.push(target);
    refillSpecialAmmo('bounce-bubble');
    spawnHazard('barrier-drone');
    game.spawnTimer = 4.8;
    toast('Boss 阶段 3：移动核心 · 绕过屏障与偷食无人机', 'danger');
  } else {
    game.bossPhase = 3;
    game.score += 1200;
    requestMissionFinish(true, '机械熊「桶桶」补给核心恢复正常');
  }
  game.shake = 0.55;
  updateMission();
  updateHUD();
}

function advanceBossPhase() {
  if (game.phase !== 'playing') return;
  game.score += 500;
  setupBossPhase(game.bossPhase + 1);
}

function refillSpecialAmmo(ammoId) {
  const inventory = game.inventory[ammoId];
  if (inventory) inventory.current = inventory.capacity;
  updateAmmoUI();
}

function updateAnimation(dt) {
  game.recoil = THREE.MathUtils.damp(game.recoil, 0, 13, dt);
  game.shake = THREE.MathUtils.damp(game.shake, 0, 10, dt);
  updateAimRigs();
  updateCannonModelFeedback();

  for (const prop of animatedProps) {
    if (prop.type === 'fan') prop.object.rotation.x += dt * 1.45;
  }

  const desiredPosition = temp.a.set(-6.2, 5.4, 11.8 + game.yaw * 2.3);
  const shakeScale = (settings?.gameplay?.cameraShake ?? 1) * (settings?.accessibility?.reducedMotion ? 0.2 : 1);
  if (game.shake * shakeScale > 0.002) {
    desiredPosition.x += THREE.MathUtils.randFloatSpread(game.shake * shakeScale);
    desiredPosition.y += THREE.MathUtils.randFloatSpread(game.shake * shakeScale);
    desiredPosition.z += THREE.MathUtils.randFloatSpread(game.shake * shakeScale);
  }
  camera.position.lerp(desiredPosition, 1 - Math.exp(-dt * 3.2));
  temp.b.set(10.2, 2.45 + game.pitch * 0.7, -game.yaw * 5.8);
  camera.lookAt(temp.b);
  updateTrajectory();
}

function updateHUD() {
  dom.score.textContent = Math.round(game.score).toLocaleString('zh-CN');
  dom.combo.textContent = game.combo > 1 ? `×${game.combo}` : '×1';
  const totalSeconds = Math.ceil(game.time);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  dom.time.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  dom.wave.textContent = game.mission?.missionType === 'boss' ? `${Math.min(3, game.bossPhase + 1)} / 3` : `${game.wave} / 3`;
  dom.stabilityValue.textContent = `${Math.round(game.stability)}%`;
  dom.stabilityMeter.setAttribute('aria-valuenow', String(Math.round(game.stability)));
  const stabilityFill = dom.stabilityMeter.querySelector('span');
  if (stabilityFill) stabilityFill.style.width = `${game.stability}%`;
  const stabilityCluster = dom.stabilityMeter.closest('.hud-stat--stability');
  stabilityCluster?.classList.toggle('is-warning', game.stability <= 50 && game.stability > 25);
  stabilityCluster?.classList.toggle('is-critical', game.stability <= 25);

  const progress = getMissionProgress();
  dom.missionProgressValue.textContent = progress.label;
  dom.missionProgressMeter.setAttribute('aria-valuemax', String(progress.max));
  dom.missionProgressMeter.setAttribute('aria-valuenow', String(progress.value));
  const progressFill = dom.missionProgressMeter.querySelector('span');
  if (progressFill) progressFill.style.width = `${progress.max > 0 ? Math.min(100, progress.value / progress.max * 100) : 0}%`;
}

function getMissionProgress() {
  const target = primaryTargetCounts();
  if (game.mode === 'classic') return { value: game.feeds, max: 18, label: `${game.feeds} 次补给` };
  if (game.mission?.missionType === 'boss') {
    return {
      value: game.bossPhaseHits,
      max: Math.max(1, game.bossPhaseTarget),
      label: `阶段 ${Math.min(3, game.bossPhase + 1)} / 3 · ${Math.min(game.bossPhaseHits, game.bossPhaseTarget)} / ${game.bossPhaseTarget}`,
    };
  }
  if (game.mission?.missionType === 'threat') {
    return {
      value: game.feeds + game.threatProgress,
      max: target.feeds + target.hazards,
      label: `补给 ${game.feeds}/${target.feeds} · 停机 ${game.threatProgress}/${target.hazards}`,
    };
  }
  if (game.mission?.missionType === 'limited-ammo') {
    const shotLimit = maximumShotLimit();
    const shotCopy = shotLimit === null ? `${game.stats.shotsFired} 发` : `${game.stats.shotsFired}/${shotLimit} 发`;
    return {
      value: game.feeds,
      max: Math.max(1, target.feeds),
      label: `${game.feeds}/${target.feeds} · ${shotCopy} · 补给箱 ${game.supplyCratesRemaining}`,
    };
  }
  return { value: game.feeds, max: Math.max(1, target.feeds), label: `${game.feeds} / ${target.feeds}` };
}

function updateAmmoUI() {
  if (!dom.ammo || !game.inventory) return;
  const ammoId = activeAmmoId();
  const ammo = getAmmoTypeById(ammoId);
  const inventory = game.inventory[ammoId] ?? { current: 0, capacity: 0 };
  dom.ammo.innerHTML = '';
  for (let i = 0; i < inventory.capacity; i += 1) {
    const pip = document.createElement('span');
    pip.className = i < inventory.current ? 'ammo-pip is-loaded' : 'ammo-pip is-spent';
    pip.setAttribute('aria-hidden', 'true');
    dom.ammo.appendChild(pip);
  }
  dom.ammo.setAttribute('aria-label', `${ammo?.name ?? '弹药'} ${inventory.current}/${inventory.capacity}`);
  dom.currentAmmoName.textContent = ammo?.name ?? '营养凝胶弹';
  dom.currentAmmoIcon.className = `ammo-orb ammo-orb--${AMMO_UI_CLASS[ammoId] ?? 'nutrition'}`;
  dom.specialAmmoBloom.textContent = String(game.inventory['adhesive-bloom']?.current ?? 0);
  dom.specialAmmoBounce.textContent = String(game.inventory['bounce-bubble']?.current ?? 0);
  const supportsAbility = ammo?.secondaryAction || bloomCharges.length > 0 || projectiles.some((entry) => entry.ammoId !== 'nutrient-gel');
  dom.secondaryActionHint.hidden = !supportsAbility;
}

function updateChargeUI() {
  const percent = Math.round(game.charge * 100);
  const fill = dom.charge.querySelector('.charge-meter__fill');
  if (fill) fill.style.width = `${percent}%`;
  dom.charge.classList.toggle('is-charging', game.charging);
  dom.charge.classList.toggle('is-overcharged', game.charge > 0.92);
  dom.fireButton.classList.toggle('is-charging', game.charging);
  dom.charge.setAttribute('role', 'progressbar');
  dom.charge.setAttribute('aria-valuemin', '0');
  dom.charge.setAttribute('aria-valuemax', '100');
  dom.charge.setAttribute('aria-valuenow', percent);
}

function updateMission() {
  if (!game.mission) {
    dom.mission.textContent = '准备开始饲养轮班';
    return;
  }
  if (game.mission.missionType === 'boss') {
    const messages = [
      '桶桶阶段 1：绿色投食口开启时命中',
      '桶桶阶段 2：用黏附花苞修复双侧储粮罐',
      '桶桶阶段 3：停用屏障并反弹命中移动核心',
    ];
    dom.mission.textContent = messages[Math.min(2, game.bossPhase)];
    return;
  }
  const target = primaryTargetCounts();
  const suffix = game.mission.missionType === 'threat'
    ? `，并停机 ${target.hazards} 台主动危险`
    : game.mission.missionType === 'limited-ammo'
      ? `，库存不恢复，最多 ${maximumShotLimit() ?? '有限'} 发，应急补给箱 ${game.supplyCratesRemaining} 个`
      : '';
  dom.mission.textContent = `${game.mission.name}：完成 ${target.feeds} 次有效补给${suffix}`;
}

function setVisible(element, visible) {
  if (!element) return;
  element.hidden = !visible;
}

function setGamePhase(phase) {
  if (phase !== 'playing') cancelCharge();
  game.phase = phase;
  setVisible(dom.loading, phase === 'loading');
  setVisible(dom.start, phase === 'main-menu');
  setVisible(dom.missionSelect, phase === 'mission-select');
  setVisible(dom.loadout, phase === 'loadout');
  setVisible(dom.settings, phase === 'settings');
  setVisible(dom.hud, phase === 'playing' || phase === 'paused');
  setVisible(dom.pauseScreen, phase === 'paused');
  setVisible(dom.gameOver, phase === 'results');
  setVisible(dom.fireButton, phase === 'playing');
  if (phase !== 'playing') {
    dom.crosshair.hidden = true;
    trajectory.visible = false;
  }
  if (['main-menu', 'mission-select', 'loadout', 'settings', 'paused', 'results'].includes(phase)) {
    window.setTimeout(() => focusFirstVisibleControl(), 0);
  }
}

function focusFirstVisibleControl() {
  const screen = {
    'main-menu': dom.start,
    'mission-select': dom.missionSelect,
    loadout: dom.loadout,
    settings: dom.settings,
    paused: dom.pauseScreen,
    results: dom.gameOver,
  }[game.phase];
  const selected = screen?.querySelector('.is-selected:not(:disabled), .is-active:not(:disabled), button:not(:disabled), select:not(:disabled), input:not(:disabled)');
  selected?.focus({ preventScroll: true });
}

function showMainMenu() {
  clearRoundObjects();
  setGamePhase('main-menu');
  renderMainMenuProgress();
}

function renderMainMenuProgress() {
  const completed = saveData.campaign.completedMissionIds.length;
  const percent = Math.round(completed / MISSIONS.length * 100);
  const sectorComplete = saveData.campaign.sectorCompleted || completed >= MISSIONS.length;
  const lastMission = getMissionById(saveData.campaign.lastMissionId) ?? MISSIONS.find((mission) => isMissionUnlocked(mission.id, saveData)) ?? MISSIONS[0];
  const missionProgress = lastMission ? saveData.missionProgress[lastMission.id] : null;
  const buttonLabel = dom.mainContinueButton.querySelectorAll('span')[1];
  const buttonSmall = dom.mainContinueButton.querySelector('small');
  if (buttonLabel) buttonLabel.textContent = sectorComplete ? '查看已完成任务' : completed > 0 ? '继续战役' : '开始战役';
  if (buttonSmall) {
    buttonSmall.textContent = `${sectorComplete ? 'AREA COMPLETE' : `MISSION ${String(lastMission.order).padStart(2, '0')}`} // ${percent}%`;
  }
  const briefTitle = dom.start.querySelector('.briefing-card h2');
  const briefCopy = dom.start.querySelector('.briefing-copy');
  if (briefTitle) briefTitle.textContent = sectorComplete ? '区域已恢复' : lastMission.name;
  if (briefCopy) {
    briefCopy.textContent = sectorComplete
      ? '翠竹育幼园已经恢复全部自动补给网络。你可以重玩任务，继续挑战更高评价与照护徽章。'
      : lastMission.briefing;
  }
  const briefIndex = dom.start.querySelector('.briefing-card .panel__index');
  const briefEyebrow = dom.start.querySelector('.briefing-card .eyebrow');
  const briefStatus = dom.start.querySelector('.briefing-card .status-chip');
  if (briefIndex) briefIndex.textContent = sectorComplete ? '✓' : String(lastMission.order).padStart(2, '0');
  if (briefEyebrow) briefEyebrow.textContent = sectorComplete ? 'AREA RESTORED' : 'NEXT DIRECTIVE';
  if (briefStatus) briefStatus.textContent = sectorComplete ? 'RESTORED' : 'READY';
  const progressStrong = dom.start.querySelector('.brief-progress b');
  const progressFill = dom.start.querySelector('.brief-progress i span');
  if (progressStrong) progressStrong.textContent = `${percent}%`;
  if (progressFill) progressFill.style.width = `${percent}%`;
  const briefMeta = dom.start.querySelectorAll('.brief-meta dd');
  if (briefMeta[0]) briefMeta[0].textContent = missionProgress?.bestRating ?? '—';
  if (briefMeta[1]) {
    briefMeta[1].textContent = lastMission.rewards.medals
      .map((medal) => missionProgress?.medals?.includes(medal.id) ? '●' : '○')
      .join(' ');
  }
  if (briefMeta[2]) briefMeta[2].textContent = `${String(lastMission.estimatedMinutes).padStart(2, '0')}:00`;
}

function showMissionSelect() {
  setGamePhase('mission-select');
  renderMissionCards();
  renderMissionDetail();
}

function renderMissionCards() {
  const completedCount = saveData.campaign.completedMissionIds.length;
  const areaPercent = Math.round(completedCount / MISSIONS.length * 100);
  const areaProgress = dom.missionSelect.querySelector('.area-progress');
  const areaProgressValue = areaProgress?.querySelector('strong');
  if (areaProgress) {
    areaProgress.setAttribute('aria-label', `区域进度 ${areaPercent}%`);
    areaProgress.style.setProperty('--area-progress', `${areaPercent}%`);
  }
  if (areaProgressValue) areaProgressValue.textContent = `${areaPercent}%`;

  for (const mission of MISSIONS) {
    const card = $(`mission-card-${mission.order}`);
    if (!card) continue;
    const progress = saveData.missionProgress[mission.id];
    const unlocked = isMissionUnlocked(mission.id, saveData);
    card.dataset.mission = mission.id;
    card.disabled = !unlocked;
    card.setAttribute('aria-disabled', String(!unlocked));
    card.setAttribute('aria-pressed', String(game.selectedMissionId === mission.id));
    card.classList.toggle('is-selected', game.selectedMissionId === mission.id);
    card.classList.toggle('is-complete', Boolean(progress?.completed));
    card.classList.toggle('is-locked', !unlocked);
    const body = card.querySelector('.mission-card__body');
    const label = body?.querySelector('small');
    const title = body?.querySelector('strong');
    const description = body?.querySelector('span');
    if (label) label.textContent = `${mission.missionType.toUpperCase()} // ${!unlocked ? 'LOCKED' : progress?.completed ? 'COMPLETE' : 'AVAILABLE'}`;
    if (title) title.textContent = mission.name;
    if (description) description.textContent = mission.subtitle;
    const badgeText = mission.rewards.medals.map((medal) => progress?.medals?.includes(medal.id) ? '●' : '○').join(' ');
    const badges = card.querySelector('.mission-card__badges');
    if (badges) {
      const earnedCount = progress?.medals?.length ?? 0;
      badges.textContent = badgeText;
      badges.setAttribute('aria-label', `${earnedCount} / ${mission.rewards.medals.length} 枚照护徽章`);
    }
    const grade = card.querySelector('.mission-card__grade');
    if (grade) grade.textContent = progress?.bestRating ?? (unlocked ? '—' : '🔒');
  }
}

function selectMission(missionId) {
  const mission = getMissionById(missionId);
  if (!mission || !isMissionUnlocked(missionId, saveData)) {
    toast('该任务尚未解锁', 'warning');
    return;
  }
  game.selectedMissionId = mission.id;
  renderMissionCards();
  renderMissionDetail();
}

function renderMissionDetail() {
  const mission = getMissionById(game.selectedMissionId) ?? MISSIONS[0];
  const primary = mission.objectives.primary;
  dom.selectedMissionName.textContent = mission.name;
  dom.selectedMissionDescription.textContent = mission.briefing;
  if (primary.type === 'boss-repair') dom.selectedMissionObjective.textContent = `修复 ${primary.phases} 个 Boss 阶段`;
  else if (primary.type === 'threat-shift') dom.selectedMissionObjective.textContent = `补给 ${primary.feedTarget} · 停机 ${primary.neutralizeTarget}`;
  else dom.selectedMissionObjective.textContent = `补给 ${primary.target ?? primary.feedTarget} 份`;
  const detailVisual = dom.missionSelect.querySelector('.mission-detail__visual span');
  const detailType = dom.missionSelect.querySelector('.mission-detail__visual strong');
  if (detailVisual) detailVisual.textContent = String(mission.order).padStart(2, '0');
  if (detailType) detailType.textContent = mission.missionType.toUpperCase();
  const objectiveDds = dom.missionSelect.querySelectorAll('.mission-detail dl dd');
  if (objectiveDds[1]) objectiveDds[1].textContent = mission.objectives.technical.label;
  if (objectiveDds[2]) objectiveDds[2].textContent = mission.objectives.special.label;
}

function showLoadout() {
  const mission = getMissionById(game.selectedMissionId);
  if (!mission || !isMissionUnlocked(mission.id, saveData)) return showMissionSelect();
  const available = mission.availableAmmo.filter((ammoId) => saveData.unlocks.ammo.includes(ammoId));
  const savedAmmoOrder = saveData.loadout.ammo.filter((ammoId) => available.includes(ammoId));
  game.equippedAmmo = [...new Set([...savedAmmoOrder, ...available])].slice(0, 3);
  const unlockedModules = MODULES.filter((module) => saveData.unlocks.modules.includes(module.id));
  const preferredModuleIds = [saveData.loadout.module, mission.defaultLoadout.module, 'pressure-stabilizer'];
  game.equippedModule = preferredModuleIds.find((moduleId) => unlockedModules.some((module) => module.id === moduleId))
    ?? unlockedModules[0]?.id
    ?? 'pressure-stabilizer';
  setGamePhase('loadout');
  renderLoadout();
}

function renderLoadout() {
  const mission = getMissionById(game.selectedMissionId);
  const headerEyebrow = dom.loadout.querySelector('.menu-header .eyebrow');
  if (headerEyebrow) headerEyebrow.textContent = `MISSION ${String(mission.order).padStart(2, '0')} // PREPARE LOADOUT`;
  const unlockedMissionAmmo = mission.availableAmmo.filter((ammoId) => saveData.unlocks.ammo.includes(ammoId));
  const loadoutHelp = dom.loadout.querySelector('.menu-header p:not(.eyebrow)');
  if (loadoutHelp) {
    loadoutHelp.textContent = `点击弹药可设为首发槽位；点击模块可切换已解锁方案。任务中用数字键 1–3 切换弹种。`;
  }
  const ammoEquippedCount = dom.loadout.querySelector('#ammo-loadout-title')?.closest('.section-heading')?.querySelector('small');
  if (ammoEquippedCount) ammoEquippedCount.textContent = `${game.equippedAmmo.length} / ${unlockedMissionAmmo.length} EQUIPPED`;
  const aliasMap = { 'nutrient-gel': 'nutrition', 'adhesive-bloom': 'bloom', 'bounce-bubble': 'bounce' };
  for (const ammo of AMMO_TYPES) {
    const option = $(`ammo-option-${aliasMap[ammo.id]}`);
    const allowed = mission.availableAmmo.includes(ammo.id) && saveData.unlocks.ammo.includes(ammo.id);
    option.disabled = !allowed;
    option.setAttribute('aria-disabled', String(!allowed));
    option.classList.toggle('is-equipped', game.equippedAmmo.includes(ammo.id));
    option.classList.toggle('is-locked', !allowed);
    option.setAttribute('aria-pressed', String(game.equippedAmmo.includes(ammo.id)));
    const status = option.querySelector('b');
    if (status) {
      const equippedIndex = game.equippedAmmo.indexOf(ammo.id);
      status.textContent = !allowed ? '未解锁' : equippedIndex === 0 ? '首发槽位' : '已装备';
    }
  }
  const selectedModule = MODULES.find((entry) => entry.id === game.equippedModule) ?? MODULES[0];
  for (let index = 0; index < 3; index += 1) {
    const slot = $(`ammo-slot-${index + 1}`);
    const ammo = getAmmoTypeById(game.equippedAmmo[index]);
    slot.hidden = !ammo;
    if (!ammo) {
      delete slot.dataset.ammo;
      continue;
    }
    slot.dataset.ammo = ammo.id;
    slot.classList.toggle('is-active', index === 0);
    slot.setAttribute('aria-pressed', String(index === 0));
    const name = slot.querySelector('strong');
    const detail = slot.querySelector('small');
    const orb = slot.querySelector('.ammo-orb');
    if (name) name.textContent = ammo.name;
    if (detail) {
      const missionStart = mission.ammoRules?.startingInventory?.[ammo.id];
      const baseCapacity = Number.isFinite(missionStart) ? missionStart : ammo.inventory.capacity;
      const capacityDelta = ammo.id === 'nutrient-gel' ? (selectedModule.effects?.nutrientCapacityDelta ?? 0) : 0;
      const missionInventory = Math.min(Math.max(1, baseCapacity + capacityDelta), Number.isFinite(missionStart) ? missionStart : ammo.inventory.starting);
      detail.textContent = mission.ammoRules?.rechargeDisabled
        ? `任务库存 ×${missionInventory}`
        : ammo.inventory.rechargeSeconds ? '自动补充' : `库存 ×${missionInventory}`;
    }
    if (orb) orb.className = `ammo-orb ammo-orb--${AMMO_UI_CLASS[ammo.id]}`;
  }
  const module = selectedModule;
  const unlockedModules = MODULES.filter((entry) => saveData.unlocks.modules.includes(entry.id));
  const moduleCard = $('module-option-stabilizer');
  moduleCard.dataset.module = module.id;
  moduleCard.title = unlockedModules.length > 1 ? '点击切换已解锁模块' : '完成任务可解锁更多模块';
  moduleCard.setAttribute('aria-label', `${module.name}：${module.description}${unlockedModules.length > 1 ? '。点击切换模块' : ''}`);
  const moduleType = moduleCard.querySelector('small');
  const moduleName = moduleCard.querySelector('strong');
  const moduleDescription = moduleCard.querySelector('em');
  const moduleStatus = moduleCard.querySelector('b');
  const moduleIcon = moduleCard.querySelector('.module-card__icon');
  if (moduleType) moduleType.textContent = `${module.slot.toUpperCase()} MODULE`;
  if (moduleName) moduleName.textContent = module.name;
  if (moduleDescription) moduleDescription.textContent = module.description;
  if (moduleStatus) moduleStatus.textContent = unlockedModules.length > 1 ? '点击切换' : 'EQUIPPED';
  if (moduleIcon) moduleIcon.textContent = { barrel: '⌖', magazine: '▣', targeting: '◎' }[module.slot] ?? '⌖';

  const lockedPreview = dom.loadout.querySelector('.module-locked');
  const nextLockedModule = MODULES.find((entry) => !saveData.unlocks.modules.includes(entry.id));
  if (lockedPreview) {
    lockedPreview.hidden = !nextLockedModule;
    const lockedName = lockedPreview.querySelector('strong');
    const lockedCopy = lockedPreview.querySelector('small');
    if (lockedName) lockedName.textContent = nextLockedModule?.name ?? '';
    if (lockedCopy) lockedCopy.textContent = nextLockedModule ? '继续完成任务以解锁' : '';
  }
}

function prioritizeLoadoutAmmo(ammoId) {
  if (!game.equippedAmmo.includes(ammoId)) return;
  game.equippedAmmo = [ammoId, ...game.equippedAmmo.filter((entry) => entry !== ammoId)];
  renderLoadout();
  toast(`首发弹药：${getAmmoTypeById(ammoId)?.name}`, 'success');
}

function cycleLoadoutModule() {
  const unlockedModules = MODULES.filter((module) => saveData.unlocks.modules.includes(module.id));
  if (unlockedModules.length <= 1) {
    toast('继续完成任务即可解锁更多模块', 'warning');
    return;
  }
  const currentIndex = unlockedModules.findIndex((module) => module.id === game.equippedModule);
  game.equippedModule = unlockedModules[(currentIndex + 1 + unlockedModules.length) % unlockedModules.length].id;
  renderLoadout();
  toast(`已装备：${MODULES.find((module) => module.id === game.equippedModule)?.name}`, 'success');
}

function launchSelectedMission() {
  saveData.loadout.ammo = [...game.equippedAmmo];
  saveData.loadout.module = game.equippedModule;
  saveData.campaign.lastMissionId = game.selectedMissionId;
  saveData = saveProgress(saveData);
  startMission(game.selectedMissionId);
}

function openSettings(returnPhase = game.phase) {
  settingsReturnPhase = returnPhase;
  populateSettingsForm(settings);
  setGamePhase('settings');
}

function closeSettings() {
  const destination = settingsReturnPhase === 'paused'
    ? 'paused'
    : settingsReturnPhase === 'mission-select'
      ? 'mission-select'
      : settingsReturnPhase === 'loadout'
        ? 'loadout'
        : 'main-menu';
  setGamePhase(destination);
}

function populateSettingsForm(source) {
  const value = normalizeSettings(source);
  const setValue = (id, next) => { if ($(id)) $(id).value = String(next); };
  const setChecked = (id, next) => { if ($(id)) $(id).checked = Boolean(next); };
  setValue('setting-quality-preset', value.graphics.qualityPreset);
  setChecked('setting-dynamic-render-scale', value.graphics.dynamicRenderScale);
  setValue('setting-shadow-quality', value.graphics.shadowQuality);
  setValue('setting-particle-quality', value.graphics.particleQuality);
  setValue('setting-render-scale', value.graphics.renderScale);
  setValue('setting-ui-scale', Math.round(value.accessibility.uiScale * 100));
  setChecked('setting-high-contrast', value.accessibility.highContrast);
  setChecked('setting-reduced-motion', value.accessibility.reducedMotion);
  setValue('setting-trajectory', value.gameplay.trajectoryMode);
  setValue('setting-aim-assist', Math.round(value.gameplay.aimAssist * 100));
  setValue('setting-camera-shake', Math.round(value.gameplay.cameraShake * 100));
  setValue('setting-master-volume', Math.round(value.audio.masterVolume * 100));
  setValue('setting-music-volume', Math.round(value.audio.musicVolume * 100));
  setValue('setting-sfx-volume', Math.round(value.audio.sfxVolume * 100));
  setValue('setting-gamepad-sensitivity', Math.round(value.controls.gamepadSensitivity * 100));
  setValue('setting-gamepad-deadzone', Math.round(value.controls.gamepadDeadzone * 100));
  setChecked('setting-invert-y', value.controls.invertY);
  setValue('setting-vibration', Math.round(value.controls.vibration * 100));
  updateSettingsOutputs();
}

function readSettingsForm() {
  const numberValue = (id, divisor = 1) => Number($(id)?.value ?? 0) / divisor;
  return normalizeSettings({
    version: DEFAULT_SETTINGS.version,
    audio: {
      masterVolume: numberValue('setting-master-volume', 100),
      musicVolume: numberValue('setting-music-volume', 100),
      sfxVolume: numberValue('setting-sfx-volume', 100),
    },
    controls: {
      ...settings.controls,
      gamepadSensitivity: numberValue('setting-gamepad-sensitivity', 100),
      gamepadDeadzone: numberValue('setting-gamepad-deadzone', 100),
      invertY: Boolean($('setting-invert-y')?.checked),
      vibration: numberValue('setting-vibration', 100),
    },
    gameplay: {
      trajectoryMode: $('setting-trajectory')?.value ?? 'full',
      trajectoryLine: $('setting-trajectory')?.value !== 'off',
      aimAssist: numberValue('setting-aim-assist', 100),
      cameraShake: numberValue('setting-camera-shake', 100),
    },
    accessibility: {
      uiScale: numberValue('setting-ui-scale', 100),
      highContrast: Boolean($('setting-high-contrast')?.checked),
      reducedMotion: Boolean($('setting-reduced-motion')?.checked),
    },
    graphics: {
      qualityPreset: $('setting-quality-preset')?.value ?? DEFAULT_SETTINGS.graphics.qualityPreset,
      dynamicRenderScale: Boolean($('setting-dynamic-render-scale')?.checked),
      shadowQuality: $('setting-shadow-quality')?.value ?? DEFAULT_SETTINGS.graphics.shadowQuality,
      particleQuality: $('setting-particle-quality')?.value ?? DEFAULT_SETTINGS.graphics.particleQuality,
      renderScale: numberValue('setting-render-scale'),
    },
  });
}

function applyRuntimeSettings(nextSettings) {
  settings = applySettings(nextSettings, {
    inputSystem,
    trajectory,
    setQualityPreset: setRuntimeQualityPreset,
    setDynamicRenderScale: setRuntimeDynamicRenderScale,
    setShadowQuality: setRuntimeShadowQuality,
    setParticleQuality: setRuntimeParticleQuality,
    setRenderScale: setRuntimeUserRenderScale,
  });
  resetDynamicRenderScale();
  resize();
}

function applyQualityPresetToSettingsForm(qualityPreset) {
  const profile = RUNTIME_QUALITY_PRESETS[qualityPreset];
  if (!profile) return;
  if ($('setting-shadow-quality')) $('setting-shadow-quality').value = profile.shadowQuality;
  if ($('setting-particle-quality')) $('setting-particle-quality').value = profile.particleQuality;
  if ($('setting-render-scale')) $('setting-render-scale').value = String(profile.renderScale);
}

function handleSettingsFormInput(event) {
  if (event.target?.id === 'setting-quality-preset') {
    applyQualityPresetToSettingsForm(event.target.value);
  }
  updateSettingsOutputs();
}

function updateSettingsOutputs() {
  for (const input of dom.settingsForm?.querySelectorAll('input[type="range"]') ?? []) {
    const output = input.closest('.range-control')?.querySelector('output');
    if (output) output.textContent = `${input.value}%`;
  }
}

function createRunStats() {
  return {
    shotsFired: 0,
    shotsHit: 0,
    bullseyes: 0,
    maxCombo: 0,
    specialUsed: 0,
    requestsMissed: 0,
    cleanerDroneHits: 0,
    hazardsHit: 0,
    hazardsNeutralized: 0,
    adhesiveMultiFeeds: 0,
    ricochetFeeds: 0,
    frogApexFeeds: 0,
    bearClosedHits: 0,
    bossCoreMisses: 0,
    comboCapacitorTriggers: 0,
  };
}

function createClassicMission() {
  return {
    id: 'classic-shift',
    name: '经典轮班',
    missionType: 'classic',
    timeLimitSeconds: CLASSIC_DURATION,
    animals: ['panda', 'rabbit', 'frog', 'bear'],
    hazards: ['cleaner-drone', 'snack-thief', 'barrier-drone'],
    availableAmmo: AMMO_TYPES.map((entry) => entry.id),
    objectives: { primary: { type: 'feed-quota', target: 18 } },
    encounters: [
      { id: 'warmup', startAt: 0, duration: 25, spawn: { panda: 3, rabbit: 3 }, maxConcurrent: 3 },
      { id: 'motion', startAt: 25, duration: 25, spawn: { frog: 3, bear: 3, 'cleaner-drone': 1 }, maxConcurrent: 4 },
      { id: 'rush', startAt: 50, duration: 25, spawn: { panda: 2, rabbit: 2, frog: 2, bear: 2, 'cleaner-drone': 2, 'snack-thief': 1, 'barrier-drone': 1 }, maxConcurrent: 5 },
    ],
  };
}

function createMissionInventory(mission, equippedAmmo, moduleId) {
  const inventory = {};
  const module = MODULES.find((entry) => entry.id === moduleId);
  for (const ammoId of equippedAmmo) {
    const definition = getAmmoTypeById(ammoId);
    if (!definition) continue;
    const missionStart = mission.ammoRules?.startingInventory?.[ammoId];
    const moduleCapacityDelta = ammoId === 'nutrient-gel' ? (module?.effects?.nutrientCapacityDelta ?? 0) : 0;
    const baseCapacity = Number.isFinite(missionStart) ? missionStart : definition.inventory.capacity;
    const capacity = Math.max(1, baseCapacity + moduleCapacityDelta);
    const baseStarting = Number.isFinite(missionStart) ? missionStart : definition.inventory.starting;
    const starting = Math.min(capacity, baseStarting);
    inventory[ammoId] = {
      current: starting,
      capacity,
      rechargeSeconds: mission.ammoRules?.rechargeDisabled ? null : definition.inventory.rechargeSeconds,
      rechargeTimer: 0,
    };
  }
  return inventory;
}

function startMission(missionId = game.selectedMissionId, options = {}) {
  const classic = Boolean(options.classic);
  const mission = classic ? createClassicMission() : getMissionById(missionId);
  if (!mission) {
    toast('任务数据不存在', 'danger');
    return;
  }
  if (!classic && !isMissionUnlocked(mission.id, saveData)) {
    toast('请先完成上一任务', 'warning');
    return;
  }

  clearRoundObjects();
  const available = mission.availableAmmo.filter((ammoId) => classic || saveData.unlocks.ammo.includes(ammoId));
  const savedLoadout = saveData.loadout.ammo.filter((ammoId) => available.includes(ammoId));
  const equippedAmmo = [...new Set([...savedLoadout, ...available])].slice(0, 3);
  const moduleId = classic
    ? 'pressure-stabilizer'
    : (saveData.unlocks.modules.includes(game.equippedModule) ? game.equippedModule : mission.defaultLoadout?.module);
  Object.assign(game, {
    phase: 'playing',
    mode: classic ? 'classic' : 'campaign',
    selectedMissionId: classic ? game.selectedMissionId : mission.id,
    mission,
    equippedAmmo,
    equippedModule: moduleId ?? 'pressure-stabilizer',
    activeAmmoIndex: 0,
    inventory: createMissionInventory(mission, equippedAmmo, moduleId),
    score: 0,
    combo: 0,
    time: mission.timeLimitSeconds,
    wave: 1,
    stability: 100,
    feeds: 0,
    threatProgress: 0,
    bossPhase: 0,
    bossPhaseHits: 0,
    bossPhaseTarget: 0,
    supplyCratesRemaining: Math.max(0, Number(mission.ammoRules?.supplyCrates) || 0),
    spawnTimer: 0.65,
    yaw: 0,
    pitch: 0.2,
    charging: false,
    charge: 0,
    elapsed: 0,
    lastSuccessReason: '',
    lastFailureReason: '',
    stats: createRunStats(),
    lastResult: null,
    pendingOutcome: null,
  });
  setGamePhase('playing');
  dom.pauseButton.setAttribute('aria-label', '暂停游戏');
  dom.pauseButton.title = '暂停';
  if (mission.missionType === 'boss') setupBossPhase(0);
  else {
    const openingCount = classic ? 3 : Math.min(2, currentEncounter()?.maxConcurrent ?? 2);
    for (let i = 0; i < openingCount; i += 1) spawnTarget(mission.animals[i % mission.animals.length]);
  }
  updateMission();
  updateAmmoUI();
  updateChargeUI();
  updateHUD();
  ensureAudio();
  simulationAccumulator = 0;
  lastFrameTime = performance.now();
  toast('移动瞄准 · 长按蓄力 · Q/E 或肩键切换弹种', 'success');
}

function startGame() {
  startMission(game.selectedMissionId, { classic: true });
}

function finishMission(completed, reason) {
  if (game.phase !== 'playing') return;
  game.pendingOutcome = null;
  cancelCharge();
  if (completed) {
    game.lastSuccessReason = reason;
    game.score += Math.round(game.stability * 10 + game.time * 3);
  } else {
    game.lastFailureReason = reason;
  }

  const accuracy = game.stats.shotsFired > 0 ? game.stats.shotsHit / game.stats.shotsFired : 0;
  const completionTimeSeconds = Math.max(0, game.mission.timeLimitSeconds - game.time);
  const persistedResult = {
    completed,
    score: Math.round(game.score),
    accuracy: completed ? accuracy : 0,
    maxCombo: game.stats.maxCombo,
    timeRemainingSeconds: completed ? game.time : 0,
    completionTimeSeconds,
    shotsUsed: game.stats.shotsFired,
    shotsFired: game.stats.shotsFired,
    shotsHit: game.stats.shotsHit,
    successfulFeeds: game.feeds,
    feeds: game.feeds,
    bullseyes: game.stats.bullseyes,
    specialUsed: game.stats.specialUsed,
    stability: game.stability,
    hazardsHit: game.stats.hazardsHit,
    cleanerDroneHits: game.stats.cleanerDroneHits,
    hazardsNeutralized: game.stats.hazardsNeutralized,
    playTimeSeconds: completionTimeSeconds,
    adhesiveMultiFeeds: completed ? game.stats.adhesiveMultiFeeds : 0,
    ricochetFeeds: completed ? game.stats.ricochetFeeds : 0,
    bossCoreMisses: completed ? game.stats.bossCoreMisses : Number.MAX_SAFE_INTEGER,
  };

  let resultMeta = null;
  let bestScore = Math.round(game.score);
  if (game.mode === 'campaign') {
    saveData = recordMissionResult(game.mission.id, persistedResult, { saveData });
    resultMeta = saveData.missionProgress[game.mission.id].lastResult;
    bestScore = getBestMissionResult(game.mission.id, saveData)?.bestScore ?? bestScore;
  } else {
    saveData.modes.classicShift.bestScore = Math.max(saveData.modes.classicShift.bestScore, Math.round(game.score));
    saveData.modes.classicShift.gamesPlayed += 1;
    saveData.statistics.totalScore += Math.round(game.score);
    saveData.statistics.playTimeSeconds += completionTimeSeconds;
    saveData = saveProgress(saveData);
    bestScore = saveData.modes.classicShift.bestScore;
    resultMeta = {
      rating: completed ? getClassicRating(game.score) : null,
      medals: completed ? ['completion', ...(accuracy >= 0.65 ? ['technical'] : []), ...(game.stability >= 60 ? ['special'] : [])] : [],
      newlyUnlocked: [],
      rewardsEarned: { credits: 0, careBadges: 0 },
    };
  }

  game.lastResult = { ...persistedResult, accuracy, resultMeta, reason, bestScore };
  renderResultScreen(game.lastResult);
  setGamePhase('results');
  dom.crosshair.hidden = true;
  trajectory.visible = false;
  playEndSound(completed && Math.round(game.score) >= bestScore);
}

function togglePause() {
  if (game.phase === 'playing') {
    setGamePhase('paused');
    dom.pauseButton.setAttribute('aria-label', '继续游戏');
    dom.pauseButton.title = '继续';
    dom.pauseMissionName.textContent = game.mission?.name ?? '经典轮班';
    dom.pauseMissionProgress.textContent = getMissionProgress().label;
    dom.pauseStabilityValue.textContent = `${Math.round(game.stability)}%`;
    toast('实验暂停', 'warning');
  } else if (game.phase === 'paused') {
    setGamePhase('playing');
    dom.pauseButton.setAttribute('aria-label', '暂停游戏');
    dom.pauseButton.title = '暂停';
    simulationAccumulator = 0;
    lastFrameTime = performance.now();
    toast('实验继续', 'success');
  }
}

function getClassicRating(score) {
  if (score >= 7000) return 'S';
  if (score >= 4800) return 'A';
  if (score >= 2800) return 'B';
  return 'C';
}

function renderResultScreen(result) {
  const completed = result.completed;
  const rating = result.resultMeta?.rating ?? '—';
  const medals = result.resultMeta?.medals ?? [];
  const resultCard = dom.gameOver.querySelector('.result-card');
  resultCard?.classList.toggle('is-failure', !completed);
  dom.gameOverTitle.textContent = completed ? '任务完成' : '任务未完成';
  dom.resultStatus.textContent = completed ? 'MISSION' : 'SYSTEM';
  const stamp = dom.resultStatus.parentElement?.querySelector('strong');
  if (stamp) stamp.textContent = completed ? 'PASS' : 'FAIL';
  dom.resultGrade.textContent = rating;
  const gradeLabel = dom.resultGrade.parentElement?.querySelector('small');
  if (gradeLabel) gradeLabel.textContent = completed ? ({ C: '合格照护', B: '稳定照护', A: '优秀照护', S: '完美照护' }[rating] ?? '任务完成') : result.reason;
  const subtitle = dom.gameOver.querySelector('.result-subtitle');
  if (subtitle) subtitle.textContent = game.mode === 'classic' ? 'SECTOR 07 // CLASSIC SHIFT' : `BAMBOO NURSERY // MISSION ${String(game.mission.order).padStart(2, '0')}`;
  dom.finalScore.textContent = Math.round(result.score).toLocaleString('zh-CN');
  dom.bestScore.textContent = Math.round(result.bestScore).toLocaleString('zh-CN');
  dom.resultAccuracy.textContent = `${Math.round(result.accuracy * 100)}%`;
  dom.resultBullseye.textContent = `${result.shotsHit > 0 ? Math.round(result.bullseyes / result.shotsHit * 100) : 0}%`;
  dom.resultLongestCombo.textContent = `×${result.maxCombo}`;
  dom.resultSpecialUsed.textContent = String(result.specialUsed);
  dom.resultStability.textContent = `${Math.round(result.stability)}%`;
  dom.resultTime.textContent = formatClock(result.completionTimeSeconds);

  const badgeDefinitions = game.mode === 'campaign'
    ? game.mission.rewards.medals
    : [
      { id: 'completion', label: '完成轮班', description: '坚持到计时结束' },
      { id: 'technical', label: '精准轮班', description: '命中率达到 65%' },
      { id: 'special', label: '稳定轮班', description: '稳定度保持 60% 以上' },
    ];
  const badgeIds = ['result-badge-1', 'result-badge-2', 'result-badge-3'];
  badgeIds.forEach((id, index) => {
    const element = $(id);
    const definition = badgeDefinitions[index];
    element?.classList.toggle('is-earned', medals.includes(definition?.id));
    const strong = element?.querySelector('strong');
    const small = element?.querySelector('small');
    if (strong) strong.textContent = definition?.label ?? '照护徽章';
    if (small) small.textContent = definition?.description ?? '';
  });
  const badgeHeading = dom.gameOver.querySelector('#badge-report-title span');
  if (badgeHeading) badgeHeading.textContent = `${medals.length} / 3`;

  const unlockMessages = [];
  const unlockedId = result.resultMeta?.newlyUnlocked?.[0];
  if (unlockedId) {
    const unlockedMission = getMissionById(unlockedId);
    if (unlockedMission) unlockMessages.push(`任务 ${String(unlockedMission.order).padStart(2, '0')}：${unlockedMission.name}`);
  }
  for (const ammoId of result.resultMeta?.rewardsEarned?.ammo ?? []) {
    const ammo = getAmmoTypeById(ammoId);
    if (ammo) unlockMessages.push(`弹药：${ammo.name}`);
  }
  for (const moduleId of result.resultMeta?.rewardsEarned?.modules ?? []) {
    const module = MODULES.find((entry) => entry.id === moduleId);
    if (module) unlockMessages.push(`模块：${module.name}`);
  }
  for (const cosmeticId of result.resultMeta?.rewardsEarned?.cosmetics ?? []) {
    if (cosmeticId === 'sector-07-restored') unlockMessages.push('外观：翠竹育幼园修复涂装');
  }
  if (unlockMessages.length > 0) {
    dom.resultUnlock.hidden = false;
    const unlockStrong = dom.resultUnlock.querySelector('strong');
    if (unlockStrong) unlockStrong.textContent = unlockMessages.join(' · ');
  } else {
    dom.resultUnlock.hidden = true;
  }

  const nextMissionId = game.mode === 'campaign' ? getNextMissionId(game.mission.id) : null;
  dom.resultNextButton.hidden = !completed || !nextMissionId;
  dom.resultNextButton.disabled = !completed || !nextMissionId;
  dom.restartButton.textContent = completed ? '↻ 立即重试' : '↻ 再试一次';
}

function formatClock(secondsValue) {
  const total = Math.max(0, Math.round(secondsValue));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function toast(message, tone = 'success') {
  if (!dom.toastRegion) return;
  const item = document.createElement('div');
  item.className = `toast toast--${tone}`;
  item.textContent = message;
  dom.toastRegion.appendChild(item);
  window.setTimeout(() => item.classList.add('is-leaving'), 1700);
  window.setTimeout(() => item.remove(), 2100);
}

let audioContext = null;

function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
}

function tone(frequency, duration, type = 'sine', gain = 0.05, delay = 0) {
  if (!audioContext) return;
  const outputGain = gain * (settings?.audio?.masterVolume ?? 1) * (settings?.audio?.sfxVolume ?? 1);
  if (outputGain <= 0.0001) return;
  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const volume = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  volume.gain.setValueAtTime(outputGain, start);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(volume).connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function playShotSound(speed) {
  ensureAudio();
  tone(92 + speed * 2, 0.18, 'sawtooth', 0.045);
  tone(46, 0.32, 'square', 0.025, 0.025);
}

function playHitSound(combo) {
  ensureAudio();
  const base = 420 + Math.min(combo, 8) * 35;
  tone(base, 0.12, 'sine', 0.045);
  tone(base * 1.5, 0.18, 'sine', 0.035, 0.07);
}

function playHazardSound() {
  ensureAudio();
  tone(150, 0.24, 'square', 0.04);
  tone(112, 0.35, 'sawtooth', 0.025, 0.08);
}

function playMissSound() {
  if (!audioContext) return;
  tone(88, 0.09, 'sine', 0.012);
}

function playEndSound(isBest) {
  ensureAudio();
  const notes = isBest ? [392, 523, 659, 784] : [392, 330, 262];
  notes.forEach((note, index) => tone(note, 0.25, 'sine', 0.035, index * 0.12));
}

function onCanvasPointerDown(event) {
  if (game.phase !== 'playing' || event.button > 0) return;
  pointer.active = true;
  pointer.id = event.pointerId;
  pointer.startX = event.clientX;
  pointer.startY = event.clientY;
  pointer.startYaw = game.yaw;
  pointer.startPitch = game.pitch;
  dom.canvas.setPointerCapture(event.pointerId);
  startCharge();
}

function onCanvasPointerMove(event) {
  if (!pointer.active || event.pointerId !== pointer.id) return;
  const dx = event.clientX - pointer.startX;
  const dy = event.clientY - pointer.startY;
  game.yaw = THREE.MathUtils.clamp(pointer.startYaw + dx * 0.00165, -0.48, 0.48);
  game.pitch = THREE.MathUtils.clamp(pointer.startPitch - dy * 0.00175, 0.035, 0.57);
}

function onCanvasPointerUp(event) {
  if (!pointer.active || event.pointerId !== pointer.id) return;
  pointer.active = false;
  if (dom.canvas.hasPointerCapture(event.pointerId)) dom.canvas.releasePointerCapture(event.pointerId);
  releaseShot();
}

function selectAmmoIndex(index, announce = true) {
  if (game.equippedAmmo.length === 0) return;
  const nextIndex = THREE.MathUtils.clamp(index, 0, game.equippedAmmo.length - 1);
  if (nextIndex === game.activeAmmoIndex) return;
  cancelCharge();
  game.activeAmmoIndex = nextIndex;
  updateAmmoUI();
  if (announce) toast(`已切换：${getAmmoTypeById(activeAmmoId())?.name}`, 'success');
}

function cycleAmmo(direction) {
  const count = game.equippedAmmo.length;
  if (count <= 1) return;
  selectAmmoIndex((game.activeAmmoIndex + direction + count) % count);
}

function updateInput(dt) {
  if (!inputSystem) return;
  inputSystem.update(dt);

  if (game.phase === 'playing') {
    if (inputSystem.consumeAction('pause')) {
      togglePause();
      return;
    }
    const aimSpeed = 0.62;
    game.yaw += inputSystem.getAction('aimX') * aimSpeed * dt;
    game.pitch += inputSystem.getAction('aimY') * aimSpeed * dt;
    game.yaw = THREE.MathUtils.clamp(game.yaw, -0.48, 0.48);
    game.pitch = THREE.MathUtils.clamp(game.pitch, 0.035, 0.57);

    if (inputSystem.consumeAction('fire')) startCharge();
    if (inputSystem.wasActionReleased('fire')) releaseShot();
    if (inputSystem.consumeAction('ability')) triggerSecondaryAction();
    if (inputSystem.consumeAction('previousAmmo')) cycleAmmo(-1);
    if (inputSystem.consumeAction('nextAmmo')) cycleAmmo(1);
    if (inputSystem.consumeAction('ammo1')) selectAmmoIndex(0);
    if (inputSystem.consumeAction('ammo2')) selectAmmoIndex(1);
    if (inputSystem.consumeAction('ammo3')) selectAmmoIndex(2);
    if (inputSystem.consumeAction('restart')) startMission(game.selectedMissionId, { classic: game.mode === 'classic' });
    return;
  }

  if (game.phase === 'paused') {
    if (inputSystem.consumeAction('pause') || inputSystem.consumeAction('cancel')) togglePause();
    else if (inputSystem.consumeAction('restart')) startMission(game.selectedMissionId, { classic: game.mode === 'classic' });
    else updateMenuFocusFromInput();
    return;
  }

  if (inputSystem.consumeAction('cancel')) {
    handleMenuBack();
    return;
  }
  updateMenuFocusFromInput();
}

function updateMenuFocusFromInput() {
  const vertical = inputSystem.consumeAction('menuY');
  const horizontal = inputSystem.consumeAction('menuX');
  if (vertical) moveMenuFocus(vertical > 0 ? 1 : -1);
  else if (horizontal && !adjustFocusedSetting(horizontal > 0 ? 1 : -1)) moveMenuFocus(horizontal > 0 ? 1 : -1);
  if (inputSystem.currentDevice === 'gamepad' && inputSystem.consumeAction('confirm')) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.matches(':disabled')) active.click();
  }
}

function adjustFocusedSetting(direction) {
  if (game.phase !== 'settings') return false;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.type === 'range') {
    const step = Number(active.step) || 1;
    const min = Number.isFinite(Number(active.min)) ? Number(active.min) : 0;
    const max = Number.isFinite(Number(active.max)) ? Number(active.max) : 100;
    active.value = String(THREE.MathUtils.clamp(Number(active.value) + step * direction, min, max));
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (active instanceof HTMLSelectElement) {
    const options = [...active.options].filter((option) => !option.disabled);
    const currentIndex = Math.max(0, options.indexOf(active.selectedOptions[0]));
    const nextIndex = THREE.MathUtils.clamp(currentIndex + direction, 0, options.length - 1);
    if (options[nextIndex]) active.value = options[nextIndex].value;
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

function visibleMenuControls() {
  const screen = {
    'main-menu': dom.start,
    'mission-select': dom.missionSelect,
    loadout: dom.loadout,
    settings: dom.settings,
    paused: dom.pauseScreen,
    results: dom.gameOver,
  }[game.phase];
  if (!screen) return [];
  return [...screen.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled)')]
    .filter((element) => !element.hidden && element.offsetParent !== null);
}

function moveMenuFocus(direction) {
  const controls = visibleMenuControls();
  if (controls.length === 0) return;
  const current = controls.indexOf(document.activeElement);
  const next = current < 0 ? 0 : (current + direction + controls.length) % controls.length;
  controls[next].focus({ preventScroll: true });
}

function handleMenuBack() {
  if (game.phase === 'mission-select') showMainMenu();
  else if (game.phase === 'loadout') showMissionSelect();
  else if (game.phase === 'settings') closeSettings();
  else if (game.phase === 'results') showMissionSelect();
}

function bindEvents() {
  dom.startButton.addEventListener('click', startGame);
  dom.mainMissionsButton.addEventListener('click', showMissionSelect);
  dom.mainSettingsButton.addEventListener('click', () => openSettings('main-menu'));
  dom.mainContinueButton.addEventListener('click', () => {
    if (saveData.campaign.sectorCompleted) return showMissionSelect();
    const lastMission = getMissionById(saveData.campaign.lastMissionId);
    game.selectedMissionId = lastMission && isMissionUnlocked(lastMission.id, saveData) ? lastMission.id : MISSIONS[0].id;
    showLoadout();
  });
  dom.missionList.addEventListener('click', (event) => {
    const card = event.target.closest('.mission-card');
    if (card) selectMission(card.dataset.mission);
  });
  dom.missionBackButton.addEventListener('click', showMainMenu);
  dom.missionLoadoutButton.addEventListener('click', showLoadout);
  dom.loadoutBackButton.addEventListener('click', showMissionSelect);
  dom.launchMissionButton.addEventListener('click', launchSelectedMission);
  dom.loadout.addEventListener('click', (event) => {
    const ammoOption = event.target.closest('[data-ammo]');
    const ammoSlot = event.target.closest('.ammo-slot[data-ammo]');
    const moduleOption = event.target.closest('#module-option-stabilizer');
    const ammoId = ammoOption?.dataset.ammo ?? ammoSlot?.dataset.ammo;
    if (ammoId) prioritizeLoadoutAmmo(ammoId);
    else if (moduleOption) cycleLoadoutModule();
  });

  dom.settingsForm.addEventListener('input', handleSettingsFormInput);
  dom.settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    settings = saveSettings(readSettingsForm());
    applyRuntimeSettings(settings);
    toast('设置已保存', 'success');
    closeSettings();
  });
  dom.settingsBackButton.addEventListener('click', (event) => {
    event.preventDefault();
    populateSettingsForm(settings);
    closeSettings();
  });
  dom.settingsDefaultButton.addEventListener('click', (event) => {
    event.preventDefault();
    populateSettingsForm(DEFAULT_SETTINGS);
    toast('已载入默认设置，点击“应用设置”保存', 'warning');
  });

  dom.restartButton.addEventListener('click', () => startMission(game.selectedMissionId, { classic: game.mode === 'classic' }));
  dom.resultMissionButton.addEventListener('click', showMissionSelect);
  dom.resultNextButton.addEventListener('click', () => {
    const nextMissionId = getNextMissionId(game.mission.id);
    if (!nextMissionId) return showMissionSelect();
    game.selectedMissionId = nextMissionId;
    showLoadout();
  });
  dom.pauseButton.addEventListener('click', togglePause);
  dom.resumeButton.addEventListener('click', togglePause);
  dom.retryButton.addEventListener('click', () => startMission(game.selectedMissionId, { classic: game.mode === 'classic' }));
  dom.pauseSettingsButton.addEventListener('click', () => openSettings('paused'));
  dom.quitMissionButton.addEventListener('click', () => {
    clearRoundObjects();
    game.charging = false;
    showMissionSelect();
  });
  dom.canvas.addEventListener('pointerdown', onCanvasPointerDown);
  dom.canvas.addEventListener('pointermove', onCanvasPointerMove);
  dom.canvas.addEventListener('pointerup', onCanvasPointerUp);
  dom.canvas.addEventListener('pointercancel', onCanvasPointerUp);
  dom.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  dom.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    if (game.phase === 'playing') togglePause();
    toast('图形设备已重置，游戏已安全暂停', 'danger');
  });
  dom.canvas.addEventListener('webglcontextrestored', () => {
    resize();
    toast('图形设备已恢复，可以继续任务', 'success');
  });

  dom.fireButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dom.fireButton.setPointerCapture(event.pointerId);
    startCharge();
  });
  dom.fireButton.addEventListener('pointerup', (event) => {
    event.preventDefault();
    releaseShot();
  });
  dom.fireButton.addEventListener('pointercancel', releaseShot);

  window.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(event.code)) event.preventDefault();
  });
  window.addEventListener('blur', () => {
    if (game.phase === 'playing') togglePause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.phase === 'playing') togglePause();
  });
  window.addEventListener('slopzoo:gamepaddisconnected', () => {
    if (game.phase === 'playing') togglePause();
    toast('手柄连接已断开，请重新连接后继续', 'warning');
  });
  window.addEventListener('resize', resize);
}

function resize() {
  const rect = dom.shell.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const renderScale = runtimeGraphics.actualRenderScale;
  runtimeGraphics.pixelRatio = Math.min(window.devicePixelRatio * renderScale, 2);
  renderer.setPixelRatio(runtimeGraphics.pixelRatio);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function ensurePerformanceHud() {
  if (performanceHudElement) return performanceHudElement;
  const element = document.createElement('pre');
  element.id = 'performance-debug-hud';
  element.setAttribute('aria-live', 'off');
  element.style.cssText = [
    'position:fixed',
    'top:12px',
    'right:12px',
    'z-index:9999',
    'min-width:310px',
    'margin:0',
    'padding:12px 14px',
    'border:1px solid rgba(121,255,154,.48)',
    'border-radius:8px',
    'background:rgba(3,13,14,.88)',
    'color:#d9eee4',
    'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'pointer-events:none',
    'white-space:pre',
    'box-shadow:0 12px 30px rgba(0,0,0,.35)',
  ].join(';');
  element.hidden = true;
  document.body.append(element);
  performanceHudElement = element;
  return element;
}

function updatePerformanceHud(snapshot = latestPerformanceSnapshot ?? performanceMonitor.snapshot()) {
  if (!performanceHudEnabled) return;
  const element = ensurePerformanceHud();
  const pools = getRuntimePoolStats();
  const exceeded = Object.entries(snapshot.budgetStatus)
    .filter(([, status]) => status.state === 'exceeded' || status.state === 'pending')
    .map(([name, status]) => `${name}:${status.state}`)
    .join(' · ');
  const lines = [
    'SLOP ZOO PERF · F7 隐藏',
    `FPS ${snapshot.fps.average.toFixed(1)} · 1% LOW ${snapshot.fps.onePercentLow.toFixed(1)}`,
    `FRAME ${snapshot.frameTimeMs.average.toFixed(2)} ms · P95 ${snapshot.frameTimeMs.p95.toFixed(2)} ms`,
    `SCALE ${(runtimeGraphics.actualRenderScale * 100).toFixed(0)}% · USER ${(runtimeGraphics.userRenderScale * 100).toFixed(0)}% · DRS ${runtimeGraphics.dynamicRenderScale ? 'ON' : 'OFF'}`,
    `QUALITY ${runtimeGraphics.qualityPreset.toUpperCase()} · SHADOW ${runtimeGraphics.shadowQuality.toUpperCase()} · FX ${runtimeGraphics.particleQuality.toUpperCase()}`,
    `DRAW ${snapshot.render.current.calls} · TRI ${Math.round(snapshot.render.current.triangles).toLocaleString('en-US')}`,
    `GEO ${snapshot.memory.current.geometries} · TEX ${snapshot.memory.current.textures}`,
    `ENT ${snapshot.entities.current.total} · TGT ${targets.length} · PROJ ${projectiles.length} · FX ${particles.length}`,
    ...Object.entries(pools).map(([name, stats]) => (
      `${name.padEnd(12)} ${String(stats.active).padStart(3)}/${String(stats.capacity).padEnd(3)} created ${String(stats.created).padStart(3)} reuse ${String(stats.reused).padStart(5)}`
    )),
    exceeded ? `BUDGET ${exceeded}` : 'BUDGET OK',
  ];
  element.textContent = lines.join('\n');
}

function setPerformanceHud(enabled) {
  performanceHudEnabled = Boolean(enabled);
  const element = ensurePerformanceHud();
  element.hidden = !performanceHudEnabled;
  if (performanceHudEnabled) updatePerformanceHud();
  return performanceHudEnabled;
}

function renderLoop(now) {
  requestAnimationFrame(renderLoop);
  const rawDelta = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  updateInput(rawDelta);
  simulationAccumulator = Math.min(
    simulationAccumulator + rawDelta,
    FIXED_TIME_STEP * MAX_SIMULATION_STEPS,
  );
  let simulationSteps = 0;
  while (simulationAccumulator >= FIXED_TIME_STEP && simulationSteps < MAX_SIMULATION_STEPS) {
    updateGame(FIXED_TIME_STEP);
    simulationAccumulator -= FIXED_TIME_STEP;
    simulationSteps += 1;
  }
  updateAnimation(rawDelta);
  renderer.render(scene, camera);
  const sampledSnapshot = performanceMonitor.recordFrame(
    Math.max(rawDelta, 0.0001),
    renderer.info,
    getRuntimeEntityCounts(),
  );
  if (sampledSnapshot) {
    latestPerformanceSnapshot = sampledSnapshot;
    performanceMonitor.drainAlerts();
    sampleDynamicRenderScale(sampledSnapshot);
    updatePerformanceHud(sampledSnapshot);
  }
}

async function init() {
  const contentErrors = validateGameContent();
  if (contentErrors.length > 0) throw new Error(`Content validation failed:\n${contentErrors.join('\n')}`);
  settings = loadSettings();
  saveData = loadSave();
  game.selectedMissionId = getMissionById(saveData.campaign.lastMissionId)?.id ?? MISSIONS[0].id;
  game.stats = createRunStats();
  game.stability = 100;
  inputSystem = createInputSystem({
    pointerTarget: dom.canvas,
    settings,
    actionMap: {
      aimX: { mouse: null },
      aimY: { mouse: null },
      fire: { mouse: null },
      ammo1: { type: 'button', keyboard: ['Digit1'] },
      ammo2: { type: 'button', keyboard: ['Digit2'] },
      ammo3: { type: 'button', keyboard: ['Digit3'] },
    },
    onDeviceChange: ({ device }) => {
      if (game.phase !== 'loading') toast(device === 'gamepad' ? '手柄控制已启用' : '键鼠控制已启用', 'success');
    },
  });
  buildEnvironment();
  bindEvents();
  applyRuntimeSettings(settings);
  resize();
  updateAmmoUI();
  updateHUD();
  updateChargeUI();
  setGamePhase('loading');
  await loadCannonAsset();
  window.setTimeout(() => {
    showMainMenu();
  }, 260);
  installDebugApi();
  lastFrameTime = performance.now();
  requestAnimationFrame(renderLoop);
}

function installDebugApi() {
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  if (!isLocalHost) return;

  const debugApi = {
    getState: () => ({
      phase: game.phase,
      missionId: game.mission?.id ?? null,
      selectedMissionId: game.selectedMissionId,
      score: game.score,
      stability: game.stability,
      feeds: game.feeds,
      threatProgress: game.threatProgress,
      bossPhase: game.bossPhase,
      entities: getRuntimeEntityCounts(),
      graphics: getRuntimeGraphicsReport(),
      unlocked: MISSIONS.filter((mission) => isMissionUnlocked(mission.id, saveData)).map((mission) => mission.id),
    }),
    getPerformanceReport,
    getPoolStats: getRuntimePoolStats,
    runPoolStressTest,
    setPerformanceHud,
    resetPerformanceMonitor: () => {
      performanceAlertLog.length = 0;
      latestPerformanceSnapshot = null;
      dynamicResolutionController.reset();
      runtimeGraphics.lastDynamicDecision = null;
      return {
        performance: performanceMonitor.reset(),
        graphics: getRuntimeGraphicsReport(),
      };
    },
    sampleDynamicResolution: (metrics) => {
      const decision = sampleDynamicRenderScale({ metrics });
      return { decision, graphics: getRuntimeGraphicsReport() };
    },
    stressVisualEffects: (options = {}) => {
      if (game.phase !== 'playing') return { ok: false, reason: 'start a mission before visual stress' };
      const bursts = THREE.MathUtils.clamp(Math.trunc(Number(options.bursts) || 24), 1, 120);
      const particlesPerBurst = THREE.MathUtils.clamp(Math.trunc(Number(options.particlesPerBurst) || 18), 1, 64);
      const palette = [colors.slime, colors.orange, colors.cyan, 0xffcf62, 0xc76dff];
      for (let index = 0; index < bursts; index += 1) {
        const position = new THREE.Vector3(
          8 + (index % 8) * 1.8,
          0.4 + (index % 4) * 0.55,
          -6 + (index % 7) * 1.8,
        );
        createImpactParticles(position, palette[index % palette.length], particlesPerBurst);
        if (index % 3 === 0) addSplat(position, palette[index % palette.length]);
      }
      return { ok: true, bursts, particlesPerBurst, report: getPerformanceReport() };
    },
    startMission: (missionId) => {
      game.selectedMissionId = missionId;
      startMission(missionId);
    },
    completeMission: () => {
      if (game.phase !== 'playing') return false;
      const target = primaryTargetCounts();
      game.feeds = target.feeds;
      game.threatProgress = target.hazards;
      game.bossPhase = target.phases;
      game.score = Math.max(game.score, game.mission.ratingThresholds?.A ?? 5200);
      game.stats.shotsFired = Math.max(game.stats.shotsFired, 12);
      game.stats.shotsHit = Math.max(game.stats.shotsHit, 10);
      game.stats.bullseyes = Math.max(game.stats.bullseyes, 4);
      game.stats.maxCombo = Math.max(game.stats.maxCombo, 7);
      game.stats.adhesiveMultiFeeds = Math.max(game.stats.adhesiveMultiFeeds, 2);
      game.stats.hazardsNeutralized = Math.max(game.stats.hazardsNeutralized, target.hazards);
      game.stats.ricochetFeeds = Math.max(game.stats.ricochetFeeds, 4);
      game.stats.bossCoreMisses = 0;
      game.time = Math.max(game.time, Math.max(1, game.mission.timeLimitSeconds - 180));
      finishMission(true, '开发验收：主要目标完成');
      return true;
    },
    failMission: (reason = '开发验收：失败路径') => {
      if (game.phase !== 'playing') return false;
      finishMission(false, reason);
      return true;
    },
  };
  if (Object.isExtensible(window)) window.__SLOP_ZOO_DEBUG__ = debugApi;

  let debugOutput = document.getElementById('slop-zoo-debug-output');
  if (!debugOutput) {
    debugOutput = document.createElement('output');
    debugOutput.id = 'slop-zoo-debug-output';
    debugOutput.hidden = true;
    document.body.append(debugOutput);
  }
  let debugRequest = document.getElementById('slop-zoo-debug-request');
  if (!debugRequest) {
    debugRequest = document.createElement('textarea');
    debugRequest.id = 'slop-zoo-debug-request';
    document.body.append(debugRequest);
  }
  debugRequest.hidden = false;
  debugRequest.setAttribute('aria-hidden', 'true');
  debugRequest.tabIndex = -1;
  debugRequest.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  let debugRunButton = document.getElementById('slop-zoo-debug-run');
  if (!debugRunButton) {
    debugRunButton = document.createElement('button');
    debugRunButton.id = 'slop-zoo-debug-run';
    debugRunButton.type = 'button';
    debugRunButton.hidden = true;
    document.body.append(debugRunButton);
  }
  const writeDebugResult = (requestId, ok, value) => {
    debugOutput.textContent = JSON.stringify({ requestId, ok, value });
    debugOutput.dataset.requestId = String(requestId ?? '');
    window.dispatchEvent(new CustomEvent('slopzoo:debug-response', {
      detail: { requestId, ok },
    }));
  };
  const handleDebugRequest = (request = {}) => {
    const { requestId = '', action, args = [] } = request;
    try {
      if (typeof debugApi[action] !== 'function') throw new Error(`Unknown debug action: ${action}`);
      const result = debugApi[action](...(Array.isArray(args) ? args : [args]));
      if (result && typeof result.then === 'function') {
        result.then(
          (value) => writeDebugResult(requestId, true, value),
          (error) => writeDebugResult(requestId, false, { message: error?.message ?? String(error) }),
        );
      } else {
        writeDebugResult(requestId, true, result);
      }
    } catch (error) {
      writeDebugResult(requestId, false, { message: error?.message ?? String(error) });
    }
  };
  window.addEventListener('slopzoo:debug-request', (event) => handleDebugRequest(event.detail));
  debugRunButton.addEventListener('click', () => {
    try {
      handleDebugRequest(JSON.parse(debugRequest.value || '{}'));
    } catch (error) {
      writeDebugResult('', false, { message: error?.message ?? String(error) });
    }
  });
  debugRequest.addEventListener('input', () => debugRunButton.click());
  window.addEventListener('keydown', (event) => {
    if (event.repeat || !['F7', 'F8', 'F9'].includes(event.code)) return;
    event.preventDefault();
    if (event.code === 'F7') debugApi.setPerformanceHud(!performanceHudEnabled);
    else if (event.code === 'F8') debugApi.completeMission();
    else debugApi.failMission();
  });
}

init().catch((error) => {
  console.error(error);
  dom.loadingProgress.style.width = '100%';
  toast('初始化失败，请刷新后重试', 'danger');
});
