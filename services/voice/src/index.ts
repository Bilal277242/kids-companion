/**
 * @kids/voice — speech-to-text and text-to-speech.
 *
 * Phase 3 delivers the adapters, audio format normalisation, the content-hash
 * TTS cache, and per-stage latency instrumentation against the budget in
 * ARCHITECTURE.md §7.1.
 *
 * The STT vendor is undecided pending spike S-1 (Q-01). The port exists so the
 * rest of the system can be built without that answer.
 */

export type * from './ports.js';
