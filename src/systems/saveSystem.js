import {
  AMMO_TYPES,
  CONTENT_VERSION,
  MISSIONS,
  MODULES,
  RATING_ORDER,
  getMissionById,
  getMissionRating,
  getNextMissionId,
} from '../content/gameContent.js';

export const SAVE_SCHEMA_VERSION = 2;
export const SAVE_STORAGE_KEY = 'slop-zoo-cannon.save';
export const SAVE_BACKUP_COUNT = 3;
export const LEGACY_BEST_SCORE_KEY = 'slop-zoo-cannon-best';

const SAVE_FORMAT = 'slop-zoo-cannon-save';
const BACKUP_KEY_PREFIX = `${SAVE_STORAGE_KEY}.backup.`;
const memoryValues = new Map();

const memoryStorage = {
  kind: 'memory',
  getItem: (key) => memoryValues.get(key) ?? null,
  setItem: (key, value) => memoryValues.set(key, String(value)),
  removeItem: (key) => memoryValues.delete(key),
};

let defaultStorageAdapter = null;

export class SaveDataError extends Error {
  constructor(message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SaveDataError';
  }
}

export class UnsupportedSaveVersionError extends SaveDataError {
  constructor(version) {
    super(`Save schema ${version} is newer than supported schema ${SAVE_SCHEMA_VERSION}.`);
    this.name = 'UnsupportedSaveVersionError';
    this.version = version;
  }
}

/**
 * Wrap window.localStorage behind the small adapter used by this module.
 * Browsers that reject storage access automatically fall back to an in-memory
 * store, keeping private/incognito previews playable.
 */
export function createLocalStorageAdapter(storage = getBrowserLocalStorage()) {
  if (!isStorageLike(storage)) return memoryStorage;
  const fallbackValues = new Map();
  const fallback = {
    getItem: (key) => fallbackValues.get(key) ?? null,
    setItem: (key, value) => fallbackValues.set(key, String(value)),
    removeItem: (key) => fallbackValues.delete(key),
  };

  return {
    kind: 'localStorage',
    getItem(key) {
      try {
        return storage.getItem(key) ?? fallback.getItem(key);
      } catch {
        return fallback.getItem(key);
      }
    },
    setItem(key, value) {
      fallback.setItem(key, value);
      try {
        storage.setItem(key, String(value));
      } catch { /* In-memory mirror remains available for this session. */ }
    },
    removeItem(key) {
      fallback.removeItem(key);
      try {
        storage.removeItem(key);
      } catch { /* Nothing else to remove. */ }
    },
  };
}

export function createDefaultSave(now = new Date()) {
  const timestamp = toIsoTimestamp(now);
  const firstMissionId = MISSIONS[0]?.id ?? null;
  const defaultAmmo = AMMO_TYPES.filter((ammo) => ammo.unlockedByDefault).map((ammo) => ammo.id);
  const defaultModules = MODULES.filter((module) => module.unlockedByDefault).map((module) => module.id);

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    contentVersion: CONTENT_VERSION,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    campaign: {
      activeSectorId: 'sector-07',
      lastMissionId: firstMissionId,
      completedMissionIds: [],
      sectorCompleted: false,
    },
    missionProgress: Object.fromEntries(MISSIONS.map((mission, index) => [
      mission.id,
      createMissionProgress(index === 0),
    ])),
    unlocks: {
      ammo: defaultAmmo,
      modules: defaultModules,
      cosmetics: [],
      codex: [],
    },
    economy: {
      credits: 0,
      careBadges: 0,
    },
    loadout: {
      ammo: defaultAmmo.slice(0, 3),
      module: defaultModules[0] ?? null,
    },
    tutorial: {
      seen: [],
      completed: false,
    },
    statistics: {
      totalMissionAttempts: 0,
      totalMissionCompletions: 0,
      totalScore: 0,
      highestMissionScore: 0,
      shotsFired: 0,
      successfulFeeds: 0,
      bullseyes: 0,
      hazardsHit: 0,
      hazardsNeutralized: 0,
      longestCombo: 0,
      playTimeSeconds: 0,
    },
    modes: {
      classicShift: {
        bestScore: 0,
        gamesPlayed: 0,
      },
    },
    pendingAchievements: [],
    metadata: {
      migratedFrom: null,
      recoveredFromBackup: null,
    },
  };
}

/**
 * Load, validate and migrate the active save. Corrupt primaries are recovered
 * from backup. With no save present, the old prototype score is imported.
 */
export function loadSave(options = {}) {
  const storage = resolveStorage(options);
  const primaryRaw = storage.getItem(SAVE_STORAGE_KEY);

  if (primaryRaw !== null) {
    try {
      const decoded = decodeStoredSave(primaryRaw);
      const sourceVersion = readSchemaVersion(decoded.data);
      const save = migrateSave(decoded.data, options);
      if (
        decoded.needsRewrite
        || sourceVersion !== SAVE_SCHEMA_VERSION
        || decoded.data.contentVersion !== CONTENT_VERSION
      ) {
        return saveProgress(save, { ...options, storage, skipBackup: true });
      }
      return save;
    } catch (primaryError) {
      const recovered = recoverFromBackups(storage, options);
      if (recovered) return recovered;
      if (options.throwOnCorrupt) {
        throw new SaveDataError('The primary save and all backups are unreadable.', primaryError);
      }
    }
  }

  const save = createDefaultSave(options.now);
  const legacyBest = readLegacyBestScore(storage);
  if (legacyBest > 0) {
    save.modes.classicShift.bestScore = legacyBest;
    save.metadata.migratedFrom = LEGACY_BEST_SCORE_KEY;
  }

  if (options.persistDefault === false) return save;
  return saveProgress(save, { ...options, storage, skipBackup: true });
}

/** Persist a normalized save and rotate the previous valid primary into 3 backups. */
export function saveProgress(saveData, options = {}) {
  const storage = resolveStorage(options);
  const now = toIsoTimestamp(options.now);
  const normalized = migrateSave(saveData, { ...options, now });
  normalized.schemaVersion = SAVE_SCHEMA_VERSION;
  normalized.contentVersion = CONTENT_VERSION;
  normalized.revision = nonNegativeInteger(normalized.revision, 0) + 1;
  normalized.updatedAt = now;

  if (!options.skipBackup) {
    const currentRaw = storage.getItem(SAVE_STORAGE_KEY);
    if (currentRaw !== null && isValidStoredSave(currentRaw, options)) {
      rotateBackups(storage, currentRaw);
    }
  }

  storage.setItem(SAVE_STORAGE_KEY, encodeStoredSave(normalized, now));
  return normalized;
}

/**
 * Record an attempt, best result, one-time rewards and the next mission unlock.
 * Returns the newly persisted save. Pass { autoSave: false, saveData } for a
 * pure in-memory update (useful when batching several changes).
 */
export function recordMissionResult(missionId, result = {}, options = {}) {
  const actualOptions = looksLikeSave(options) ? { saveData: options } : options;
  const mission = getMissionById(missionId);
  if (!mission) throw new SaveDataError(`Unknown mission: ${missionId}`);

  const sourceSave = actualOptions.saveData
    ? migrateSave(actualOptions.saveData, actualOptions)
    : loadSave(actualOptions);
  const save = cloneData(sourceSave);

  if (!isMissionUnlocked(missionId, save) && !actualOptions.allowLocked) {
    throw new SaveDataError(`Mission is locked: ${missionId}`);
  }

  const timestamp = toIsoTimestamp(actualOptions.now);
  const progress = save.missionProgress[missionId];
  const completed = result.completed !== false;
  const score = nonNegativeNumber(result.score, 0);
  const accuracy = normalizeAccuracy(result.accuracy);
  const medals = collectEarnedMedals(mission, result, completed);
  const rating = resolveResultRating(mission, result, score, completed, medals);
  const rewardsEarned = { credits: 0, careBadges: 0, ammo: [], modules: [], cosmetics: [] };
  const newlyUnlocked = [];

  progress.attempts += 1;
  progress.lastPlayedAt = timestamp;
  if (completed) {
    progress.completed = true;
    progress.completions += 1;
    progress.bestScore = Math.max(progress.bestScore, score);
    progress.bestRating = betterRating(progress.bestRating, rating);
    progress.bestAccuracy = Math.max(progress.bestAccuracy, accuracy ?? 0);
    progress.bestCombo = Math.max(progress.bestCombo, nonNegativeInteger(result.maxCombo, 0));
  }

  if (completed && Number.isFinite(Number(result.timeRemainingSeconds))) {
    progress.bestTimeRemainingSeconds = Math.max(
      progress.bestTimeRemainingSeconds,
      nonNegativeNumber(result.timeRemainingSeconds, 0),
    );
  }

  if (completed && Number.isFinite(Number(result.completionTimeSeconds))) {
    progress.fastestCompletionSeconds = minimumNullable(
      progress.fastestCompletionSeconds,
      nonNegativeNumber(result.completionTimeSeconds, 0),
    );
  }

  if (completed && Number.isFinite(Number(result.shotsUsed))) {
    progress.fewestShots = minimumNullable(progress.fewestShots, nonNegativeInteger(result.shotsUsed, 0));
  }

  const firstCompletion = completed && !progress.completionRewardClaimed;
  if (firstCompletion) {
    progress.completionRewardClaimed = true;
    applyReward(save, mission.rewards.completion, rewardsEarned);
  }

  if (rating) {
    const previousBonus = ratingBonus(mission, progress.claimedRating);
    const nextClaimedRating = betterRating(progress.claimedRating, rating);
    const nextBonus = ratingBonus(mission, nextClaimedRating);
    const bonusDelta = Math.max(0, nextBonus - previousBonus);
    if (bonusDelta > 0) {
      save.economy.credits += bonusDelta;
      rewardsEarned.credits += bonusDelta;
    }
    progress.claimedRating = nextClaimedRating;
  }

  for (const medalId of medals) {
    if (!progress.medals.includes(medalId)) progress.medals.push(medalId);
    if (progress.claimedMedals.includes(medalId)) continue;
    const medal = mission.rewards.medals.find((entry) => entry.id === medalId);
    if (!medal) continue;
    applyReward(save, medal.reward, rewardsEarned);
    progress.claimedMedals.push(medalId);
  }

  if (completed) {
    if (!save.campaign.completedMissionIds.includes(missionId)) {
      save.campaign.completedMissionIds.push(missionId);
    }
    const nextMissionId = getNextMissionId(missionId);
    if (nextMissionId && !save.missionProgress[nextMissionId].unlocked) {
      save.missionProgress[nextMissionId].unlocked = true;
      newlyUnlocked.push(nextMissionId);
    }
    if (!nextMissionId) save.campaign.sectorCompleted = true;
  }

  save.campaign.lastMissionId = completed ? (getNextMissionId(missionId) ?? missionId) : missionId;
  updateStatistics(save.statistics, result, score, completed);
  save.statistics.totalMissionCompletions = save.campaign.completedMissionIds.length;

  progress.lastResult = {
    playedAt: timestamp,
    completed,
    score,
    rating,
    accuracy,
    timeRemainingSeconds: optionalNonNegativeNumber(result.timeRemainingSeconds),
    completionTimeSeconds: optionalNonNegativeNumber(result.completionTimeSeconds),
    shotsUsed: optionalNonNegativeInteger(result.shotsUsed),
    maxCombo: nonNegativeInteger(result.maxCombo, 0),
    medals: [...medals],
    rewardsEarned,
    newlyUnlocked,
  };

  save.updatedAt = timestamp;
  if (actualOptions.autoSave === false) return normalizeCurrentSave(save, actualOptions);
  return saveProgress(save, actualOptions);
}

/** Supports isMissionUnlocked(missionId, save?) and isMissionUnlocked(save, missionId). */
export function isMissionUnlocked(missionIdOrSave, maybeSaveOrMissionId = null) {
  const missionId = typeof missionIdOrSave === 'string' ? missionIdOrSave : maybeSaveOrMissionId;
  const save = typeof missionIdOrSave === 'string'
    ? (maybeSaveOrMissionId ?? loadSave())
    : missionIdOrSave;
  const index = MISSIONS.findIndex((mission) => mission.id === missionId);
  if (index < 0 || !save) return false;
  if (index === 0) return true;
  if (save.missionProgress?.[missionId]?.unlocked) return true;
  const previousMissionId = MISSIONS[index - 1].id;
  return Boolean(save.missionProgress?.[previousMissionId]?.completed);
}

export function getBestMissionResult(missionId, saveData = null) {
  if (!getMissionById(missionId)) return null;
  const save = saveData ?? loadSave();
  const progress = save.missionProgress?.[missionId];
  if (!progress) return null;
  return {
    completed: Boolean(progress.completed),
    attempts: nonNegativeInteger(progress.attempts, 0),
    completions: nonNegativeInteger(progress.completions, 0),
    bestRating: validRating(progress.bestRating),
    bestScore: nonNegativeNumber(progress.bestScore, 0),
    bestAccuracy: normalizeAccuracy(progress.bestAccuracy) ?? 0,
    bestCombo: nonNegativeInteger(progress.bestCombo, 0),
    bestTimeRemainingSeconds: nonNegativeNumber(progress.bestTimeRemainingSeconds, 0),
    fastestCompletionSeconds: optionalNonNegativeNumber(progress.fastestCompletionSeconds),
    fewestShots: optionalNonNegativeInteger(progress.fewestShots),
    medals: uniqueStrings(progress.medals),
  };
}

/** Delete active data and backups, then create a fresh slot. */
export function resetSave(options = {}) {
  const storage = resolveStorage(options);
  storage.removeItem(SAVE_STORAGE_KEY);
  if (!options.keepBackups) {
    for (let index = 0; index < SAVE_BACKUP_COUNT; index += 1) {
      storage.removeItem(backupKey(index));
    }
  }
  storage.removeItem(LEGACY_BEST_SCORE_KEY);
  const fresh = createDefaultSave(options.now);
  if (options.persist === false) return fresh;
  return saveProgress(fresh, { ...options, storage, skipBackup: true });
}

/** Restore one of the rotating backups (0 is newest). */
export function restoreSaveBackup(index = 0, options = {}) {
  const safeIndex = Math.trunc(Number(index));
  if (safeIndex < 0 || safeIndex >= SAVE_BACKUP_COUNT) return null;
  const storage = resolveStorage(options);
  const raw = storage.getItem(backupKey(safeIndex));
  if (raw === null) return null;
  const decoded = decodeStoredSave(raw);
  const save = migrateSave(decoded.data, options);
  save.metadata.recoveredFromBackup = safeIndex;
  return saveProgress(save, { ...options, storage, skipBackup: true });
}

/** Migrate any supported legacy object to the current, normalized schema. */
export function migrateSave(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SaveDataError('Save data must be an object.');
  }

  let save = cloneData(input);
  let version = readSchemaVersion(save);
  if (version > SAVE_SCHEMA_VERSION) throw new UnsupportedSaveVersionError(version);

  if (version === 0) {
    save = migrateV0ToV1(save, options);
    version = 1;
  }
  if (version === 1) {
    save = migrateV1ToV2(save, options);
    version = 2;
  }
  if (version !== SAVE_SCHEMA_VERSION) {
    throw new SaveDataError(`No migration path exists for save schema ${version}.`);
  }

  return normalizeCurrentSave(save, options);
}

function createMissionProgress(unlocked) {
  return {
    unlocked,
    completed: false,
    attempts: 0,
    completions: 0,
    bestRating: null,
    bestScore: 0,
    bestAccuracy: 0,
    bestCombo: 0,
    bestTimeRemainingSeconds: 0,
    fastestCompletionSeconds: null,
    fewestShots: null,
    medals: [],
    claimedRating: null,
    claimedMedals: [],
    completionRewardClaimed: false,
    lastPlayedAt: null,
    lastResult: null,
  };
}

function migrateV0ToV1(source, options) {
  const timestamp = toIsoTimestamp(options.now ?? source.updatedAt ?? source.createdAt);
  return {
    schemaVersion: 1,
    createdAt: source.createdAt ?? timestamp,
    updatedAt: source.updatedAt ?? timestamp,
    revision: source.revision ?? 0,
    missionProgress: source.missionProgress ?? source.missions ?? source.progress?.missions ?? {},
    completedMissionIds: source.completedMissionIds ?? source.progress?.completedMissionIds ?? [],
    unlocks: source.unlocks ?? {
      ammo: source.unlockedAmmo,
      modules: source.unlockedModules,
      cosmetics: source.unlockedCosmetics,
    },
    economy: source.economy ?? { credits: source.credits, careBadges: source.careBadges },
    loadout: source.loadout,
    tutorial: source.tutorial,
    statistics: source.statistics ?? source.stats,
    classicBestScore: source.bestScore ?? source.classicBestScore,
    modes: source.modes,
    pendingAchievements: source.pendingAchievements,
    metadata: { migratedFrom: source.version ?? 'unversioned' },
  };
}

function migrateV1ToV2(source, options) {
  const timestamp = toIsoTimestamp(options.now ?? source.updatedAt ?? source.createdAt);
  return {
    ...source,
    schemaVersion: 2,
    contentVersion: CONTENT_VERSION,
    createdAt: source.createdAt ?? timestamp,
    updatedAt: source.updatedAt ?? timestamp,
    campaign: source.campaign ?? {
      activeSectorId: 'sector-07',
      lastMissionId: source.lastMissionId ?? MISSIONS[0]?.id ?? null,
      completedMissionIds: source.completedMissionIds ?? [],
      sectorCompleted: Boolean(source.sectorCompleted),
    },
    missionProgress: source.missionProgress ?? source.progress?.missions ?? {},
    unlocks: source.unlocks ?? {
      ammo: source.unlockedAmmo,
      modules: source.unlockedModules,
      cosmetics: source.unlockedCosmetics,
    },
    economy: source.economy ?? {
      credits: source.credits,
      careBadges: source.careBadges,
    },
    modes: source.modes ?? {
      classicShift: { bestScore: source.classicBestScore ?? source.bestScore ?? 0, gamesPlayed: 0 },
    },
    metadata: {
      ...(source.metadata ?? {}),
      migratedFrom: source.metadata?.migratedFrom ?? 'schema-1',
    },
  };
}

function normalizeCurrentSave(source, options = {}) {
  const timestamp = toIsoTimestamp(options.now ?? source.updatedAt ?? source.createdAt);
  const save = createDefaultSave(source.createdAt ?? timestamp);
  const sourceProgress = source.missionProgress ?? {};

  save.revision = nonNegativeInteger(source.revision, 0);
  save.updatedAt = validTimestamp(source.updatedAt) ?? timestamp;
  save.contentVersion = CONTENT_VERSION;

  for (const [index, mission] of MISSIONS.entries()) {
    const raw = sourceProgress[mission.id] ?? {};
    const progress = save.missionProgress[mission.id];
    progress.unlocked = index === 0 || Boolean(raw.unlocked);
    progress.completed = Boolean(raw.completed);
    progress.attempts = nonNegativeInteger(raw.attempts, 0);
    progress.completions = nonNegativeInteger(raw.completions, progress.completed ? 1 : 0);
    progress.bestRating = validRating(raw.bestRating);
    progress.bestScore = nonNegativeNumber(raw.bestScore, 0);
    progress.bestAccuracy = normalizeAccuracy(raw.bestAccuracy) ?? 0;
    progress.bestCombo = nonNegativeInteger(raw.bestCombo, 0);
    progress.bestTimeRemainingSeconds = nonNegativeNumber(raw.bestTimeRemainingSeconds, 0);
    progress.fastestCompletionSeconds = optionalNonNegativeNumber(raw.fastestCompletionSeconds);
    progress.fewestShots = optionalNonNegativeInteger(raw.fewestShots);
    progress.medals = validMedalIds(mission, raw.medals);
    progress.claimedRating = validRating(raw.claimedRating ?? raw.bestRating);
    progress.claimedMedals = validMedalIds(
      mission,
      raw.claimedMedals ?? raw.medals ?? (raw.completed ? ['completion'] : []),
    );
    progress.completionRewardClaimed = Boolean(raw.completionRewardClaimed ?? raw.completed);
    progress.lastPlayedAt = validTimestamp(raw.lastPlayedAt);
    progress.lastResult = raw.lastResult && typeof raw.lastResult === 'object' ? cloneData(raw.lastResult) : null;
  }

  for (let index = 1; index < MISSIONS.length; index += 1) {
    const previous = save.missionProgress[MISSIONS[index - 1].id];
    if (previous.completed) save.missionProgress[MISSIONS[index].id].unlocked = true;
  }

  const completedMissionIds = MISSIONS
    .filter((mission) => save.missionProgress[mission.id].completed)
    .map((mission) => mission.id);
  const requestedLastMission = source.campaign?.lastMissionId;
  save.campaign = {
    activeSectorId: 'sector-07',
    lastMissionId: getMissionById(requestedLastMission) ? requestedLastMission : (MISSIONS[0]?.id ?? null),
    completedMissionIds,
    sectorCompleted: completedMissionIds.length === MISSIONS.length,
  };

  const sourceUnlocks = source.unlocks ?? {};
  save.unlocks.ammo = mergeKnownUnlocks(
    AMMO_TYPES.filter((entry) => entry.unlockedByDefault).map((entry) => entry.id),
    sourceUnlocks.ammo,
    AMMO_TYPES,
  );
  save.unlocks.modules = mergeKnownUnlocks(
    MODULES.filter((entry) => entry.unlockedByDefault).map((entry) => entry.id),
    sourceUnlocks.modules,
    MODULES,
  );
  save.unlocks.cosmetics = uniqueStrings(sourceUnlocks.cosmetics);
  save.unlocks.codex = uniqueStrings(sourceUnlocks.codex);

  // Unlock rewards are derivable progression state. Rebuild them when an old
  // save omitted an unlock array, without re-awarding spendable currency.
  for (const mission of MISSIONS) {
    if (!save.missionProgress[mission.id].completed) continue;
    const unlocks = mission.rewards.completion.unlocks ?? {};
    save.unlocks.ammo = mergeKnownUnlocks(save.unlocks.ammo, unlocks.ammo, AMMO_TYPES);
    save.unlocks.modules = mergeKnownUnlocks(save.unlocks.modules, unlocks.modules, MODULES);
    save.unlocks.cosmetics = uniqueStrings([...save.unlocks.cosmetics, ...uniqueStrings(unlocks.cosmetics)]);
  }

  save.economy.credits = nonNegativeInteger(source.economy?.credits, 0);
  save.economy.careBadges = nonNegativeInteger(source.economy?.careBadges, 0);

  const requestedAmmo = uniqueStrings(source.loadout?.ammo)
    .filter((id) => save.unlocks.ammo.includes(id))
    .slice(0, 3);
  save.loadout.ammo = requestedAmmo.length > 0 ? requestedAmmo : save.unlocks.ammo.slice(0, 3);
  save.loadout.module = save.unlocks.modules.includes(source.loadout?.module)
    ? source.loadout.module
    : (save.unlocks.modules[0] ?? null);

  save.tutorial.seen = uniqueStrings(source.tutorial?.seen);
  save.tutorial.completed = Boolean(source.tutorial?.completed);

  for (const key of Object.keys(save.statistics)) {
    save.statistics[key] = nonNegativeNumber(source.statistics?.[key], save.statistics[key]);
  }
  save.statistics.totalMissionCompletions = completedMissionIds.length;

  save.modes.classicShift.bestScore = nonNegativeInteger(
    source.modes?.classicShift?.bestScore ?? source.classicBestScore,
    0,
  );
  save.modes.classicShift.gamesPlayed = nonNegativeInteger(source.modes?.classicShift?.gamesPlayed, 0);
  save.pendingAchievements = uniqueStrings(source.pendingAchievements);
  save.metadata = {
    migratedFrom: source.metadata?.migratedFrom ?? null,
    recoveredFromBackup: source.metadata?.recoveredFromBackup ?? null,
  };

  return save;
}

function collectEarnedMedals(mission, result, completed) {
  if (!completed) return [];
  const explicit = uniqueStrings(result.medals ?? result.earnedMedals ?? result.badges);
  const earned = new Set(explicit.filter((id) => mission.rewards.medals.some((medal) => medal.id === id)));
  if (completed) earned.add('completion');
  if (matchesObjective(result, mission.objectives.technical)) earned.add('technical');
  if (matchesObjective(result, mission.objectives.special)) earned.add('special');
  return [...earned];
}

function matchesObjective(result, objective) {
  if (!objective?.metric || !Object.hasOwn(result, objective.metric)) return false;
  let value = Number(result[objective.metric]);
  if (!Number.isFinite(value)) return false;
  if (objective.metric === 'accuracy' && value > 1 && value <= 100) value /= 100;
  if (Number.isFinite(objective.gte) && value < objective.gte) return false;
  if (Number.isFinite(objective.lte) && value > objective.lte) return false;
  if (Object.hasOwn(objective, 'eq') && value !== objective.eq) return false;
  return true;
}

function resolveResultRating(mission, result, score, completed, medals) {
  if (!completed) return null;
  const explicit = validRating(result.rating);
  if (explicit) return explicit;
  let rating = getMissionRating(mission, { score, completed });
  if (rating === 'S' && !medals.includes('special')) rating = 'A';
  if (rating === 'A' && !medals.includes('technical')) rating = 'B';
  return rating;
}

function applyReward(save, reward = {}, summary) {
  const credits = nonNegativeInteger(reward.credits, 0);
  const careBadges = nonNegativeInteger(reward.careBadges, 0);
  save.economy.credits += credits;
  save.economy.careBadges += careBadges;
  summary.credits += credits;
  summary.careBadges += careBadges;

  const unlocks = reward.unlocks ?? {};
  addUnlocks(save.unlocks.ammo, unlocks.ammo, summary.ammo);
  addUnlocks(save.unlocks.modules, unlocks.modules, summary.modules);
  addUnlocks(save.unlocks.cosmetics, unlocks.cosmetics, summary.cosmetics);
}

function addUnlocks(target, values, summary) {
  for (const id of uniqueStrings(values)) {
    if (target.includes(id)) continue;
    target.push(id);
    summary.push(id);
  }
}

function updateStatistics(statistics, result, score, completed) {
  statistics.totalMissionAttempts += 1;
  statistics.totalScore += score;
  statistics.highestMissionScore = Math.max(statistics.highestMissionScore, score);
  statistics.shotsFired += nonNegativeInteger(result.shotsUsed ?? result.shotsFired, 0);
  statistics.successfulFeeds += nonNegativeInteger(result.successfulFeeds ?? result.feeds, 0);
  statistics.bullseyes += nonNegativeInteger(result.bullseyes, 0);
  statistics.hazardsHit += nonNegativeInteger(result.hazardsHit ?? result.cleanerDroneHits, 0);
  statistics.hazardsNeutralized += nonNegativeInteger(result.hazardsNeutralized, 0);
  statistics.longestCombo = Math.max(statistics.longestCombo, nonNegativeInteger(result.maxCombo, 0));
  statistics.playTimeSeconds += nonNegativeNumber(result.playTimeSeconds ?? result.completionTimeSeconds, 0);
  if (!completed) return;
}

function recoverFromBackups(storage, options) {
  for (let index = 0; index < SAVE_BACKUP_COUNT; index += 1) {
    const raw = storage.getItem(backupKey(index));
    if (raw === null) continue;
    try {
      const decoded = decodeStoredSave(raw);
      const save = migrateSave(decoded.data, options);
      save.metadata.recoveredFromBackup = index;
      return saveProgress(save, { ...options, storage, skipBackup: true });
    } catch {
      // Try the next older backup.
    }
  }
  return null;
}

function rotateBackups(storage, currentRaw) {
  for (let index = SAVE_BACKUP_COUNT - 1; index > 0; index -= 1) {
    const previous = storage.getItem(backupKey(index - 1));
    if (previous === null) storage.removeItem(backupKey(index));
    else storage.setItem(backupKey(index), previous);
  }
  storage.setItem(backupKey(0), currentRaw);
}

function encodeStoredSave(save, savedAt) {
  const dataJson = JSON.stringify(save);
  return JSON.stringify({
    format: SAVE_FORMAT,
    savedAt,
    checksum: checksum(dataJson),
    data: save,
  });
}

function decodeStoredSave(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SaveDataError('Save is not valid JSON.', error);
  }

  if (parsed?.format === SAVE_FORMAT && parsed.data && typeof parsed.data === 'object') {
    const expected = checksum(JSON.stringify(parsed.data));
    if (parsed.checksum !== expected) throw new SaveDataError('Save checksum does not match its contents.');
    return { data: parsed.data, needsRewrite: false };
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return { data: parsed, needsRewrite: true };
  }

  throw new SaveDataError('Save root must be an object.');
}

function isValidStoredSave(raw, options) {
  try {
    const decoded = decodeStoredSave(raw);
    migrateSave(decoded.data, options);
    return true;
  } catch {
    return false;
  }
}

function checksum(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function ratingBonus(mission, rating) {
  return rating ? nonNegativeInteger(mission.rewards.ratingBonuses[rating], 0) : 0;
}

function betterRating(first, second) {
  const firstIndex = RATING_ORDER.indexOf(first);
  const secondIndex = RATING_ORDER.indexOf(second);
  if (firstIndex < 0) return secondIndex < 0 ? null : second;
  return secondIndex > firstIndex ? second : first;
}

function validRating(value) {
  return RATING_ORDER.includes(value) ? value : null;
}

function validMedalIds(mission, values) {
  const validIds = new Set(mission.rewards.medals.map((medal) => medal.id));
  return uniqueStrings(values).filter((id) => validIds.has(id));
}

function mergeKnownUnlocks(defaultIds, requestedIds, definitions) {
  const knownIds = new Set(definitions.map((entry) => entry.id));
  return uniqueStrings([...defaultIds, ...uniqueStrings(requestedIds)]).filter((id) => knownIds.has(id));
}

function readLegacyBestScore(storage) {
  const raw = storage.getItem(LEGACY_BEST_SCORE_KEY);
  if (raw === null) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function readSchemaVersion(save) {
  const raw = save?.schemaVersion ?? save?.version ?? 0;
  const version = Number(raw);
  return Number.isInteger(version) && version >= 0 ? version : 0;
}

function backupKey(index) {
  return `${BACKUP_KEY_PREFIX}${index}`;
}

function resolveStorage(options) {
  if (isStorageLike(options) && !Object.hasOwn(options, 'storage')) return createLocalStorageAdapter(options);
  if (isStorageLike(options?.storage)) {
    return options.storage.kind ? options.storage : createLocalStorageAdapter(options.storage);
  }
  if (!defaultStorageAdapter) defaultStorageAdapter = createLocalStorageAdapter();
  return defaultStorageAdapter;
}

function getBrowserLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isStorageLike(value) {
  return Boolean(
    value
    && typeof value.getItem === 'function'
    && typeof value.setItem === 'function'
    && typeof value.removeItem === 'function',
  );
}

function looksLikeSave(value) {
  return Boolean(value && typeof value === 'object' && ('schemaVersion' in value || 'missionProgress' in value));
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function normalizeAccuracy(value) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  if (numeric > 1 && numeric <= 100) return numeric / 100;
  return Math.min(1, Math.max(0, numeric));
}

function nonNegativeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  return Math.floor(nonNegativeNumber(value, fallback));
}

function optionalNonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function optionalNonNegativeInteger(value) {
  const numeric = optionalNonNegativeNumber(value);
  return numeric === null ? null : Math.floor(numeric);
}

function minimumNullable(current, candidate) {
  return current === null || current === undefined ? candidate : Math.min(current, candidate);
}

function validTimestamp(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function toIsoTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
