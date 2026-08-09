import test from 'node:test';
import assert from 'node:assert/strict';

import { MISSIONS, validateGameContent } from '../src/content/gameContent.js';
import {
  createDefaultSave,
  isMissionUnlocked,
  recordMissionResult,
} from '../src/systems/saveSystem.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/systems/settingsSystem.js';

test('vertical-slice content is internally valid', () => {
  assert.deepEqual(validateGameContent(), []);
  assert.equal(MISSIONS.length, 5);
  assert.deepEqual(MISSIONS.map((mission) => mission.order), [1, 2, 3, 4, 5]);
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
    graphics: { renderScale: 10 },
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
  assert.equal(normalized.graphics.renderScale, 1.5);
  assert.equal(DEFAULT_SETTINGS.accessibility.uiScale, 1);
});
