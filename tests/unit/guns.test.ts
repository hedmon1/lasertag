import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GUN, GUNS, HP, gun, gunDoc, hitsToEliminate, isGunId, shotsPerSecond } from '../../src/game/guns.ts';

const rules = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../database.rules.json'), 'utf8'));
const playerRules = rules.rules.games.$code.players.$uid;

describe('the gun catalog', () => {
  it('has six guns with unique ids, names and colours', () => {
    expect(GUNS).toHaveLength(6);
    for (const key of ['id', 'name', 'color'] as const) expect(new Set(GUNS.map((g) => g[key])).size).toBe(GUNS.length);
  });

  it('gives each gun a different number of hits, fire rate or range, so the choice matters', () => {
    const feel = GUNS.map((g) => `${hitsToEliminate(g)}|${shotsPerSecond(g).toFixed(1)}|${g.rangeM}|${g.mode}`);
    expect(new Set(feel).size).toBe(GUNS.length);
  });

  it('counts the hits to eliminate from full health', () => {
    expect(GUNS.map((g) => [g.id, hitsToEliminate(g)])).toEqual([
      ['blip', 4], ['stinger', 8], ['triplet', 5], ['thumper', 3], ['boomstick', 2], ['longshot', 2],
    ]);
    for (const g of GUNS) {
      expect(g.damage * hitsToEliminate(g)).toBeGreaterThanOrEqual(HP);
      expect(g.damage * (hitsToEliminate(g) - 1)).toBeLessThan(HP);
    }
  });

  it('keeps the database cooldown under the gun’s own fire interval, so legal hits are never refused', () => {
    for (const g of GUNS) {
      const fastest = g.mode === 'burst' ? g.burst!.gapMs : g.fireMs;
      expect(g.cooldownMs).toBeLessThan(fastest);
      expect(g.cooldownMs).toBeGreaterThan(0);
    }
  });

  it('fits each reload inside its magazine of sound slots and each burst inside one pull', () => {
    for (const g of GUNS) {
      expect(g.reloadMs).toBeGreaterThanOrEqual(1500);
      expect(g.sound.takes).toBeGreaterThanOrEqual(2);
      if (g.mode === 'burst') {
        expect(g.burst!.count * g.burst!.gapMs).toBeLessThan(g.fireMs);
        expect(g.magazine % g.burst!.count).toBe(0);
      }
    }
  });

  it('falls back to the pistol for anything unknown', () => {
    expect(DEFAULT_GUN).toBe('blip');
    expect(gun('nope').id).toBe('blip');
    expect(gun(undefined).id).toBe('blip');
    expect(isGunId('boomstick')).toBe(true);
    expect(isGunId('Boomstick')).toBe(false);
  });
});

describe('the database rules agree with the catalog', () => {
  it('accepts exactly these guns, with their damage and cooldown', () => {
    const expected = GUNS.map((g) => `(newData.child('id').val() == '${g.id}' && newData.child('damage').val() == ${g.damage} && newData.child('cooldownMs').val() == ${g.cooldownMs})`).join(' || ');
    expect(playerRules.gun['.validate']).toBe(`newData.hasChildren(['id', 'damage', 'cooldownMs']) && (${expected})`);
  });

  it('writes the same record the rules check', () => {
    for (const g of GUNS) expect(gunDoc(g.id)).toEqual({ id: g.id, damage: g.damage, cooldownMs: g.cooldownMs });
  });

  it('takes damage and cooldown from the shooter’s gun, and locks guns during a game', () => {
    const shooterGun = "root.child('games').child($code).child('players').child(auth.uid).child('gun')";
    expect(playerRules.life['.write']).toContain(`${shooterGun}.child('damage').val()`);
    expect(playerRules.life['.write']).not.toContain("child('rules').child('damage')");
    expect(rules.rules.games.$code.shots.$id['.validate']).toContain(`${shooterGun}.child('cooldownMs').val()`);
    expect(playerRules.gun['.write']).toContain("child('state').val() != 'live'");
  });
});
