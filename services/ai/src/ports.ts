import type { AgeGroup, SafetyDecision, SafetyLayer, SupportedLanguage } from '@kids/types';

/**
 * Ports for AI capabilities. These interfaces are shaped by what the *domain*
 * needs, never by what a vendor's SDK happens to offer — a port shaped around
 * one vendor is not an abstraction. See docs/adr/0004-provider-abstraction.md.
 *
 * Every adapter, including the mock, passes the identical contract suite in
 * tests/contract/. That is what makes swapping a vendor a configuration change
 * with evidence behind it rather than a hopeful refactor.
 */

/* -------------------------------------------------------------------------- */
/* Conversation                                                                */
/* -------------------------------------------------------------------------- */

export interface ConversationContext {
  readonly ageGroup: AgeGroup;
  readonly language: SupportedLanguage;
  readonly characterId: string;
  /** Pinned prompt version. A prompt change is a safety change and is reviewed as one. */
  readonly promptVersion: string;
  /** Bounded recent context. Never the full history — see PRIVACY.md §5. */
  readonly recentTurns: readonly { readonly role: 'child' | 'companion'; readonly text: string }[];
}

export interface ConversationRequest {
  readonly utterance: string;
  readonly context: ConversationContext;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

export interface ConversationUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Recorded per turn. Cost per conversation is a first-class metric — see ARCHITECTURE.md C3. */
  readonly estimatedCostUsd: number;
}

export interface ConversationChunk {
  readonly text: string;
  readonly isFinal: boolean;
}

export interface ConversationProvider {
  readonly name: string;
  /**
   * Streamed so the output classifier can halt mid-generation, before an unsafe
   * response is fully produced, billed, and sent to text-to-speech.
   */
  generate(request: ConversationRequest): AsyncIterable<ConversationChunk>;
  lastUsage(): ConversationUsage | undefined;
}

/* -------------------------------------------------------------------------- */
/* Safety classification                                                       */
/* -------------------------------------------------------------------------- */

export interface SafetyClassificationRequest {
  readonly text: string;
  readonly ageGroup: AgeGroup;
  readonly language: SupportedLanguage;
  readonly layer: SafetyLayer;
  readonly timeoutMs: number;
}

export interface SafetyClassification {
  readonly decision: SafetyDecision;
  readonly categories: readonly string[];
  readonly confidence: number;
}

export interface SafetyClassifier {
  readonly name: string;
  /**
   * Callers MUST fail closed: an error, a timeout, or a malformed response blocks
   * the turn. There is no configuration that changes this — see
   * docs/CHILD_SAFETY.md rule S-1.
   */
  classify(request: SafetyClassificationRequest): Promise<SafetyClassification>;
}
