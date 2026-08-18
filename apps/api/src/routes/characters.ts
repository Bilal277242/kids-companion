import type { Queryable } from '@kids/db';
import type { AgeGroup } from '@kids/types';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { requireChildOwnership } from '../plugins/auth.js';

/**
 * The character catalogue.
 *
 *   GET /v1/characters              every character this family may use
 *   GET /v1/characters?childId=…    narrowed to what THIS child may use
 *
 * Reads the `character_catalogue` VIEW rather than the table, so `voice_config`
 * and `prompt_key` cannot reach a client by someone adding a column and
 * selecting `*` later. A child's device has no use for a vendor voice id, and a
 * field that never arrives is a field that cannot leak from a phone.
 */

const characterSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  tagline: z.string(),
  description: z.string(),
  /** The three descriptive dimensions a parent might reasonably want to see. */
  personality: z.array(z.string()),
  conversationStyle: z.string(),
  storyStyle: z.string(),
  educationalObjectives: z.array(z.string()),
  ageGroups: z.array(z.string()),
  avatarKey: z.string().nullable(),
  requiresPaidPlan: z.boolean(),
});

interface CatalogueRow {
  id: string;
  slug: string;
  display_name: string;
  tagline: string;
  description: string;
  allowed_age_groups: string[];
  avatar_key: string | null;
  personality_traits: string[];
  conversation_style: string;
  story_style: string;
  educational_objectives: string[];
  requires_paid_plan: boolean;
}

const present = (row: CatalogueRow) => ({
  id: row.id,
  slug: row.slug,
  displayName: row.display_name,
  tagline: row.tagline,
  description: row.description,
  personality: row.personality_traits,
  conversationStyle: row.conversation_style,
  storyStyle: row.story_style,
  educationalObjectives: row.educational_objectives,
  ageGroups: row.allowed_age_groups,
  avatarKey: row.avatar_key,
  requiresPaidPlan: row.requires_paid_plan,
});

const loadCatalogue = async (tx: Queryable, ageGroup?: AgeGroup): Promise<CatalogueRow[]> => {
  const { rows } = await tx.query<CatalogueRow>(
    `select id, slug, display_name, tagline, description, allowed_age_groups, avatar_key,
            personality_traits, conversation_style, story_style, educational_objectives,
            requires_paid_plan
       from character_catalogue
      where $1::text is null or $1 = any(allowed_age_groups)
      order by sort_order`,
    [ageGroup ?? null],
  );
  return rows;
};

export const characterRoutes = (): FastifyPluginAsyncZod => async (app) => {
  app.get(
    '/v1/characters',
    {
      onRequest: [app.authenticate],
      preHandler: [app.authorize('conversations:read_own')],
      schema: {
        description: 'The character catalogue, optionally narrowed to one child.',
        querystring: z.object({ childId: z.uuid().optional() }),
        response: { 200: z.object({ items: z.array(characterSchema) }) },
      },
    },
    async (request, reply) => {
      const items = await app.withParent(request, async (tx) => {
        if (request.query.childId === undefined) return await loadCatalogue(tx);

        await requireChildOwnership(tx, request.query.childId);

        const { rows } = await tx.query<{ age_group: AgeGroup }>(
          `select app.age_group(birth_year, birth_month) as age_group
             from children where id = $1 and deleted_at is null`,
          [request.query.childId],
        );

        // Age narrows the catalogue the same way it narrows practice content and
        // for the same reason: what a child is offered gets smaller as they get
        // younger, never larger.
        return await loadCatalogue(tx, rows[0]?.age_group);
      });

      return await reply.status(200).send({ items: items.map(present) });
    },
  );
};
