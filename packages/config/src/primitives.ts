import { z } from 'zod';

/**
 * Environment variables arrive as strings. These coerce to the intended type and
 * REJECT anything that does not parse, rather than quietly falling back to a
 * default — a misconfigured value that silently becomes `0` is worse than a
 * service that refuses to start.
 */

/** An integer, optionally with a default. `PORT=abc` fails; it does not become NaN. */
export const intFromEnv = (opts?: { min?: number; max?: number }) => {
  let schema = z.coerce.number().int();
  if (opts?.min !== undefined) schema = schema.min(opts.min);
  if (opts?.max !== undefined) schema = schema.max(opts.max);
  return schema;
};

/**
 * A boolean from the strings people actually write in `.env` files.
 * Anything else is an error — `ENABLED=yes` should not silently mean `false`.
 */
export const boolFromEnv = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0']))
  .transform((v) => v === 'true' || v === '1');

/** A comma-separated list, trimmed, with empties dropped. */
export const csvFromEnv = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )
  .pipe(z.array(z.string()));

/**
 * A duration written the way humans write it: `15m`, `30d`, `604800s`.
 * Normalised to seconds so nothing downstream has to guess at a unit.
 *
 * Takes the fallback as a string and applies it *before* the transform, so the
 * default is written in the same notation as the environment variable it stands
 * in for — `durationSecondsFromEnv('15m')`, not `.default(900)`.
 */
const durationBody = z
  .string()
  .regex(/^\d+[smhd]$/, 'must be a number followed by s, m, h, or d (e.g. "15m")')
  .transform((v) => {
    const amount = Number(v.slice(0, -1));
    const unit = v.slice(-1);
    const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86_400;
    return amount * multiplier;
  });

export const durationSecondsFromEnv = (fallback: string) =>
  z.string().default(fallback).pipe(durationBody);

/**
 * A secret. Required to be non-trivial, and never given a default — a default
 * for a signing key means a production system running on a value from a README.
 */
export const secretFromEnv = (minLength = 32) =>
  z
    .string()
    .min(minLength, `must be at least ${String(minLength)} characters of high-entropy material`)
    .refine((v) => !v.toLowerCase().includes('replace-me'), {
      message: 'is still set to the placeholder from .env.example',
    });

/** A URL that must be absolute. Relative values are a configuration bug. */
export const urlFromEnv = z.url();
