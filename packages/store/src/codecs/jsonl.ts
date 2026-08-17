import { ValidationError } from '@fpl/core';
import { serializeRow, type Codec, type Row } from '../codec.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Newline delimited JSON. Human readable, diff friendly, and appendable,
 * which makes it the right default while a dataset's shape is still moving.
 */
export const jsonlCodec: Codec = {
  format: 'jsonl',
  extension: 'jsonl',

  encode(rows: readonly Row[]): Uint8Array {
    const body = rows.map((row) => JSON.stringify(serializeRow(row))).join('\n');
    return encoder.encode(rows.length === 0 ? '' : `${body}\n`);
  },

  decode(bytes: Uint8Array): Row[] {
    const text = decoder.decode(bytes);
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    return lines.map((line, index) => {
      try {
        return JSON.parse(line) as Row;
      } catch (cause) {
        throw new ValidationError(`malformed JSONL on line ${index + 1}`, [], { cause });
      }
    });
  },
};
