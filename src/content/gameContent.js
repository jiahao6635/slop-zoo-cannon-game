/**
 * Sector 07 vertical-slice content.
 *
 * Keep this module data-only: gameplay systems may consume these definitions,
 * but content must never depend on renderer or DOM state.
 */

export const CONTENT_VERSION = 'sector-07-v1';
export const SECTOR_ID = 'sector-07';
export const RATING_ORDER = Object.freeze(['C', 'B', 'A', 'S']);

export const RATING_DEFINITIONS = deepFreeze({
  C: { label: '合格', color: '#a7c2b5', description: '完成主要任务' },
  B: { label: '稳定', color: '#75d7c8', description: '稳定完成且减少浪费' },
  A: { label: '优秀', color: '#f0c45c', description: '达到本关技术目标' },
  S: { label: '完美照护', color: '#ff8b62', description: '高效完成并达成特殊条件' },
});

export const AMMO_TYPES = deepFreeze([
  {
    id: 'nutrient-gel',
    name: '营养凝胶弹',
    shortName: '营养',
    color: '#79ff9a',
    unlockedByDefault: true,
    description: '稳定的单体补给弹，适合精准命中与维持连击。',
    role: 'precision',
    secondaryAction: null,
    inventory: { capacity: 5, starting: 5, rechargeSeconds: 4.2 },
    projectile: {
      speedMultiplier: 1,
      gravityMultiplier: 1,
      radius: 0.3,
      directFeed: 1,
      splashRadius: 0,
      bounceCount: 0,
    },
    perfectHit: { reloadProgress: 0.5, scoreMultiplier: 1.25 },
    counters: [],
  },
  {
    id: 'adhesive-bloom',
    name: '黏附花苞弹',
    shortName: '黏附',
    color: '#ffcf62',
    unlockedByDefault: false,
    description: '粘在场景或机械上预埋，再手动引爆为周围目标补给。',
    role: 'control',
    secondaryAction: 'detonate',
    inventory: { capacity: 3, starting: 2, rechargeSeconds: null },
    projectile: {
      speedMultiplier: 0.78,
      gravityMultiplier: 1.08,
      radius: 0.34,
      directFeed: 0.8,
      splashRadius: 2.4,
      armDelaySeconds: 0.35,
      lifetimeSeconds: 12,
    },
    perfectHit: { splashRadiusMultiplier: 1.2, scoreMultiplier: 1.2 },
    counters: ['cleaner-drone', 'snack-thief'],
  },
  {
    id: 'bounce-bubble',
    name: '弹力泡胶',
    shortName: '弹力',
    color: '#62dfff',
    unlockedByDefault: false,
    description: '可在反弹板和地面弹跳，用来绕过挡板或命中遮挡后的目标。',
    role: 'ricochet',
    secondaryAction: 'burst',
    inventory: { capacity: 4, starting: 3, rechargeSeconds: null },
    projectile: {
      speedMultiplier: 1.08,
      gravityMultiplier: 0.88,
      radius: 0.28,
      directFeed: 0.72,
      splashRadius: 1.1,
      bounceCount: 3,
      restitution: 0.82,
    },
    perfectHit: { bounceScorePerSurface: 180, scoreMultiplier: 1.15 },
    counters: ['barrier-drone'],
  },
]);

export const HAZARD_TYPES = deepFreeze([
  {
    id: 'cleaner-drone',
    name: '清洁无人机',
    category: 'avoid',
    description: '巡逻线路上的清洁机。营养弹误中会中断连击，黏附弹可令其暂停。',
    telegraph: { color: '#ff5d67', icon: 'no-feed', warningSeconds: 0.8 },
    behavior: { pattern: 'patrol', speed: 2.4, activeSeconds: 9 },
    penalty: { score: 250, stability: 8, breaksCombo: true },
    counters: [{ ammoId: 'adhesive-bloom', effect: 'disable', durationSeconds: 5 }],
  },
  {
    id: 'snack-thief',
    name: '偷食无人机',
    category: 'interceptor',
    description: '锁定飞行中的补给并尝试拦截，需要抢先制服或改变弹道。',
    telegraph: { color: '#ff934f', icon: 'intercept', warningSeconds: 1.2 },
    behavior: { pattern: 'intercept-projectile', speed: 4.3, cooldownSeconds: 3.5 },
    penalty: { score: 120, stability: 5, consumesProjectile: true },
    counters: [
      { ammoId: 'adhesive-bloom', effect: 'snare', durationSeconds: 6 },
      { ammoId: 'bounce-bubble', effect: 'stun', durationSeconds: 2.5 },
    ],
  },
  {
    id: 'barrier-drone',
    name: '屏障无人机',
    category: 'protector',
    description: '在附近动物前生成移动屏障，需高抛、反弹或命中发生器。',
    telegraph: { color: '#d66cff', icon: 'shield', warningSeconds: 1 },
    behavior: { pattern: 'escort-target', speed: 1.6, shieldRadius: 2.2 },
    penalty: { score: 80, deflectsProjectile: true },
    counters: [
      { ammoId: 'bounce-bubble', effect: 'bypass' },
      { ammoId: 'adhesive-bloom', effect: 'overload', durationSeconds: 4 },
    ],
  },
]);

export const MODULES = deepFreeze([
  {
    id: 'pressure-stabilizer',
    name: '稳压器',
    slot: 'barrel',
    unlockedByDefault: true,
    description: '蓄力变化速度降低 28%，便于停在精准力度。',
    effects: { chargeRateMultiplier: 0.72, perfectWindowMultiplier: 1.18 },
  },
  {
    id: 'fermenting-muzzle',
    name: '发酵炮口',
    slot: 'barrel',
    unlockedByDefault: false,
    description: '未命中危险物的落地弹形成短暂补给区。',
    effects: { createsFeedZone: true, feedZoneRadius: 1.5, feedZoneSeconds: 2.8 },
  },
  {
    id: 'combo-capacitor',
    name: '组合电容',
    slot: 'magazine',
    unlockedByDefault: false,
    description: '连续五次有效补给恢复一发当前特殊弹。',
    effects: { hitsPerSpecialAmmo: 5, maxTriggersPerMission: 4 },
  },
  {
    id: 'quick-loader',
    name: '快速装填器',
    slot: 'magazine',
    unlockedByDefault: false,
    description: '营养弹容量减少一发，但靶心命中立即补回一发。',
    effects: { nutrientCapacityDelta: -1, bullseyeRefund: 1 },
  },
  {
    id: 'magnetic-guidance',
    name: '磁性引导',
    slot: 'targeting',
    unlockedByDefault: false,
    description: '弹丸擦过需求目标时提供轻微修正，不会穿过遮挡。',
    effects: { aimAssistRadius: 0.42, maxCorrectionDegrees: 3.5 },
  },
  {
    id: 'ricochet-mapper',
    name: '反弹测绘',
    slot: 'targeting',
    unlockedByDefault: false,
    description: '显示第一次反弹后的短预测线，并标记有效反弹面。',
    effects: { ricochetPreviewSeconds: 0.9, highlightBounceSurfaces: true },
  },
]);

export const MISSIONS = deepFreeze([
  {
    id: 'sector-07-01',
    sectorId: SECTOR_ID,
    order: 1,
    missionType: 'tutorial',
    name: '炮台资格考核',
    subtitle: '瞄准、蓄力与连击',
    seed: 7001,
    timeLimitSeconds: 150,
    estimatedMinutes: 4,
    availableAmmo: ['nutrient-gel'],
    defaultLoadout: { ammo: ['nutrient-gel'], module: 'pressure-stabilizer' },
    briefing: '恢复七号补给区的基础投喂线，为熊猫和兔子完成 10 份补给。',
    animals: ['panda', 'rabbit'],
    hazards: [],
    mechanics: ['aim', 'charge', 'combo', 'stability'],
    objectives: {
      primary: { type: 'feed-quota', target: 10, minimumStability: 1 },
      technical: { metric: 'accuracy', gte: 0.65, label: '命中率达到 65%' },
      special: { metric: 'bullseyes', gte: 3, label: '完成 3 次靶心命中' },
    },
    encounters: [
      { id: 'aiming', startAt: 0, duration: 45, spawn: { panda: 3 }, maxConcurrent: 1 },
      { id: 'moving-targets', startAt: 45, duration: 50, spawn: { panda: 2, rabbit: 3 }, maxConcurrent: 2 },
      { id: 'qualification', startAt: 95, duration: 55, spawn: { panda: 3, rabbit: 4 }, maxConcurrent: 3 },
    ],
    ratingThresholds: { C: 0, B: 900, A: 1450, S: 2050 },
    rewards: {
      completion: { credits: 120, unlocks: { ammo: ['adhesive-bloom'], modules: ['fermenting-muzzle'] } },
      ratingBonuses: { C: 0, B: 30, A: 70, S: 130 },
      medals: medalRewards(
        '通过资格考核',
        '命中率达到 65%',
        '完成 3 次靶心命中',
      ),
    },
  },
  {
    id: 'sector-07-02',
    sectorId: SECTOR_ID,
    order: 2,
    missionType: 'quota',
    name: '传送带早餐',
    subtitle: '定额补给与黏附预埋',
    seed: 7002,
    timeLimitSeconds: 180,
    estimatedMinutes: 5,
    availableAmmo: ['nutrient-gel', 'adhesive-bloom'],
    defaultLoadout: { ammo: ['nutrient-gel', 'adhesive-bloom'], module: 'fermenting-muzzle' },
    briefing: '在传送带分流窗口关闭前完成 16 份补给，利用黏附花苞同时照护拥挤目标。',
    animals: ['panda', 'rabbit', 'frog'],
    hazards: [],
    mechanics: ['conveyor', 'moving-gate', 'adhesive-detonation'],
    objectives: {
      primary: { type: 'feed-quota', target: 16, minimumStability: 1 },
      technical: { metric: 'maxCombo', gte: 6, label: '达成 6 连击' },
      special: { metric: 'adhesiveMultiFeeds', gte: 2, label: '两次黏附引爆各补给至少 2 只动物' },
    },
    encounters: [
      { id: 'belt-basics', startAt: 0, duration: 55, spawn: { panda: 3, rabbit: 3 }, maxConcurrent: 2 },
      { id: 'gate-windows', startAt: 55, duration: 60, spawn: { panda: 2, rabbit: 4, frog: 2 }, maxConcurrent: 3 },
      { id: 'breakfast-rush', startAt: 115, duration: 65, spawn: { panda: 3, rabbit: 4, frog: 3 }, maxConcurrent: 4 },
    ],
    ratingThresholds: { C: 0, B: 1800, A: 2700, S: 3650 },
    rewards: {
      completion: { credits: 170, unlocks: { ammo: ['bounce-bubble'], modules: ['combo-capacitor'] } },
      ratingBonuses: { C: 0, B: 45, A: 95, S: 170 },
      medals: medalRewards(
        '完成早餐配额',
        '达成 6 连击',
        '两次黏附引爆各补给至少 2 只动物',
      ),
    },
  },
  {
    id: 'sector-07-03',
    sectorId: SECTOR_ID,
    order: 3,
    missionType: 'threat',
    name: '红色警戒线',
    subtitle: '识别危险与制造投喂窗口',
    seed: 7003,
    timeLimitSeconds: 210,
    estimatedMinutes: 6,
    availableAmmo: ['nutrient-gel', 'adhesive-bloom', 'bounce-bubble'],
    defaultLoadout: { ammo: ['nutrient-gel', 'adhesive-bloom', 'bounce-bubble'], module: 'combo-capacitor' },
    briefing: '清洁程序已经失控。避免误击清洁无人机，同时制服偷食与屏障单元。',
    animals: ['panda', 'rabbit', 'frog'],
    hazards: ['cleaner-drone', 'snack-thief', 'barrier-drone'],
    mechanics: ['hazard-priority', 'interception', 'shield-bypass'],
    objectives: {
      primary: { type: 'threat-shift', feedTarget: 14, neutralizeTarget: 5, minimumStability: 1 },
      technical: { metric: 'hazardsNeutralized', gte: 5, label: '制服 5 个主动危险' },
      special: { metric: 'cleanerDroneHits', lte: 0, label: '不误击清洁无人机' },
    },
    encounters: [
      { id: 'cleaner-patrol', startAt: 0, duration: 60, spawn: { panda: 3, rabbit: 3, 'cleaner-drone': 3 }, maxConcurrent: 3 },
      { id: 'thief-intercept', startAt: 60, duration: 70, spawn: { frog: 3, rabbit: 3, 'snack-thief': 3 }, maxConcurrent: 4 },
      { id: 'shield-lockdown', startAt: 130, duration: 80, spawn: { panda: 2, frog: 3, 'barrier-drone': 3, 'cleaner-drone': 2 }, maxConcurrent: 5 },
    ],
    ratingThresholds: { C: 0, B: 2350, A: 3450, S: 4700 },
    rewards: {
      completion: { credits: 220, unlocks: { ammo: [], modules: ['quick-loader'] } },
      ratingBonuses: { C: 0, B: 60, A: 125, S: 220 },
      medals: medalRewards(
        '恢复警戒线供给',
        '制服 5 个主动危险',
        '全程不误击清洁无人机',
      ),
    },
  },
  {
    id: 'sector-07-04',
    sectorId: SECTOR_ID,
    order: 4,
    missionType: 'limited-ammo',
    name: '零浪费调度',
    subtitle: '有限弹药与反弹路线',
    seed: 7004,
    timeLimitSeconds: 240,
    estimatedMinutes: 6,
    availableAmmo: ['nutrient-gel', 'adhesive-bloom', 'bounce-bubble'],
    defaultLoadout: { ammo: ['nutrient-gel', 'adhesive-bloom', 'bounce-bubble'], module: 'quick-loader' },
    briefing: '主管道停机，只能使用现场库存。用反弹命中挡板后的目标，并将每一发弹药用在关键位置。',
    animals: ['panda', 'rabbit', 'frog', 'otter'],
    hazards: ['cleaner-drone', 'barrier-drone'],
    mechanics: ['finite-ammo', 'ricochet', 'timed-shutters'],
    ammoRules: {
      rechargeDisabled: true,
      startingInventory: { 'nutrient-gel': 12, 'adhesive-bloom': 4, 'bounce-bubble': 6 },
      supplyCrates: 1,
    },
    objectives: {
      primary: { type: 'precision-delivery', feedTarget: 15, maximumShots: 22, minimumStability: 1 },
      technical: { metric: 'shotsUsed', lte: 18, label: '使用不超过 18 发' },
      special: { metric: 'ricochetFeeds', gte: 4, label: '完成 4 次反弹补给' },
    },
    encounters: [
      { id: 'inventory-check', startAt: 0, duration: 65, spawn: { panda: 3, rabbit: 3 }, maxConcurrent: 2 },
      { id: 'shutter-bank', startAt: 65, duration: 75, spawn: { frog: 3, otter: 3, 'cleaner-drone': 2 }, maxConcurrent: 4 },
      { id: 'ricochet-exam', startAt: 140, duration: 100, spawn: { rabbit: 4, otter: 4, 'barrier-drone': 3 }, maxConcurrent: 5 },
    ],
    ratingThresholds: { C: 0, B: 2900, A: 4200, S: 5650 },
    rewards: {
      completion: { credits: 280, unlocks: { ammo: [], modules: ['magnetic-guidance'] } },
      ratingBonuses: { C: 0, B: 75, A: 155, S: 270 },
      medals: medalRewards(
        '在库存耗尽前完成调度',
        '使用不超过 18 发',
        '完成 4 次反弹补给',
      ),
    },
  },
  {
    id: 'sector-07-05',
    sectorId: SECTOR_ID,
    order: 5,
    missionType: 'boss',
    name: '自动分拣转盘',
    subtitle: '三阶段区域维修',
    seed: 7005,
    timeLimitSeconds: 300,
    estimatedMinutes: 8,
    availableAmmo: ['nutrient-gel', 'adhesive-bloom', 'bounce-bubble'],
    defaultLoadout: { ammo: ['nutrient-gel', 'adhesive-bloom', 'bounce-bubble'], module: 'magnetic-guidance' },
    briefing: 'MOP-0 锁死了自动分拣转盘。利用三种弹药依次重启投食口、储粮罐与移动核心。',
    animals: ['panda', 'rabbit', 'frog', 'otter'],
    hazards: ['cleaner-drone', 'snack-thief', 'barrier-drone'],
    mechanics: ['boss-phases', 'rotating-port', 'crosswind', 'mobile-core'],
    objectives: {
      primary: { type: 'boss-repair', phases: 3, minimumStability: 1 },
      technical: { metric: 'completionTimeSeconds', lte: 240, label: '4 分钟内完成维修' },
      special: { metric: 'bossCoreMisses', lte: 1, label: '移动核心阶段最多失误 1 发' },
    },
    boss: {
      id: 'sorting-carousel',
      phases: [
        { id: 'feed-port', health: 6, durationLimitSeconds: 85, preferredAmmo: 'nutrient-gel', mechanic: 'rotating-window' },
        { id: 'storage-tanks', health: 8, durationLimitSeconds: 95, preferredAmmo: 'adhesive-bloom', mechanic: 'paired-switches' },
        { id: 'mobile-core', health: 10, durationLimitSeconds: 120, preferredAmmo: 'bounce-bubble', mechanic: 'shield-and-crosswind' },
      ],
    },
    encounters: [
      { id: 'phase-1-port', startAt: 0, duration: 85, bossPhase: 'feed-port', maxConcurrent: 3 },
      { id: 'phase-2-tanks', startAt: 85, duration: 95, bossPhase: 'storage-tanks', maxConcurrent: 4 },
      { id: 'phase-3-core', startAt: 180, duration: 120, bossPhase: 'mobile-core', maxConcurrent: 5 },
    ],
    ratingThresholds: { C: 0, B: 4300, A: 6100, S: 8050 },
    rewards: {
      completion: {
        credits: 450,
        unlocks: { ammo: [], modules: ['ricochet-mapper'], cosmetics: ['sector-07-restored'] },
      },
      ratingBonuses: { C: 0, B: 110, A: 230, S: 400 },
      medals: medalRewards(
        '修复自动分拣转盘',
        '4 分钟内完成维修',
        '移动核心阶段最多失误 1 发',
      ),
    },
  },
]);

const ammoById = new Map(AMMO_TYPES.map((entry) => [entry.id, entry]));
const hazardById = new Map(HAZARD_TYPES.map((entry) => [entry.id, entry]));
const moduleById = new Map(MODULES.map((entry) => [entry.id, entry]));
const missionById = new Map(MISSIONS.map((entry) => [entry.id, entry]));

export function getAmmoTypeById(id) {
  return ammoById.get(id) ?? null;
}

export function getHazardTypeById(id) {
  return hazardById.get(id) ?? null;
}

export function getModuleById(id) {
  return moduleById.get(id) ?? null;
}

export function getMissionById(id) {
  return missionById.get(id) ?? null;
}

export function getNextMissionId(id) {
  const index = MISSIONS.findIndex((mission) => mission.id === id);
  return index >= 0 && index < MISSIONS.length - 1 ? MISSIONS[index + 1].id : null;
}

/**
 * Convert a completed run into C/B/A/S. Passing a number is useful for score
 * previews; passing a result object additionally honours an explicit
 * `completed: false` value.
 */
export function getMissionRating(missionOrId, resultOrScore, completed = true) {
  const mission = typeof missionOrId === 'string' ? getMissionById(missionOrId) : missionOrId;
  if (!mission) return null;

  const result = typeof resultOrScore === 'number'
    ? { score: resultOrScore, completed }
    : { completed: true, ...(resultOrScore ?? {}) };

  if (!result.completed) return null;
  const score = finiteNumber(result.score, 0);

  for (let index = RATING_ORDER.length - 1; index >= 0; index -= 1) {
    const rating = RATING_ORDER[index];
    if (score >= mission.ratingThresholds[rating]) return rating;
  }

  return 'C';
}

/** Return the fixed reward data for a mission and the total rating bonus. */
export function getMissionRewards(missionOrId, rating = 'C') {
  const mission = typeof missionOrId === 'string' ? getMissionById(missionOrId) : missionOrId;
  if (!mission) return null;
  const safeRating = RATING_ORDER.includes(rating) ? rating : 'C';
  return {
    completion: mission.rewards.completion,
    ratingBonus: mission.rewards.ratingBonuses[safeRating],
    medals: mission.rewards.medals,
  };
}

/** Development/build-time validation hook. Returns errors instead of throwing. */
export function validateGameContent() {
  const errors = [];
  validateUniqueIds('ammo', AMMO_TYPES, errors);
  validateUniqueIds('hazard', HAZARD_TYPES, errors);
  validateUniqueIds('module', MODULES, errors);
  validateUniqueIds('mission', MISSIONS, errors);

  MISSIONS.forEach((mission, index) => {
    if (mission.order !== index + 1) errors.push(`${mission.id}: order must be ${index + 1}`);
    for (const ammoId of mission.availableAmmo) {
      if (!ammoById.has(ammoId)) errors.push(`${mission.id}: unknown ammo ${ammoId}`);
    }
    for (const hazardId of mission.hazards) {
      if (!hazardById.has(hazardId)) errors.push(`${mission.id}: unknown hazard ${hazardId}`);
    }
    const thresholds = RATING_ORDER.map((rating) => mission.ratingThresholds[rating]);
    if (thresholds.some((value) => !Number.isFinite(value))) {
      errors.push(`${mission.id}: every rating needs a numeric threshold`);
    }
    if (thresholds.some((value, ratingIndex) => ratingIndex > 0 && value <= thresholds[ratingIndex - 1])) {
      errors.push(`${mission.id}: rating thresholds must increase from C to S`);
    }
  });

  return errors;
}

function medalRewards(completion, technical, special) {
  return [
    { id: 'completion', label: '照护完成', description: completion, reward: { careBadges: 1, credits: 20 } },
    { id: 'technical', label: '技术照护', description: technical, reward: { careBadges: 1, credits: 35 } },
    { id: 'special', label: '特别照护', description: special, reward: { careBadges: 1, credits: 55 } },
  ];
}

function validateUniqueIds(label, entries, errors) {
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.id) errors.push(`${label}: entry without id`);
    if (seen.has(entry.id)) errors.push(`${label}: duplicate id ${entry.id}`);
    seen.add(entry.id);
  }
}

function finiteNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
