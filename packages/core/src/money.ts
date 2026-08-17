/**
 * FPL prices are integers in tenths of a million (55 means 5.5m). Every price
 * stays an integer internally; floats only appear at display time, so budget
 * arithmetic in the optimiser is exact.
 */

export type Tenths = number;

export const toMillions = (tenths: Tenths): number => tenths / 10;

export const fromMillions = (millions: number): Tenths => Math.round(millions * 10);

export const formatPrice = (tenths: Tenths): string => `${toMillions(tenths).toFixed(1)}m`;
