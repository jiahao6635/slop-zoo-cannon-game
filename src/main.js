import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GAME_DURATION = 75;
const MAX_AMMO = 5;
const GRAVITY = 9.8;
const STORAGE_KEY = 'slop-zoo-cannon-best';

const $ = (id) => document.getElementById(id);
const dom = {
  shell: $('game-shell'),
  canvas: $('game-canvas'),
  loading: $('loading-screen'),
  loadingProgress: $('loading-progress'),
  start: $('start-screen'),
  startButton: $('start-button'),
  hud: $('hud'),
  score: $('score-value'),
  combo: $('combo-value'),
  time: $('time-value'),
  wave: $('wave-value'),
  ammo: $('ammo-pips'),
  mission: $('mission-text'),
  pauseButton: $('pause-button'),
  charge: $('charge-meter'),
  crosshair: $('crosshair'),
  hitMarker: $('hit-marker'),
  gameOver: $('gameover-screen'),
  finalScore: $('final-score'),
  bestScore: $('best-score'),
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

const camera = new THREE.PerspectiveCamera(49, 1, 0.1, 120);
camera.position.set(-6.2, 5.4, 11.8);

let lastFrameTime = performance.now();
const pointer = {
  active: false,
  id: null,
  startX: 0,
  startY: 0,
  startYaw: 0,
  startPitch: 0,
};

const input = new Set();
const projectiles = [];
const targets = [];
const particles = [];
const splats = [];
const animatedProps = [];

const game = {
  phase: 'loading',
  score: 0,
  combo: 0,
  time: GAME_DURATION,
  wave: 1,
  ammo: MAX_AMMO,
  ammoTimer: 0,
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
let modelRecoilBase = new THREE.Vector3();

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
const targetPlateGeometry = new THREE.CylinderGeometry(0.88, 0.88, 0.18, 32);
const targetRingGeometry = new THREE.TorusGeometry(0.89, 0.075, 10, 32);
const eyeGeometry = new THREE.SphereGeometry(0.09, 16, 12);

const temp = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  d: new THREE.Vector3(),
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
  for (const x of [5.5, 11.5, 17.5, 23.5]) {
    addBox(environment, [0.28, 6.7, 0.32], [x, 3.35, -8.7], archMaterial);
    addBox(environment, [0.28, 6.7, 0.32], [x, 3.35, 8.7], archMaterial);
    addBox(environment, [0.28, 0.32, 17.7], [x, 6.62, 0], archMaterial);
  }

  const railMaterial = new THREE.MeshStandardMaterial({ color: colors.brass, roughness: 0.33, metalness: 0.8 });
  for (const z of [-2.2, 2.2]) {
    addCylinder(environment, 0.045, 4.3, [0, 0.85, z], railMaterial, [0, 0, Math.PI / 2], 12);
    for (const x of [-2, 0, 2]) {
      addCylinder(environment, 0.05, 1.45, [x, 0.72, z], railMaterial, [0, 0, 0], 12);
    }
  }

  addBox(environment, [4.8, 0.28, 4.8], [0, 0.13, 0], new THREE.MeshStandardMaterial({ color: 0xd9e1d8, roughness: 0.78 }));

  const pipeMaterial = new THREE.MeshStandardMaterial({ color: 0x356c69, roughness: 0.42, metalness: 0.58 });
  for (const y of [1.2, 1.75, 2.3]) {
    addCylinder(environment, 0.11, 28, [10, y, -9.95], pipeMaterial, [0, 0, Math.PI / 2], 18);
  }
  for (const x of [7, 14, 21]) {
    addCylinder(environment, 0.12, 4.5, [x, 2.3, -9.95], pipeMaterial, [0, 0, 0], 18);
  }

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
  for (const z of [-7.6, 0, 7.6]) {
    addBox(environment, [0.08, 4.8, 0.12], [25.18, 3.2, z], neonMaterial);
  }

  for (let i = 0; i < 7; i += 1) {
    const platform = new THREE.Group();
    const x = 13 + (i % 4) * 3.15;
    const z = -6.3 + Math.floor(i / 4) * 12.6 + (i % 2) * 0.8;
    addBox(platform, [1.5, 0.2, 1.5], [0, 0.1, 0], materials.darkMetal);
    addCylinder(platform, 0.14, 1 + (i % 3) * 0.35, [0, -0.45, 0], materials.brass);
    platform.position.set(x, 0.65 + (i % 3) * 0.35, z);
    environment.add(platform);
  }

  const fan = new THREE.Group();
  fan.position.set(25.1, 3.4, -6.2);
  fan.rotation.y = -Math.PI / 2;
  const hub = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 24), materials.brass, [0, 0, 0], [Math.PI / 2, 0, 0]);
  fan.add(hub);
  for (let i = 0; i < 4; i += 1) {
    const blade = addBox(fan, [0.18, 1.5, 0.12], [0, 0.78, 0], materials.darkMetal);
    blade.rotation.z = i * Math.PI / 2;
    blade.position.set(-Math.sin(blade.rotation.z) * 0.75, Math.cos(blade.rotation.z) * 0.75, 0);
  }
  environment.add(fan);
  animatedProps.push({ object: fan, type: 'fan' });

  const hemi = new THREE.HemisphereLight(0x9ee7dd, 0x071011, 1.75);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffedd1, 4.1);
  key.position.set(-5, 10, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 16;
  key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.0003;
  scene.add(key);

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

  modelYaw = yaw;
  modelPitch = pitch;
  modelRecoil = recoil;
  modelRecoilBase.copy(recoil.position);
  game.modelReady = true;
  return root;
}

function tuneBlenderMaterials(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) {
      if (!material) continue;
      if (/Gunmetal/i.test(material.name)) {
        material.metalness = 0.86;
        material.roughness = 0.22;
      }
      if (/Brass/i.test(material.name)) {
        material.metalness = 0.9;
        material.roughness = 0.23;
      }
      material.needsUpdate = true;
    }
  });
}

function loadCannonAsset() {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.load(
      `${import.meta.env.BASE_URL}assets/slop-cannon.glb`,
      (gltf) => {
        const root = gltf.scene;
        root.name = 'BlenderSlopCannon';
        tuneBlenderMaterials(root);
        cannonMount.add(root);
        modelYaw = root.getObjectByName('CannonYaw');
        modelPitch = root.getObjectByName('CannonPitch');
        modelRecoil = root.getObjectByName('CannonRecoil');
        if (!modelYaw || !modelPitch || !modelRecoil) {
          cannonMount.remove(root);
          createFallbackCannon();
          toast('Blender 素材层级缺失，已启用备用炮台', 'warning');
        } else {
          modelRecoilBase.copy(modelRecoil.position);
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

function createAnimalTarget(kind, hazard = false) {
  const group = new THREE.Group();
  group.name = hazard ? 'CleanerDroneTarget' : `${kind}Target`;

  const palette = {
    panda: 0xf0f4de,
    bunny: 0xffa6c6,
    bear: 0xe6a35d,
    frog: 0x67df7c,
  };
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: hazard ? colors.red : palette[kind],
    roughness: 0.5,
    metalness: hazard ? 0.55 : 0.02,
    emissive: hazard ? 0x3f050b : 0x000000,
    emissiveIntensity: hazard ? 0.8 : 0,
  });
  const rimMaterial = hazard ? materials.hazard : materials.brass;
  const plateMaterial = new THREE.MeshStandardMaterial({ color: hazard ? 0x34181c : 0x203b3c, roughness: 0.55, metalness: 0.5 });

  const plate = mesh(targetPlateGeometry, plateMaterial, [0, 0, 0], [0, 0, Math.PI / 2]);
  const ring = mesh(targetRingGeometry, rimMaterial, [-0.11, 0, 0], [0, Math.PI / 2, 0]);
  group.add(plate, ring);

  if (hazard) {
    const core = mesh(new THREE.OctahedronGeometry(0.52, 1), faceMaterial, [-0.2, 0, 0]);
    group.add(core);
    for (const z of [-0.47, 0.47]) {
      const rotor = mesh(new THREE.BoxGeometry(0.1, 0.85, 0.18), materials.darkMetal, [-0.18, 0, z]);
      group.add(rotor);
    }
    const eye = mesh(new THREE.SphereGeometry(0.12, 16, 12), materials.hazard, [-0.62, 0, 0]);
    group.add(eye);
  } else {
    const face = mesh(new THREE.SphereGeometry(0.58, 24, 18), faceMaterial, [-0.2, 0, 0]);
    face.scale.x = 0.34;
    group.add(face);

    const dark = new THREE.MeshStandardMaterial({ color: 0x172123, roughness: 0.65 });
    const leftEye = mesh(eyeGeometry, dark, [-0.43, 0.13, -0.21]);
    const rightEye = mesh(eyeGeometry, dark, [-0.43, 0.13, 0.21]);
    const nose = mesh(new THREE.SphereGeometry(0.08, 14, 10), dark, [-0.48, -0.08, 0]);
    group.add(leftEye, rightEye, nose);

    if (kind === 'bunny') {
      for (const z of [-0.27, 0.27]) {
        const ear = mesh(new THREE.SphereGeometry(0.19, 18, 12), faceMaterial, [-0.18, 0.72, z]);
        ear.scale.set(0.42, 1.8, 0.82);
        group.add(ear);
      }
    } else if (kind === 'frog') {
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

    if (kind === 'panda') {
      for (const z of [-0.21, 0.21]) {
        const patch = mesh(new THREE.SphereGeometry(0.16, 16, 10), dark, [-0.47, 0.13, z]);
        patch.scale.set(0.4, 1.2, 1.25);
        group.add(patch);
      }
    }
  }

  const stem = addCylinder(group, 0.09, 1.45, [0.12, -1.52, 0], materials.darkMetal);
  stem.castShadow = true;
  addBox(group, [0.6, 0.15, 1.1], [0.12, -2.25, 0], materials.brass);

  return group;
}

function chooseTargetPosition() {
  const wave = game.wave;
  const x = THREE.MathUtils.randFloat(13.5, wave === 1 ? 19 : 23);
  const z = THREE.MathUtils.randFloat(-7.2, 7.2);
  const y = THREE.MathUtils.randFloat(2.2, wave === 1 ? 3.7 : 5.1);
  return new THREE.Vector3(x, y, z);
}

function spawnTarget(forceGood = false) {
  const kinds = ['panda', 'bunny', 'bear', 'frog'];
  const hazardChance = game.wave === 1 ? 0 : game.wave === 2 ? 0.12 : 0.24;
  const hazard = !forceGood && Math.random() < hazardChance;
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const group = createAnimalTarget(kind, hazard);
  const base = chooseTargetPosition();
  group.position.copy(base);
  group.rotation.y = 0;
  scene.add(group);

  targets.push({
    group,
    base,
    kind,
    hazard,
    radius: hazard ? 0.86 : 1.02,
    phase: Math.random() * Math.PI * 2,
    speed: THREE.MathUtils.randFloat(0.65, 1.15) * (1 + game.wave * 0.12),
    amplitude: game.wave === 1 ? 0.35 : THREE.MathUtils.randFloat(0.75, 1.8),
    age: 0,
    lifetime: THREE.MathUtils.randFloat(8, 12),
    value: hazard ? -250 : Math.round(100 + base.x * 5 + base.y * 12),
  });
}

function removeObject(object) {
  if (object?.parent) object.parent.remove(object);
}

function removeTarget(target) {
  const index = targets.indexOf(target);
  if (index >= 0) targets.splice(index, 1);
  removeObject(target.group);
}

function clearRoundObjects() {
  for (const projectile of projectiles.splice(0)) removeObject(projectile.mesh);
  for (const target of targets.splice(0)) removeObject(target.group);
  for (const particle of particles.splice(0)) removeObject(particle.mesh);
  for (const splat of splats.splice(0)) removeObject(splat.mesh);
}

function currentShotPower() {
  return 15 + (game.charging ? game.charge : 0.48) * 8.5;
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

function getMuzzleState(position, direction) {
  logicalMuzzle.getWorldPosition(position);
  logicalMuzzle.getWorldQuaternion(temp.quaternion);
  direction.set(1, 0, 0).applyQuaternion(temp.quaternion).normalize();
}

function startCharge() {
  if (game.phase !== 'playing' || game.ammo <= 0) return;
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
  if (game.ammo <= 0 || now - game.lastShotAt < 0.22) {
    if (game.ammo <= 0) toast('黏液罐正在补充', 'warning');
    return;
  }

  game.lastShotAt = now;
  game.ammo -= 1;
  game.recoil = 1;
  game.shake = 0.22;
  updateAmmoUI();

  const position = new THREE.Vector3();
  const direction = new THREE.Vector3();
  getMuzzleState(position, direction);

  const projectileMesh = new THREE.Group();
  const core = mesh(projectileGeometry, materials.slime);
  core.scale.set(1.18, 0.9, 0.9);
  projectileMesh.add(core);
  const tail = mesh(dropletGeometry, materials.slime, [-0.36, 0, 0]);
  tail.scale.set(2.1, 0.85, 0.85);
  projectileMesh.add(tail);
  projectileMesh.position.copy(position);
  scene.add(projectileMesh);

  projectiles.push({
    mesh: projectileMesh,
    position: position.clone(),
    previous: position.clone(),
    velocity: direction.multiplyScalar(speed),
    radius: 0.29,
    age: 0,
  });

  muzzleBurst(position, direction);
  playShotSound(speed);
}

function muzzleBurst(position, direction) {
  for (let i = 0; i < 7; i += 1) {
    const drop = mesh(dropletGeometry, materials.slime);
    drop.scale.setScalar(THREE.MathUtils.randFloat(0.45, 1.1));
    drop.position.copy(position);
    scene.add(drop);
    const velocity = direction.clone().multiplyScalar(THREE.MathUtils.randFloat(2.5, 5.5));
    velocity.x += THREE.MathUtils.randFloatSpread(1.4);
    velocity.y += THREE.MathUtils.randFloatSpread(1.4);
    velocity.z += THREE.MathUtils.randFloatSpread(1.4);
    particles.push({ mesh: drop, velocity, life: THREE.MathUtils.randFloat(0.3, 0.62), age: 0, gravity: 4.5 });
  }
}

function segmentSphereHit(a, b, center, radius) {
  const segment = temp.c.copy(b).sub(a);
  const lengthSq = segment.lengthSq();
  if (lengthSq === 0) return a.distanceToSquared(center) <= radius * radius;
  const t = THREE.MathUtils.clamp(temp.d.copy(center).sub(a).dot(segment) / lengthSq, 0, 1);
  temp.d.copy(a).addScaledVector(segment, t);
  return temp.d.distanceToSquared(center) <= radius * radius;
}

function hitTarget(target, projectile) {
  const hitPosition = projectile.position.clone();
  removeObject(projectile.mesh);
  const projectileIndex = projectiles.indexOf(projectile);
  if (projectileIndex >= 0) projectiles.splice(projectileIndex, 1);

  if (target.hazard) {
    game.score = Math.max(0, game.score + target.value);
    game.combo = 0;
    toast('误中清洁无人机 · -250', 'danger');
    playHazardSound();
    createImpactParticles(hitPosition, colors.red, 18);
  } else {
    game.combo += 1;
    const multiplier = 1 + Math.min(game.combo - 1, 10) * 0.15;
    const points = Math.round(target.value * multiplier);
    game.score += points;
    toast(`${target.kind.toUpperCase()} 已补给 · +${points}`, 'success');
    playHitSound(game.combo);
    createImpactParticles(hitPosition, colors.slime, 16 + Math.min(game.combo, 8));
  }

  pulseHitMarker(target.hazard);
  addSplat(hitPosition, target.hazard ? colors.red : colors.slime);
  removeTarget(target);
  updateHUD();
}

function createImpactParticles(position, color, count) {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.75,
    roughness: 0.32,
  });
  for (let i = 0; i < count; i += 1) {
    const drop = mesh(dropletGeometry, material);
    drop.scale.setScalar(THREE.MathUtils.randFloat(0.5, 1.55));
    drop.position.copy(position);
    scene.add(drop);
    const velocity = new THREE.Vector3(
      THREE.MathUtils.randFloat(-2.5, 1.5),
      THREE.MathUtils.randFloat(1.2, 5.8),
      THREE.MathUtils.randFloatSpread(5.2),
    );
    particles.push({ mesh: drop, velocity, life: THREE.MathUtils.randFloat(0.55, 1.2), age: 0, gravity: 8 });
  }
}

function addSplat(position, color = colors.slime) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.66,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const splat = mesh(new THREE.CircleGeometry(THREE.MathUtils.randFloat(0.34, 0.7), 18), material);
  splat.position.copy(position);
  splat.position.y = 0.025;
  splat.rotation.x = -Math.PI / 2;
  splat.rotation.z = Math.random() * Math.PI;
  splat.scale.y = THREE.MathUtils.randFloat(0.55, 1.15);
  splat.castShadow = false;
  splat.receiveShadow = false;
  scene.add(splat);
  splats.push({ mesh: splat, age: 0, life: 8 });
  if (splats.length > 24) {
    const old = splats.shift();
    removeObject(old.mesh);
  }
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
    projectile.age += dt;
    projectile.previous.copy(projectile.position);
    projectile.velocity.y -= GRAVITY * dt;
    projectile.position.addScaledVector(projectile.velocity, dt);
    projectile.mesh.position.copy(projectile.position);
    projectile.mesh.rotation.z -= dt * 5;

    const velocityLength = projectile.velocity.length();
    if (velocityLength > 0.01) {
      temp.a.copy(projectile.velocity).normalize();
      projectile.mesh.quaternion.setFromUnitVectors(temp.b.set(1, 0, 0), temp.a);
    }

    let collided = false;
    for (const target of [...targets]) {
      target.group.getWorldPosition(temp.a);
      if (segmentSphereHit(projectile.previous, projectile.position, temp.a, target.radius + projectile.radius)) {
        hitTarget(target, projectile);
        collided = true;
        break;
      }
    }
    if (collided) continue;

    if (projectile.position.y <= 0.06 || projectile.position.x > 27 || Math.abs(projectile.position.z) > 12 || projectile.age > 5) {
      if (projectile.position.y <= 0.2) {
        projectile.position.y = 0.025;
        addSplat(projectile.position);
        createImpactParticles(projectile.position, colors.slimeDark, 5);
        playMissSound();
      }
      removeObject(projectile.mesh);
      projectiles.splice(i, 1);
      game.combo = 0;
      updateHUD();
    }
  }
}

function updateTargets(dt) {
  for (const target of [...targets]) {
    target.age += dt;
    const motion = Math.sin(target.age * target.speed + target.phase);
    const bob = Math.sin(target.age * 2.2 + target.phase) * 0.16;
    target.group.position.copy(target.base);
    target.group.position.z += motion * target.amplitude;
    target.group.position.y += bob;
    target.group.rotation.x = Math.sin(target.age * 1.5 + target.phase) * 0.04;
    target.group.rotation.z = target.hazard ? target.age * 0.8 : 0;

    if (target.age > target.lifetime) removeTarget(target);
  }
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
      removeObject(particle.mesh);
      particles.splice(i, 1);
    }
  }

  for (let i = splats.length - 1; i >= 0; i -= 1) {
    const splat = splats[i];
    splat.age += dt;
    if (splat.age > splat.life - 2) splat.mesh.material.opacity = Math.max(0, (splat.life - splat.age) / 2 * 0.66);
    if (splat.age >= splat.life) {
      removeObject(splat.mesh);
      splats.splice(i, 1);
    }
  }
}

function updateTrajectory() {
  const start = new THREE.Vector3();
  const direction = new THREE.Vector3();
  getMuzzleState(start, direction);
  const velocity = direction.multiplyScalar(currentShotPower());
  const point = new THREE.Vector3();
  let used = 42;
  let crosshairPoint = null;

  for (let i = 0; i < 42; i += 1) {
    const t = i * 0.055;
    point.copy(start).addScaledVector(velocity, t);
    point.y -= 0.5 * GRAVITY * t * t;
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
  trajectory.visible = game.phase === 'playing';
  updateCrosshair(crosshairPoint);
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

function waveForTime(time) {
  if (time > 50) return 1;
  if (time > 25) return 2;
  return 3;
}

function updateGame(dt) {
  if (game.phase !== 'playing') return;
  game.elapsed += dt;
  game.time = Math.max(0, game.time - dt);
  const nextWave = waveForTime(game.time);
  if (nextWave !== game.wave) {
    game.wave = nextWave;
    toast(nextWave === 2 ? '第二波：移动饲喂靶出现' : '最终波：清洁无人机混入', 'warning');
    updateMission();
  }

  if (game.charging) {
    game.charge += dt * 0.85 * game.chargeDirection;
    if (game.charge >= 1) {
      game.charge = 1;
      game.chargeDirection = -1;
    } else if (game.charge <= 0.18) {
      game.charge = 0.18;
      game.chargeDirection = 1;
    }
    updateChargeUI();
  }

  const aimSpeed = 0.52;
  if (input.has('ArrowLeft') || input.has('KeyA')) game.yaw -= aimSpeed * dt;
  if (input.has('ArrowRight') || input.has('KeyD')) game.yaw += aimSpeed * dt;
  if (input.has('ArrowUp') || input.has('KeyW')) game.pitch += aimSpeed * dt;
  if (input.has('ArrowDown') || input.has('KeyS')) game.pitch -= aimSpeed * dt;
  game.yaw = THREE.MathUtils.clamp(game.yaw, -0.48, 0.48);
  game.pitch = THREE.MathUtils.clamp(game.pitch, 0.035, 0.57);

  if (game.ammo < MAX_AMMO) {
    game.ammoTimer += dt;
    if (game.ammoTimer >= 1.18) {
      game.ammo += 1;
      game.ammoTimer = 0;
      updateAmmoUI();
    }
  } else {
    game.ammoTimer = 0;
  }

  game.spawnTimer -= dt;
  const spawnInterval = game.wave === 1 ? 1.9 : game.wave === 2 ? 1.48 : 1.15;
  const maxTargets = game.wave === 1 ? 6 : game.wave === 2 ? 8 : 10;
  if (game.spawnTimer <= 0 && targets.length < maxTargets) {
    spawnTarget();
    game.spawnTimer = spawnInterval * THREE.MathUtils.randFloat(0.75, 1.2);
  }

  updateTargets(dt);
  updateProjectiles(dt);
  updateParticles(dt);
  updateHUD();

  if (game.time <= 0) endGame();
}

function updateAnimation(dt) {
  game.recoil = THREE.MathUtils.damp(game.recoil, 0, 13, dt);
  game.shake = THREE.MathUtils.damp(game.shake, 0, 10, dt);
  updateAimRigs();

  for (const prop of animatedProps) {
    if (prop.type === 'fan') prop.object.rotation.x += dt * 1.45;
  }

  const desiredPosition = temp.a.set(-6.2, 5.4, 11.8 + game.yaw * 2.3);
  if (game.shake > 0.002) {
    desiredPosition.x += THREE.MathUtils.randFloatSpread(game.shake);
    desiredPosition.y += THREE.MathUtils.randFloatSpread(game.shake);
    desiredPosition.z += THREE.MathUtils.randFloatSpread(game.shake);
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
  dom.wave.textContent = `${game.wave} / 3`;
}

function updateAmmoUI() {
  if (!dom.ammo) return;
  dom.ammo.innerHTML = '';
  for (let i = 0; i < MAX_AMMO; i += 1) {
    const pip = document.createElement('span');
    pip.className = i < game.ammo ? 'ammo-pip is-loaded' : 'ammo-pip is-spent';
    pip.setAttribute('aria-hidden', 'true');
    dom.ammo.appendChild(pip);
  }
  dom.ammo.setAttribute('aria-label', `黏液弹药 ${game.ammo}/${MAX_AMMO}`);
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
  const messages = {
    1: '校准炮台：命中动物饲喂靶',
    2: '追踪移动靶：保持连击提高分数',
    3: '最终波：避开红色清洁无人机',
  };
  dom.mission.textContent = messages[game.wave];
}

function setVisible(element, visible) {
  if (!element) return;
  element.hidden = !visible;
}

function startGame() {
  clearRoundObjects();
  Object.assign(game, {
    phase: 'playing',
    score: 0,
    combo: 0,
    time: GAME_DURATION,
    wave: 1,
    ammo: MAX_AMMO,
    ammoTimer: 0,
    spawnTimer: 1.4,
    yaw: 0,
    pitch: 0.2,
    charging: false,
    charge: 0,
    elapsed: 0,
  });
  setVisible(dom.start, false);
  setVisible(dom.gameOver, false);
  setVisible(dom.hud, true);
  setVisible(dom.fireButton, true);
  dom.pauseButton.setAttribute('aria-label', '暂停游戏');
  dom.pauseButton.title = '暂停';
  for (let i = 0; i < 5; i += 1) spawnTarget(true);
  updateMission();
  updateAmmoUI();
  updateChargeUI();
  updateHUD();
  ensureAudio();
  toast('拖动瞄准 · 松开发射 · 长按蓄力', 'success');
}

function endGame() {
  game.phase = 'gameover';
  game.charging = false;
  const previousBest = Number(localStorage.getItem(STORAGE_KEY) || 0);
  const best = Math.max(previousBest, Math.round(game.score));
  localStorage.setItem(STORAGE_KEY, String(best));
  dom.finalScore.textContent = Math.round(game.score).toLocaleString('zh-CN');
  dom.bestScore.textContent = best.toLocaleString('zh-CN');
  setVisible(dom.gameOver, true);
  setVisible(dom.fireButton, false);
  dom.crosshair.hidden = true;
  trajectory.visible = false;
  playEndSound(game.score >= previousBest && game.score > 0);
}

function togglePause() {
  if (game.phase === 'playing') {
    game.phase = 'paused';
    dom.pauseButton.setAttribute('aria-label', '继续游戏');
    dom.pauseButton.title = '继续';
    toast('实验暂停', 'warning');
  } else if (game.phase === 'paused') {
    game.phase = 'playing';
    dom.pauseButton.setAttribute('aria-label', '暂停游戏');
    dom.pauseButton.title = '暂停';
    lastFrameTime = performance.now();
    toast('实验继续', 'success');
  }
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
  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const volume = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  volume.gain.setValueAtTime(gain, start);
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

function bindEvents() {
  dom.startButton.addEventListener('click', startGame);
  dom.restartButton.addEventListener('click', startGame);
  dom.pauseButton.addEventListener('click', togglePause);
  dom.canvas.addEventListener('pointerdown', onCanvasPointerDown);
  dom.canvas.addEventListener('pointermove', onCanvasPointerMove);
  dom.canvas.addEventListener('pointerup', onCanvasPointerUp);
  dom.canvas.addEventListener('pointercancel', onCanvasPointerUp);
  dom.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

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
    input.add(event.code);
    if (event.code === 'Space' && !event.repeat) startCharge();
    if ((event.code === 'Escape' || event.code === 'KeyP') && !event.repeat) togglePause();
  });
  window.addEventListener('keyup', (event) => {
    input.delete(event.code);
    if (event.code === 'Space') releaseShot();
  });
  window.addEventListener('blur', () => {
    input.clear();
    if (game.phase === 'playing') togglePause();
  });
  window.addEventListener('resize', resize);
}

function resize() {
  const rect = dom.shell.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function renderLoop(now) {
  requestAnimationFrame(renderLoop);
  const rawDelta = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  updateGame(rawDelta);
  updateAnimation(rawDelta);
  renderer.render(scene, camera);
}

async function init() {
  buildEnvironment();
  bindEvents();
  resize();
  updateAmmoUI();
  updateHUD();
  updateChargeUI();
  setVisible(dom.start, false);
  setVisible(dom.hud, false);
  setVisible(dom.gameOver, false);
  setVisible(dom.fireButton, false);
  await loadCannonAsset();
  game.phase = 'intro';
  window.setTimeout(() => {
    setVisible(dom.loading, false);
    setVisible(dom.start, true);
  }, 260);
  lastFrameTime = performance.now();
  requestAnimationFrame(renderLoop);
}

init().catch((error) => {
  console.error(error);
  dom.loadingProgress.style.width = '100%';
  toast('初始化失败，请刷新后重试', 'danger');
});
