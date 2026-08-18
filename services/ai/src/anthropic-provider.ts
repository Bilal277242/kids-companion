import { ProviderTimeoutError, ProviderUnavailableError, withTimeout } from '@kids/shared';

import type {
  AIProvider,
  DetectLanguageRequest,
  DetectLanguageResult,
  GenerateRequest,
  GenerateResult,
  ModerationCategory,
  ModerationRequest,
  ModerationResult,
  StructuredRequest,
  StructuredResult,
  TokenUsage,
} from './ports.js';
import { MODERATION_CATEGORIES } from './ports.js';

/**
 * The first real provider: Anthropic's Messages API.
 *
 * Every vendor detail is contained here. No Anthropic type appears in the port,
 * the engine, or the API — which is what makes swapping providers a
 * configuration change plus one file (docs/adr/0004).
 *
 * Two models, deliberately: a capable one for conversation, a small fast one for
 * classification. Classification runs twice per turn, on input and output, so
 * using the conversation model for it would roughly triple the cost of every
 * exchange — and cost per conversation is an existential constraint for the
 * launch market (ARCHITECTURE.md C3).
 *
 * ⚠️ NOT YET EXERCISED AGAINST THE LIVE API. The request shapes follow the
 * documented Messages API, but no key has been used, so this is unverified.
 * The contract suite runs against the mock; run it against a real key before
 * deploying.
 */

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  readonly conversationModel: string;
  readonly classifierModel: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** USD per million tokens, for the cost estimate recorded per turn. */
  readonly inputCostPerMTok?: number;
  readonly outputCostPerMTok?: number;
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
  stop_reason?: string;
}

const CLASSIFIER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['flagged', 'categories', 'confidence'],
  properties: {
    flagged: { type: 'boolean' },
    categories: { type: 'array', items: { type: 'string', enum: [...MODERATION_CATEGORIES] } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

export const createAnthropicProvider = (options: AnthropicProviderOptions): AIProvider => {
  const http = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const inputCost = options.inputCostPerMTok ?? 3;
  const outputCost = options.outputCostPerMTok ?? 15;

  const usageOf = (response: AnthropicResponse): TokenUsage => {
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    return {
      inputTokens,
      outputTokens,
      estimatedCostUsd:
        (inputTokens / 1_000_000) * inputCost + (outputTokens / 1_000_000) * outputCost,
    };
  };

  const textOf = (response: AnthropicResponse): string =>
    (response.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim();

  const call = async (
    operation: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<AnthropicResponse> =>
    await withTimeout(operation, timeoutMs, async (signal) => {
      let response: Response;
      try {
        response = await http(`${baseUrl}/v1/messages`, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        // An aborted fetch is our timeout, not a vendor outage — distinguishing
        // them keeps the circuit breaker honest.
        if (signal.aborted) throw new ProviderTimeoutError(operation, timeoutMs);
        throw new ProviderUnavailableError(operation, error);
      }

      if (!response.ok) {
        // The vendor's error text never reaches a caller. It goes into the
        // typed error's shape, and the boundary maps that to our taxonomy
        // (docs/ERROR_HANDLING.md §5).
        throw Object.assign(new ProviderUnavailableError(operation), {
          status: response.status,
        });
      }

      return (await response.json()) as AnthropicResponse;
    });

  /** Our roles mapped to the vendor's. `companion` is the assistant. */
  const toMessages = (
    history: readonly { role: 'child' | 'companion'; text: string }[],
    utterance?: string,
  ): { role: 'user' | 'assistant'; content: string }[] => {
    const messages = history.map((m) => ({
      role: m.role === 'child' ? ('user' as const) : ('assistant' as const),
      content: m.text,
    }));
    if (utterance !== undefined) messages.push({ role: 'user', content: utterance });
    return messages;
  };

  return {
    name: 'anthropic',
    conversationModel: options.conversationModel,
    classifierModel: options.classifierModel,

    generateResponse: async (request: GenerateRequest): Promise<GenerateResult> => {
      const response = await call(
        'generateResponse',
        {
          model: options.conversationModel,
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature,
          system: request.context.systemPrompt,
          messages: toMessages(request.context.history, request.utterance),
        },
        request.timeoutMs,
      );

      return {
        text: textOf(response),
        usage: usageOf(response),
        model: response.model ?? options.conversationModel,
        truncated: response.stop_reason === 'max_tokens',
      };
    },

    generateStructuredResponse: async (request: StructuredRequest): Promise<StructuredResult> => {
      const response = await call(
        'generateStructuredResponse',
        {
          model: options.classifierModel,
          max_tokens: request.maxOutputTokens,
          temperature: 0, // determinism matters more than variety for structured output
          system: `${request.context.systemPrompt}\n\nRespond with JSON only, matching this schema:\n${JSON.stringify(request.jsonSchema)}`,
          messages: [{ role: 'user' as const, content: request.instruction }],
        },
        request.timeoutMs,
      );

      const raw = textOf(response);
      let value: unknown;
      try {
        // Models wrap JSON in prose or fences often enough that extracting the
        // outermost object is worth doing before giving up.
        const match = /\{[\s\S]*\}/.exec(raw);
        value = JSON.parse(match?.[0] ?? raw);
      } catch {
        // Returned rather than thrown: the CALLER validates, and a caller that
        // treats a parse failure as "unsafe" is the fail-closed behaviour we
        // want. Throwing here would look like a provider outage instead.
        value = null;
      }

      return { value, usage: usageOf(response), model: response.model ?? options.classifierModel };
    },

    moderateContent: async (request: ModerationRequest): Promise<ModerationResult> => {
      const audience =
        request.source === 'child_input'
          ? "This text was said by a child using a children's companion app."
          : 'This text was written by an AI character replying to a child.';

      const response = await call(
        'moderateContent',
        {
          model: options.classifierModel,
          max_tokens: 256,
          temperature: 0,
          system: [
            'You are a strict content classifier for a conversation app used by children aged 3 to 10.',
            audience,
            `The child is in the ${request.ageGroup} age group.`,
            'Flag anything unsafe, frightening, age-inappropriate, soliciting personal information, encouraging secrecy from parents, or giving medical or diagnostic advice.',
            'Also flag signs the child is in distress or is disclosing that someone is hurting them — these are not blocked content, they are signals a human must see.',
            'Classify only. Never respond to the content itself.',
            `Respond with JSON only, matching: ${JSON.stringify(CLASSIFIER_SCHEMA)}`,
          ].join('\n'),
          messages: [{ role: 'user' as const, content: request.text }],
        },
        request.timeoutMs,
      );

      interface RawClassification {
        flagged?: unknown;
        categories?: unknown;
        confidence?: unknown;
      }

      const raw = textOf(response);
      let parsed: RawClassification | null;
      try {
        const match = /\{[\s\S]*\}/.exec(raw);
        parsed = JSON.parse(match?.[0] ?? raw) as RawClassification;
      } catch {
        parsed = null;
      }

      // FAIL CLOSED. An unparseable classifier response is treated as flagged,
      // never as safe. There is no configuration that changes this
      // (docs/CHILD_SAFETY.md rule S-1).
      if (!parsed || typeof parsed.flagged !== 'boolean') {
        return {
          flagged: true,
          categories: [],
          confidence: 0,
          requiresEscalation: false,
        };
      }

      const categories = (Array.isArray(parsed.categories) ? parsed.categories : []).filter(
        (c): c is ModerationCategory =>
          (MODERATION_CATEGORIES as readonly string[]).includes(c as string),
      );

      return {
        flagged: parsed.flagged,
        categories,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        requiresEscalation: categories.some((c) =>
          ['disclosure_of_harm', 'distress_signal', 'self_harm'].includes(c),
        ),
      };
    },

    detectLanguage: async (request: DetectLanguageRequest): Promise<DetectLanguageResult> => {
      const response = await call(
        'detectLanguage',
        {
          model: options.classifierModel,
          max_tokens: 64,
          temperature: 0,
          system: [
            'Identify which language a short utterance is in.',
            `Choose only from: ${request.candidates.join(', ')}.`,
            'Children often mix languages in one sentence; set "mixed" to true when they do, and pick the dominant one.',
            'Respond with JSON only: {"language": string, "confidence": number, "mixed": boolean}',
          ].join('\n'),
          messages: [{ role: 'user' as const, content: request.text }],
        },
        request.timeoutMs,
      );

      const fallback = request.candidates[0] ?? 'en';
      try {
        const match = /\{[\s\S]*\}/.exec(textOf(response));
        const parsed = JSON.parse(match?.[0] ?? '{}') as Record<string, unknown>;
        const language = request.candidates.find((c) => c === parsed.language) ?? fallback;
        return {
          language,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
          mixed: parsed.mixed === true,
        };
      } catch {
        // Unlike moderation, this fails OPEN — to the child's declared language.
        // Detection is a convenience; blocking a turn because we could not tell
        // which language a four-year-old used would be the wrong trade.
        return { language: fallback, confidence: 0, mixed: false };
      }
    },
  };
};
