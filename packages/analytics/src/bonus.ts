import type { PlayerId } from '@fpl/core';
import { BONUS_AWARDS } from '@fpl/core';

export interface BpsEntry {
  playerId: PlayerId;
  bps: number;
}

export interface BonusAward extends BpsEntry {
  bonus: number;
}

/**
 * Predicts bonus for one fixture's BPS scores. A tied group consumes as many
 * award slots as it has members: a 2-way tie for first takes slots 0 and 1
 * (both score 3, the 2 is skipped, the next distinct score gets 1), a 2-way
 * tie for second takes slots 1 and 2 (both score 2, nothing gets the 1), and a
 * tie for third only ever shares the single remaining slot. Anyone past the
 * award list gets 0. Output preserves the input order, not BPS order.
 */
export function predictBonus(entries: readonly BpsEntry[]): BonusAward[] {
  const sorted = [...entries].sort((a, b) => b.bps - a.bps);

  const groups: BpsEntry[][] = [];
  for (const entry of sorted) {
    const currentGroup = groups[groups.length - 1];
    if (currentGroup !== undefined && currentGroup[0]?.bps === entry.bps) {
      currentGroup.push(entry);
    } else {
      groups.push([entry]);
    }
  }

  const bonusByPlayerId = new Map<PlayerId, number>();
  let slot = 0;
  for (const group of groups) {
    if (slot >= BONUS_AWARDS.length) break;
    const award = BONUS_AWARDS[slot] ?? 0;
    for (const member of group) {
      bonusByPlayerId.set(member.playerId, award);
    }
    slot += group.length;
  }

  return entries.map((entry) => ({
    ...entry,
    bonus: bonusByPlayerId.get(entry.playerId) ?? 0,
  }));
}
