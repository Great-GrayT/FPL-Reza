import { NotFoundError } from '@fpl/core';
import type { Codec } from '../codec.js';
import type { Format } from '../types.js';
import { jsonlCodec } from './jsonl.js';
import { parquetCodec } from './parquet.js';

const CODECS = new Map<Format, Codec>([
  [jsonlCodec.format, jsonlCodec],
  [parquetCodec.format, parquetCodec],
]);

export function codecFor(format: Format): Codec {
  const codec = CODECS.get(format);
  if (codec === undefined) throw new NotFoundError(`codec "${format}"`);
  return codec;
}

/** Reverse lookup used when reading a snapshot whose format is only in its filename. */
export function codecForExtension(extension: string): Codec {
  for (const codec of CODECS.values()) {
    if (codec.extension === extension) return codec;
  }
  throw new NotFoundError(`codec for extension ".${extension}"`);
}

export { jsonlCodec, parquetCodec };
