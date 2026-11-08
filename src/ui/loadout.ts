// The gun you picked in the Armory, kept on this phone between games.
import { DEFAULT_GUN, isGunId, type GunId } from '../game/guns.ts';
import { load, save } from './storage.ts';

export function savedGun(): GunId {
  const id = load('gun');
  return isGunId(id) ? id : DEFAULT_GUN;
}

export function saveGun(id: GunId) {
  save('gun', id);
}
