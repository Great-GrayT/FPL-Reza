import { z } from 'zod';
import { ValidationError } from './errors.js';

export const POSITIONS = ['GKP', 'DEF', 'MID', 'FWD'] as const;
export type Position = (typeof POSITIONS)[number];

export const positionSchema = z.enum(POSITIONS);

/** FPL transmits position as `element_type`, an integer 1 through 4. */
const BY_ELEMENT_TYPE = new Map<number, Position>([
  [1, 'GKP'],
  [2, 'DEF'],
  [3, 'MID'],
  [4, 'FWD'],
]);

export function positionFromElementType(elementType: number): Position {
  const position = BY_ELEMENT_TYPE.get(elementType);
  if (position === undefined) {
    throw new ValidationError(`unknown element_type ${elementType}`, [
      `expected one of ${[...BY_ELEMENT_TYPE.keys()].join(', ')}`,
    ]);
  }
  return position;
}

export function elementTypeFromPosition(position: Position): number {
  return POSITIONS.indexOf(position) + 1;
}
