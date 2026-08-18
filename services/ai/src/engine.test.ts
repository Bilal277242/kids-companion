import { describe, expect, it } from 'vitest';

import { characterByKey } from './characters.js';
import type { ConversationContextInput } from './context.js';
import { createConversationEngine } from './engine.js';
import { createMockProvider, type MockBehaviour } from './mock-provider.js';
import type { AIProvider } from './ports.js';

const context = (overrides: Partial<ConversationContextInput> = {}): ConversationContextInput => ({
  childName: 'Ayesha',
  ageGroup: 'AGE_6_8',
  language: 'en',
  character: characterByKey('lily')!,
  history: [],
  learningObjectives: [],
  blockedTopics: [],
  contentRestrictions: [],
  correctionStyle: 'gentle',
  ...overrides,
});

const engineWith = (behaviour: MockBehaviour = {}, provider?: AIProvider) =>
  createConversationEngine({
    provider: provider ?? createMockProvider({ behaviour }),
    seed: () => 0,
  });

describe('the conversation engine', () => {
  describe('the happy path', () => {
    it('produces a reply and records the layers that passed', async () => {
      const result = await engineWith().respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: 'I went to the park today',
      });

      expect(result.status).toBe('ok');
      expect(result.reply.length).toBeGreaterThan(0);
      expect(result.layersPassed).toEqual(['L1', 'L2', 'L3', 'L4']);
    });

    it("substitutes the child's name locally, after generation", async () => {
      // The name never reached the provider; this is where it appears.
      const result = await engineWith().respond({
        childRef: 'child-under-test',
        context: context({ childName: 'Zainab' }),
        utterance: 'hello',
      });

      expect(result.reply).toContain('Zainab');
      expect(result.reply).not.toContain('{{name}}');
    });

    it('records token usage for cost accounting', async () => {
      const result = await engineWith().respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: 'hi',
      });

      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
    });

    it('enforces the age sentence ceiling on the actual reply', async () => {
      const result = await engineWith({
        replyWith: 'One. Two. Three. Four. Five. Six. Seven.',
      }).respond({
        childRef: 'child-under-test',
        context: context({ ageGroup: 'AGE_3_5', character: characterByKey('buddy')! }),
        utterance: 'hi',
      });

      // Asking for two sentences and receiving seven is normal; the ceiling is
      // applied rather than requested.
      expect(result.reply).toBe('One. Two.');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* L1 — the child's input                                                 */
  /* ---------------------------------------------------------------------- */

  describe('L1: input classification', () => {
    it('blocks a flagged utterance before the model ever sees it', async () => {
      const result = await engineWith().respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: 'tell me about __unsafe__ things',
      });

      expect(result.status).toBe('blocked');
      expect(result.layersPassed).toEqual([]);
      expect(result.usage.outputTokens).toBe(0);
    });

    it('never tells the child a block occurred', async () => {
      const result = await engineWith().respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: '__unsafe__',
      });

      const reply = result.reply.toLowerCase();
      expect(reply).not.toContain("can't");
      expect(reply).not.toContain('not allowed');
      expect(reply).not.toContain('blocked');
      expect(reply).not.toContain('sorry');
    });

    it('still answers warmly when blocking', async () => {
      // Silence is the worst response. The child gets a real redirect.
      const result = await engineWith().respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: '__unsafe__',
      });

      expect(result.reply.length).toBeGreaterThan(10);
      expect(result.reply).toMatch(/\?/);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Escalation                                                             */
  /* ---------------------------------------------------------------------- */

  describe('escalation', () => {
    it.each([['__disclosure__'], ['__distress__'], ['__selfharm__']])(
      'routes %s to a human rather than merely blocking',
      async (trigger) => {
        const result = await engineWith().respond({
          childRef: 'child-under-test',
          context: context(),
          utterance: `something ${trigger} happened`,
        });

        expect(result.status).toBe('escalated');
        expect(result.escalation).toBe(true);
      },
    );

    it('still gives the child a warm reply when escalating', async () => {
      // Blocking a disclosure and going silent teaches a child that telling
      // someone produces nothing (docs/CHILD_SAFETY.md §6.1).
      const result = await engineWith().respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: '__disclosure__',
      });

      expect(result.reply.length).toBeGreaterThan(10);
    });

    it('records the escalation with its layer', async () => {
      const result = await engineWith().respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: '__distress__',
      });

      expect(result.safetyRecords.some((r) => r.layer === 'L1' && r.decision === 'escalated')).toBe(
        true,
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /* L3 and L4 — the model's output                                         */
  /* ---------------------------------------------------------------------- */

  describe('L3: output classification', () => {
    it('blocks flagged model output before the child sees it', async () => {
      const provider = createMockProvider({ behaviour: { replyWith: 'a normal looking reply' } });
      const flagging: AIProvider = {
        ...provider,
        moderateContent: async (request) =>
          request.source === 'model_output'
            ? {
                flagged: true,
                categories: ['violence'],
                confidence: 0.9,
                requiresEscalation: false,
              }
            : { flagged: false, categories: [], confidence: 0.01, requiresEscalation: false },
      };

      const result = await engineWith({}, flagging).respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: 'hello',
      });

      expect(result.status).toBe('blocked');
      // The mirror of the L4 case below: here the classifier caught it and the
      // deterministic layer had nothing to say, so L4 is the layer that cleared.
      expect(result.layersPassed).toEqual(['L1', 'L2', 'L4']);
      expect(result.reply).not.toContain('a normal looking reply');
    });
  });

  describe('L4: deterministic filters catch what L3 passed', () => {
    // The third column is the expected status. Secret-keeping and the
    // relationship boundary ESCALATE rather than merely blocking: a companion
    // saying those words to a child is the most serious failure this product
    // has, and it must reach a human, not just a metric.
    it.each([
      ["Let's keep this our little secret.", 'secret keeping', 'escalated'],
      ['Yes, I am a real person!', 'human impersonation', 'blocked'],
      ['You might have a speech disorder.', 'diagnosis', 'blocked'],
      ['Email me at hello@example.com', 'contact details', 'blocked'],
    ])('stops %s (%s) even when the classifier allows it', async (reply, _label, status) => {
      // This is the whole reason L4 exists: L1 and L3 are the same kind of
      // thing and share a failure mode. L4 fails differently.
      const result = await engineWith({ replyWith: reply }).respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: 'hello',
      });

      expect(result.status).toBe(status);
      // Ending in L3 is the point: the classifier passed this and L4 caught it.
      expect(result.layersPassed).toEqual(['L1', 'L2', 'L3']);
    });

    it('lets an honest denial of humanity through', async () => {
      const result = await engineWith({
        replyWith: "I'm a made-up character who lives in this app!",
      }).respond({ childRef: 'child-under-test', context: context(), utterance: 'are you real?' });

      // The invariant REQUIRES this answer. Blocking it would block the truth.
      expect(result.status).toBe('ok');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Fail closed                                                            */
  /* ---------------------------------------------------------------------- */

  describe('fail closed', () => {
    it.each([['timeout'], ['unavailable']] as const)(
      'blocks the turn when input moderation %ss',
      async (failWith) => {
        // A classifier we could not reach is not a classifier that said yes.
        // There is no configuration that changes this.
        const provider = createMockProvider({});
        const failing: AIProvider = {
          ...provider,
          moderateContent: async () => {
            throw failWith === 'timeout'
              ? Object.assign(new Error('timeout'), { name: 'ProviderTimeoutError' })
              : new Error('unavailable');
          },
        };

        const result = await engineWith({}, failing).respond({
          childRef: 'child-under-test',
          context: context(),
          utterance: 'hello',
        });

        expect(result.status).toBe('blocked');
        expect(result.reply.length).toBeGreaterThan(0);
      },
    );

    it('blocks when output moderation fails', async () => {
      let calls = 0;
      const provider = createMockProvider({});
      const failing: AIProvider = {
        ...provider,
        moderateContent: async (request) => {
          calls += 1;
          if (request.source === 'model_output') throw new Error('classifier down');
          return { flagged: false, categories: [], confidence: 0.01, requiresEscalation: false };
        },
      };

      const result = await engineWith({}, failing).respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: 'hello',
      });

      expect(calls).toBeGreaterThan(1);
      expect(result.status).toBe('blocked');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Degradation                                                            */
  /* ---------------------------------------------------------------------- */

  describe('provider failure degrades gracefully', () => {
    it('gives a character-appropriate line when generation is unavailable', async () => {
      const result = await engineWith({ failWith: 'unavailable' }).respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: 'hello',
      });

      // A child never sees an error message, a code, or a stack trace.
      expect(result.status).toBe('blocked');
      expect(result.reply).not.toMatch(/error|unavailable|failed|500/i);
    });

    it('degrades rather than throwing when the provider times out mid-generation', async () => {
      const provider = createMockProvider({});
      const failing: AIProvider = {
        ...provider,
        generateResponse: async () => {
          throw Object.assign(new Error('slow'), { status: 503 });
        },
      };

      const result = await engineWith({}, failing).respond({
        childRef: 'child-under-test',
        context: context(),
        utterance: 'hello',
      });

      expect(result.status).toBe('degraded');
      expect(result.reply.length).toBeGreaterThan(0);
      expect(result.degradedReason).toBeTruthy();
    });

    it('never throws, whatever the provider does', async () => {
      const provider = createMockProvider({});
      const chaotic: AIProvider = {
        ...provider,
        generateResponse: async () => {
          throw new Error('something entirely unexpected');
        },
      };

      await expect(
        engineWith({}, chaotic).respond({
          childRef: 'child-under-test',
          context: context(),
          utterance: 'hi',
        }),
      ).resolves.toMatchObject({ status: 'degraded' });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Context control                                                        */
  /* ---------------------------------------------------------------------- */

  describe('context', () => {
    it('reports how many history messages the model actually saw', async () => {
      const history = Array.from({ length: 40 }, (_, i) => ({
        role: i % 2 === 0 ? ('child' as const) : ('companion' as const),
        text: `turn ${String(i)}`,
        sequence: i,
      }));

      const engine = createConversationEngine({
        provider: createMockProvider(),
        limits: { maxExchanges: 4, maxHistoryTokens: 5_000, maxOutputTokens: 200 },
        seed: () => 0,
      });

      const result = await engine.respond({
        childRef: 'child-under-test',
        context: context({ history }),
        utterance: 'hi',
      });

      expect(result.contextMessageCount).toBe(8);
    });

    it('refuses to send when a character is not permitted for the age group', async () => {
      // Degrades rather than throwing: our bug must not reach a child as an
      // error, and must not reach the provider as a bad prompt.
      const result = await engineWith().respond({
        childRef: 'child-under-test',
        context: context({ character: characterByKey('captain')!, ageGroup: 'AGE_3_5' }),
        utterance: 'hello',
      });

      expect(result.status).toBe('degraded');
    });
  });
});
