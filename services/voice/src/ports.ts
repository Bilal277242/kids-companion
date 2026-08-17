import type { AgeGroup, SupportedLanguage } from '@kids/types';

/**
 * Speech-to-text and text-to-speech ports.
 *
 * These are deliberately separate: the STT vendor and the TTS vendor are chosen
 * on entirely different criteria (Urdu child-speech accuracy versus voice
 * character and per-character pricing) and there is no reason to assume one
 * vendor wins both. See docs/adr/0004-provider-abstraction.md.
 */

/* -------------------------------------------------------------------------- */
/* Speech to text                                                              */
/* -------------------------------------------------------------------------- */

export interface TranscriptionRequest {
  readonly audio: Uint8Array;
  readonly mimeType: string;
  /**
   * A constrained hypothesis set from the child's profile — never autodetect.
   * Pakistani households code-switch mid-sentence, and autodetect on a 4-year-
   * old's two-second utterance produces nonsense that then reaches the model.
   * See ARCHITECTURE.md §7.2.
   */
  readonly languageHints: readonly SupportedLanguage[];
  readonly ageGroup: AgeGroup;
  readonly timeoutMs: number;
}

export interface Transcription {
  readonly text: string;
  /**
   * Drives the "I didn't quite catch that" path. Low confidence on child speech
   * is expected, not exceptional — see R-01.
   */
  readonly confidence: number;
  readonly detectedLanguage?: SupportedLanguage;
  readonly durationMs: number;
}

export interface SpeechToTextProvider {
  readonly name: string;
  /**
   * Implementations MUST NOT persist the audio. Raw child audio is transcribed
   * and discarded — see docs/adr/0006-voice-pipeline-and-audio-retention.md.
   */
  transcribe(request: TranscriptionRequest): Promise<Transcription>;
}

/* -------------------------------------------------------------------------- */
/* Text to speech                                                              */
/* -------------------------------------------------------------------------- */

export interface SynthesisRequest {
  readonly text: string;
  readonly voiceId: string;
  readonly language: SupportedLanguage;
  readonly timeoutMs: number;
}

export interface SynthesisResult {
  readonly audio: Uint8Array;
  readonly mimeType: string;
  readonly durationMs: number;
  /** True when served from the content-hash cache — the largest single cost lever. */
  readonly fromCache: boolean;
}

export interface TextToSpeechProvider {
  readonly name: string;
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
}
