import type { Player, PlayerGameweek } from '@fpl/core';
import { toMillions, type Tenths } from '@fpl/core';
import { rollingForm } from './form.js';

/** Points earned per million of price. Guards the zero-price edge case, though the schema forbids it. */
export function pointsPerMillion(totalPoints: number, price: Tenths): number {
  const millions = toMillions(price);
  if (millions <= 0) return 0;
  return totalPoints / millions;
}

/** Points-per-game over the recent form window, per million of current price. */
export function formValuePerMillion(
  gameweeks: readonly PlayerGameweek[],
  windowSize: number,
  price: Tenths,
): number {
  const millions = toMillions(price);
  if (millions <= 0) return 0;
  const { pointsPerGame } = rollingForm(gameweeks, windowSize);
  return pointsPerGame / millions;
}

/** Price movement since the season started, in tenths. Positive is a rise. */
export function priceChange(currentPrice: Tenths, startPrice: Tenths): Tenths {
  return currentPrice - startPrice;
}

export interface ValueMetrics {
  pointsPerMillion: number;
  formValuePerMillion: number;
  priceChange: Tenths;
}

/** Combined value read for one player, given their recent gameweeks for the form window. */
export function valueMetrics(
  player: Player,
  recentGameweeks: readonly PlayerGameweek[],
  windowSize: number,
): ValueMetrics {
  return {
    pointsPerMillion: pointsPerMillion(player.totalPoints, player.price),
    formValuePerMillion: formValuePerMillion(recentGameweeks, windowSize, player.price),
    priceChange: priceChange(player.price, player.startPrice),
  };
}
