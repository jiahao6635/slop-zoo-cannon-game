/**
 * Data-only cannon appearance catalogue.
 *
 * Runtime code resolves asset URLs from these relative paths. Save migration
 * consumes only ids and default-unlock flags, keeping rendering concerns out of
 * the persistence layer.
 */

export const DEFAULT_CANNON_SKIN_ID = 'classic';

export const CANNON_SKINS = deepFreeze([
  {
    id: DEFAULT_CANNON_SKIN_ID,
    name: '经典补给型',
    label: 'CLASSIC ISSUE',
    description: '原型炮台的枪灰、黄铜与黏液能量涂装。',
    assetPath: 'assets/slop-cannon.glb',
    previewPath: 'assets/previews/slop-cannon-classic.jpg',
    icon: '补',
    unlockedByDefault: true,
    limited: false,
  },
  {
    id: 'dragon-new-year',
    name: '龙腾新春',
    label: 'LUNAR NEW YEAR // LIMITED',
    description: '朱漆、祥金与翠玉能量组成的龙年春节限定外观。',
    assetPath: 'assets/slop-cannon-dragon-new-year.glb',
    previewPath: 'assets/previews/slop-cannon-dragon-new-year.jpg',
    icon: '龙',
    unlockedByDefault: true,
    limited: true,
  },
  {
    id: 'bamboo-guardian',
    name: '翠竹守护',
    label: 'BAMBOO GUARDIAN',
    description: '墨绿竹甲、熊猫瓷饰与金色竹节组成的园区守护外观。',
    assetPath: 'assets/slop-cannon-bamboo-guardian.glb',
    previewPath: 'assets/previews/slop-cannon-bamboo-guardian.jpg',
    icon: '竹',
    unlockedByDefault: true,
    limited: false,
  },
  {
    id: 'abyssal-whale',
    name: '深海鲸歌',
    label: 'ABYSSAL WHALE',
    description: '深海蓝鲸装甲、珊瑚鳍翼与生物荧光泡群组成的海洋外观。',
    assetPath: 'assets/slop-cannon-abyssal-whale.glb',
    previewPath: 'assets/previews/slop-cannon-abyssal-whale.jpg',
    icon: '鲸',
    unlockedByDefault: true,
    limited: false,
  },
  {
    id: 'stellar-voyager',
    name: '星河巡游',
    label: 'STELLAR VOYAGER',
    description: '星云紫甲、银铬星环、太阳能翼板与跃迁光组成的宇宙探索外观。',
    assetPath: 'assets/slop-cannon-stellar-voyager.glb',
    previewPath: 'assets/previews/slop-cannon-stellar-voyager.jpg',
    icon: '星',
    unlockedByDefault: true,
    limited: false,
  },
]);

const cannonSkinById = new Map(CANNON_SKINS.map((skin) => [skin.id, skin]));

export function getCannonSkinById(id) {
  return cannonSkinById.get(id) ?? null;
}

export function getDefaultCannonSkinIds() {
  return CANNON_SKINS.filter((skin) => skin.unlockedByDefault).map((skin) => skin.id);
}

export function resolveCannonSkinId(id, unlockedIds = getDefaultCannonSkinIds()) {
  const unlocked = new Set(Array.isArray(unlockedIds) ? unlockedIds : []);
  if (cannonSkinById.has(id) && unlocked.has(id)) return id;
  if (unlocked.has(DEFAULT_CANNON_SKIN_ID)) return DEFAULT_CANNON_SKIN_ID;
  return CANNON_SKINS.find((skin) => unlocked.has(skin.id))?.id ?? DEFAULT_CANNON_SKIN_ID;
}

export function validateCannonSkins() {
  const errors = [];
  const ids = new Set();
  for (const skin of CANNON_SKINS) {
    if (!skin.id) errors.push('cannon skin without id');
    if (ids.has(skin.id)) errors.push(`duplicate cannon skin id ${skin.id}`);
    ids.add(skin.id);
    if (!skin.name) errors.push(`${skin.id}: name is required`);
    if (!skin.assetPath?.startsWith('assets/') || !skin.assetPath.endsWith('.glb')) {
      errors.push(`${skin.id}: assetPath must reference an assets/*.glb file`);
    }
    if (!skin.previewPath?.startsWith('assets/previews/') || !/\.(?:jpe?g|png|webp)$/i.test(skin.previewPath)) {
      errors.push(`${skin.id}: previewPath must reference an assets/previews image`);
    }
  }
  if (!cannonSkinById.has(DEFAULT_CANNON_SKIN_ID)) {
    errors.push(`default cannon skin ${DEFAULT_CANNON_SKIN_ID} is missing`);
  }
  return errors;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
