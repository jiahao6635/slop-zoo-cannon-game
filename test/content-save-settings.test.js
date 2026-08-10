import test from 'node:test';
import assert from 'node:assert/strict';

import { MISSIONS, validateGameContent } from '../src/content/gameContent.js';
import {
  CANNON_SKINS,
  DEFAULT_CANNON_SKIN_ID,
  getDefaultCannonSkinIds,
  resolveCannonSkinId,
  validateCannonSkins,
} from '../src/content/cannonSkins.js';
import {
  SAVE_SCHEMA_VERSION,
  createDefaultSave,
  isMissionUnlocked,
  migrateSave,
  recordMissionResult,
} from '../src/systems/saveSystem.js';
import {
  DEFAULT_SETTINGS,
  PARTICLE_QUALITIES,
  QUALITY_PRESETS,
  SETTINGS_VERSION,
  SHADOW_QUALITIES,
  normalizeSettings,
} from '../src/systems/settingsSystem.js';

test('vertical-slice content is internally valid', () => {
  assert.deepEqual(validateGameContent(), []);
  assert.equal(MISSIONS.length, 5);
  assert.deepEqual(MISSIONS.map((mission) => mission.order), [1, 2, 3, 4, 5]);
});

test('all five cannon skins have valid permanent default unlocks', () => {
  assert.deepEqual(validateCannonSkins(), []);
  const expectedSkinIds = [
    'classic',
    'dragon-new-year',
    'bamboo-guardian',
    'abyssal-whale',
    'stellar-voyager',
  ];
  assert.deepEqual(CANNON_SKINS.map((skin) => skin.id), expectedSkinIds);
  assert.deepEqual(getDefaultCannonSkinIds(), expectedSkinIds);
  assert.equal(CANNON_SKINS.find((skin) => skin.id === 'dragon-new-year')?.limited, true);
  assert.equal(CANNON_SKINS.find((skin) => skin.id === 'bamboo-guardian')?.limited, false);
  assert.equal(resolveCannonSkinId('stellar-voyager', expectedSkinIds), 'stellar-voyager');
  assert.equal(resolveCannonSkinId('unknown', expectedSkinIds), DEFAULT_CANNON_SKIN_ID);
});

test('version 2 saves migrate to cannon skin loadout without losing cosmetic ownership', () => {
  const version2 = createDefaultSave(new Date('2026-08-09T00:00:00.000Z'));
  version2.schemaVersion = 2;
  version2.unlocks.cosmetics = ['sector-07-restored'];
  delete version2.loadout.cannonSkin;

  const migrated = migrateSave(version2, { now: new Date('2026-08-10T00:00:00.000Z') });

  assert.equal(SAVE_SCHEMA_VERSION, 3);
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.loadout.cannonSkin, DEFAULT_CANNON_SKIN_ID);
  assert.deepEqual(migrated.unlocks.cosmetics, [
    'classic',
    'dragon-new-year',
    'bamboo-guardian',
    'abyssal-whale',
    'stellar-voyager',
    'sector-07-restored',
  ]);
});

test('saved catalogue skins remain equipped and invalid selections fall back to classic', () => {
  const save = createDefaultSave(new Date('2026-08-10T00:00:00.000Z'));
  save.loadout.cannonSkin = 'abyssal-whale';
  const whale = migrateSave(save);
  assert.equal(whale.loadout.cannonSkin, 'abyssal-whale');

  save.loadout.cannonSkin = 'missing-seasonal-skin';
  const normalized = migrateSave(save);
  assert.equal(normalized.loadout.cannonSkin, DEFAULT_CANNON_SKIN_ID);
  assert.ok(normalized.unlocks.cosmetics.includes('dragon-new-year'));
  assert.ok(normalized.unlocks.cosmetics.includes('stellar-voyager'));
});

test('failed attempts do not pollute best results or unlock the next mission', () => {
  const mission = MISSIONS[0];
  const nextMission = MISSIONS[1];
  const fresh = createDefaultSave(new Date('2026-08-09T00:00:00.000Z'));
  const failed = recordMissionResult(mission.id, {
    completed: false,
    score: 999999,
    accuracy: 1,
    maxCombo: 99,
  }, { saveData: fresh, autoSave: false });

  assert.equal(failed.missionProgress[mission.id].attempts, 1);
  assert.equal(failed.missionProgress[mission.id].completed, false);
  assert.equal(failed.missionProgress[mission.id].bestScore, 0);
  assert.equal(failed.missionProgress[mission.id].bestCombo, 0);
  assert.equal(isMissionUnlocked(nextMission.id, failed), false);
  assert.equal(failed.economy.credits, 0);
  assert.equal(failed.economy.careBadges, 0);
});

test('five completed missions unlock the campaign once and persist idempotent rewards', () => {
  let save = createDefaultSave(new Date('2026-08-09T00:00:00.000Z'));

  for (const mission of MISSIONS) {
    assert.equal(isMissionUnlocked(mission.id, save), true);
    save = recordMissionResult(mission.id, {
      completed: true,
      score: mission.ratingThresholds.S,
      accuracy: 1,
      maxCombo: 12,
      timeRemainingSeconds: 60,
      completionTimeSeconds: 90,
      shotsUsed: 12,
      feeds: mission.objectives.primary.target ?? mission.objectives.primary.feedTarget ?? 0,
      hazardsNeutralized: mission.objectives.primary.neutralizeTarget ?? 0,
      bullseyes: 6,
      adhesiveMultiFeeds: 2,
      ricochetFeeds: 4,
      bossCoreMisses: 0,
      cleanerDroneHits: 0,
    }, { saveData: save, autoSave: false });
  }

  assert.equal(save.campaign.sectorCompleted, true);
  assert.deepEqual(save.campaign.completedMissionIds, MISSIONS.map((mission) => mission.id));
  assert.equal(save.statistics.totalMissionCompletions, MISSIONS.length);

  const creditsBeforeReplay = save.economy.credits;
  const badgesBeforeReplay = save.economy.careBadges;
  save = recordMissionResult(MISSIONS.at(-1).id, {
    completed: true,
    score: MISSIONS.at(-1).ratingThresholds.S,
    accuracy: 1,
    maxCombo: 12,
  }, { saveData: save, autoSave: false });

  assert.equal(save.economy.credits, creditsBeforeReplay);
  assert.equal(save.economy.careBadges, badgesBeforeReplay);
});

test('settings normalization clamps unsafe values and preserves accessibility choices', () => {
  const normalized = normalizeSettings({
    audio: { masterVolume: 4, musicVolume: -1, sfxVolume: 0.5 },
    controls: { gamepadDeadzone: 2, vibration: -1 },
    gameplay: { trajectoryMode: 'off', aimAssist: 5, cameraShake: -1 },
    accessibility: { uiScale: 1.2, highContrast: true, reducedMotion: true },
    graphics: {
      qualityPreset: 'ultra',
      dynamicRenderScale: 'false',
      shadowQuality: 'cinematic',
      particleQuality: 'maximum',
      renderScale: 10,
    },
  });

  assert.equal(normalized.audio.masterVolume, 1);
  assert.equal(normalized.audio.musicVolume, 0);
  assert.equal(normalized.controls.gamepadDeadzone, 0.6);
  assert.equal(normalized.controls.vibration, 0);
  assert.equal(normalized.gameplay.trajectoryMode, 'off');
  assert.equal(normalized.gameplay.aimAssist, 1);
  assert.equal(normalized.gameplay.cameraShake, 0);
  assert.deepEqual(normalized.accessibility, {
    uiScale: 1.2,
    highContrast: true,
    reducedMotion: true,
  });
  assert.deepEqual(normalized.graphics, {
    qualityPreset: 'medium',
    dynamicRenderScale: true,
    shadowQuality: 'medium',
    particleQuality: 'medium',
    renderScale: 1.5,
  });
  assert.equal(DEFAULT_SETTINGS.accessibility.uiScale, 1);
});

test('graphics quality settings accept only supported presets and strict booleans', () => {
  const normalized = normalizeSettings({
    graphics: {
      qualityPreset: 'high',
      dynamicRenderScale: false,
      shadowQuality: 'off',
      particleQuality: 'low',
      renderScale: 0.75,
    },
  });

  assert.equal(SETTINGS_VERSION, 2);
  assert.deepEqual(QUALITY_PRESETS, ['low', 'medium', 'high']);
  assert.deepEqual(SHADOW_QUALITIES, ['off', 'low', 'medium', 'high']);
  assert.deepEqual(PARTICLE_QUALITIES, ['low', 'medium', 'high']);
  assert.deepEqual(normalized.graphics, {
    qualityPreset: 'high',
    dynamicRenderScale: false,
    shadowQuality: 'off',
    particleQuality: 'low',
    renderScale: 0.75,
  });
});

test('version 1 graphics settings migrate without losing the saved render scale', () => {
  const normalized = normalizeSettings({
    version: 1,
    graphics: { renderScale: 1.25 },
  });

  assert.equal(normalized.version, SETTINGS_VERSION);
  assert.deepEqual(normalized.graphics, {
    qualityPreset: 'medium',
    dynamicRenderScale: true,
    shadowQuality: 'medium',
    particleQuality: 'medium',
    renderScale: 1.25,
  });
});
