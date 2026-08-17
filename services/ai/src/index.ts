/**
 * @kids/ai — conversation generation and safety classification.
 *
 * Phase 2 delivers: adapters (Anthropic + mock), the versioned prompt registry,
 * age-band adaptation, the L1–L5 safety chain, and per-turn cost accounting.
 *
 * The mock adapter is the default in `local` and `ci`, so a fresh clone runs the
 * full loop with no API keys.
 */

export type * from './ports.js';
