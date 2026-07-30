import { newId } from '../../shared/util.js';
import type { Alliance, GameState, Player } from '../game/state.js';

/**
 * Trading blocs. An alliance is a named group whose members are tagged in chat
 * and on the leaderboard, and whose combined net worth is ranked against rival
 * blocs — so cooperation shows up on the scoreboard as well as in the ledger.
 */

export const MAX_ALLIANCE_MEMBERS = 20;

export type AllianceError = 'name' | 'taken' | 'already' | 'missing' | 'full' | 'none';

export function createAlliance(
  state: GameState,
  founder: Player,
  rawName: string,
): { ok: boolean; reason?: AllianceError; alliance?: Alliance } {
  if (founder.allianceId) return { ok: false, reason: 'already' };
  const name = rawName.trim().slice(0, 24);
  if (name.length < 3) return { ok: false, reason: 'name' };
  for (const a of state.alliances.values()) {
    if (a.name.toLowerCase() === name.toLowerCase()) return { ok: false, reason: 'taken' };
  }

  const alliance: Alliance = {
    id: newId('al'),
    name,
    founderId: founder.id,
    members: [founder.id],
    createdAt: Date.now(),
  };
  state.alliances.set(alliance.id, alliance);
  founder.allianceId = alliance.id;
  return { ok: true, alliance };
}

export function joinAlliance(
  state: GameState,
  player: Player,
  allianceId: string,
): { ok: boolean; reason?: AllianceError; alliance?: Alliance } {
  if (player.allianceId) return { ok: false, reason: 'already' };
  const alliance = state.alliances.get(allianceId);
  if (!alliance) return { ok: false, reason: 'missing' };
  if (alliance.members.length >= MAX_ALLIANCE_MEMBERS) return { ok: false, reason: 'full' };

  alliance.members.push(player.id);
  player.allianceId = alliance.id;
  return { ok: true, alliance };
}

export function leaveAlliance(state: GameState, player: Player): { ok: boolean; reason?: AllianceError } {
  if (!player.allianceId) return { ok: false, reason: 'none' };
  const alliance = state.alliances.get(player.allianceId);
  player.allianceId = null;
  if (!alliance) return { ok: true };

  alliance.members = alliance.members.filter((id) => id !== player.id);
  // An alliance with nobody left in it is dissolved rather than kept as a ghost.
  if (alliance.members.length === 0) {
    state.alliances.delete(alliance.id);
  } else if (alliance.founderId === player.id) {
    alliance.founderId = alliance.members[0];
  }
  return { ok: true };
}

export function allianceOf(state: GameState, player: Player): Alliance | null {
  return player.allianceId ? state.alliances.get(player.allianceId) ?? null : null;
}

/** Prunes memberships pointing at players or alliances that no longer exist. */
export function pruneAlliances(state: GameState) {
  for (const [id, alliance] of state.alliances) {
    alliance.members = alliance.members.filter((memberId) => {
      const member = state.players.get(memberId);
      return member !== undefined && member.allianceId === id;
    });
    if (alliance.members.length === 0) state.alliances.delete(id);
  }
}
