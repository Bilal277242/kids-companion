import type { ClassificationRequest, ClassificationResult, SafetyClassifier } from '@kids/safety';

import type { AIProvider } from './ports.js';

/**
 * Adapts an `AIProvider` to the safety subsystem's `SafetyClassifier` port.
 *
 * This file is the ONLY place the two packages meet, and the direction matters:
 * `@kids/safety` knows nothing about AI providers, conversations, or this
 * repository's vendor adapters. It asks for a thing that classifies text, and
 * this hands it one.
 *
 * Which means the classifier can be a different vendor from the conversation
 * model — or two vendors voting — by changing this file and nothing else. It
 * also means the safety subsystem is testable with a three-line fake, which is
 * why its adversarial corpus can run in milliseconds with no network.
 */
export const providerAsClassifier = (provider: AIProvider): SafetyClassifier => ({
  name: provider.name,
  model: provider.classifierModel,

  classify: async (request: ClassificationRequest): Promise<ClassificationResult> => {
    const result = await provider.moderateContent({
      text: request.text,
      ageGroup: request.ageGroup,
      language: request.language,
      source: request.scope,
      timeoutMs: request.timeoutMs,
    });

    return {
      flagged: result.flagged,
      categories: result.categories,
      confidence: result.confidence,
      requiresEscalation: result.requiresEscalation,
    };
  },
});
