import { describe, expect, it } from 'vitest';

import { createApiClient } from '../api/client.js';
import { createMemoryStore, createSessionStore } from '../state/session.js';

import {
  canReach,
  clearChild,
  navigate,
  parentRoute,
  type NavState,
  type Route,
} from './routes.js';

/**
 * Navigation, the session, and the client.
 *
 * The navigation assertions are about a property rather than a route table: a
 * child must never reach a screen that assumes something the state does not
 * have, and must always be able to get home. Both are easy to break by adding a
 * screen and easy to check here.
 */

const ALL_ROUTES: readonly Route[] = [
  'welcome',
  'parent_handoff',
  'child_select',
  'character_select',
  'home',
  'conversation',
  'voice',
  'story',
  'practice',
  'vocabulary',
  'achievements',
  'progress',
  'settings',
];

describe('reachability', () => {
  it('keeps a child out of screens that need one', () => {
    const empty: NavState = { route: 'welcome' };
    for (const route of ['home', 'practice', 'achievements', 'progress'] as const) {
      expect(canReach(empty, route), route).toBe(false);
    }
  });

  it('keeps a child out of a conversation with no character', () => {
    const chosen: NavState = { route: 'home', childId: 'c1' };
    expect(canReach(chosen, 'home')).toBe(true);
    expect(canReach(chosen, 'conversation')).toBe(false);
    expect(canReach({ ...chosen, characterSlug: 'buddy-the-dog' }, 'conversation')).toBe(true);
  });

  it('always allows the screens that need nothing', () => {
    const empty: NavState = { route: 'welcome' };
    for (const route of ['welcome', 'parent_handoff', 'child_select', 'settings'] as const) {
      expect(canReach(empty, route), route).toBe(true);
    }
  });
});

describe('navigating', () => {
  it('carries the child and character forward', () => {
    let state = navigate({ route: 'welcome' }, 'child_select');
    state = navigate(state, 'character_select', { childId: 'c1', childName: 'Rumi' });
    state = navigate(state, 'home', { characterSlug: 'buddy-the-dog' });

    expect(state).toMatchObject({
      route: 'home',
      childId: 'c1',
      childName: 'Rumi',
      characterSlug: 'buddy-the-dog',
    });
  });

  it('falls back rather than rendering a screen missing its id', () => {
    // The alternative is every screen defending itself against undefined, which
    // is thirteen places to forget.
    expect(navigate({ route: 'welcome' }, 'conversation').route).toBe('welcome');
    expect(navigate({ route: 'home', childId: 'c1' }, 'conversation').route).toBe('home');
  });

  it('gets home from anywhere in at most two steps', () => {
    // A four-year-old pressing back eleven times should reach home, not retrace
    // a path they do not remember taking.
    for (const route of ALL_ROUTES) {
      const first = parentRoute(route);
      const second = parentRoute(first);
      expect(['welcome', 'child_select', 'home'], route).toContain(second);
    }
  });

  it('forgets everything about a child when switching', () => {
    const cleared = clearChild({
      route: 'conversation',
      childId: 'c1',
      childName: 'Rumi',
      characterSlug: 'buddy-the-dog',
      conversationId: 'conv-1',
    });

    // A sibling picking up the tablet must not inherit the other child's
    // session, character, or open conversation.
    expect(cleared.childId).toBeUndefined();
    expect(cleared.characterSlug).toBeUndefined();
    expect(cleared.conversationId).toBeUndefined();
  });
});

describe('the session', () => {
  it('stores and clears the token', async () => {
    const store = createSessionStore(createMemoryStore());
    expect(await store.isSignedIn()).toBe(false);

    await store.signIn('token-abc');
    expect(await store.token()).toBe('token-abc');
    expect(await store.isSignedIn()).toBe(true);

    await store.signOut();
    // Cleared from the cache as well as the keystore, so a switched-away token
    // cannot be reused by the next request.
    expect(await store.token()).toBeUndefined();
  });
});

describe('the API client', () => {
  const clientWith = (
    fetchImpl: typeof fetch,
    overrides: { online?: boolean; token?: string } = {},
  ) =>
    createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => await Promise.resolve(overrides.token),
      isOnline: () => overrides.online ?? true,
      fetchImpl,
      timeoutMs: 50,
    });

  const jsonResponse = (status: number, body: unknown): Response =>
    ({
      ok: status < 400,
      status,
      text: async () => await Promise.resolve(JSON.stringify(body)),
    }) as unknown as Response;

  it('returns data on success', async () => {
    const client = clientWith(async () => await Promise.resolve(jsonResponse(200, { items: [1] })));
    const result = await client.get<{ items: number[] }>('/v1/children');

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ items: [1] });
  });

  it('does not even try when the device is offline', async () => {
    let called = false;
    const client = clientWith(
      async () => {
        called = true;
        return await Promise.resolve(jsonResponse(200, {}));
      },
      { online: false },
    );

    const result = await client.get('/v1/children');
    // Checked BEFORE the request, so a child on a train gets the friendly line
    // immediately rather than after a fifteen-second timeout.
    expect(called).toBe(false);
    expect(result.failure?.kind).toBe('offline');
  });

  it('sends the token when there is one, and no header when there is not', async () => {
    const seen: (Record<string, string> | undefined)[] = [];
    const capture: typeof fetch = async (_url, init) => {
      seen.push(init?.headers as Record<string, string> | undefined);
      return await Promise.resolve(jsonResponse(200, {}));
    };

    await clientWith(capture, { token: 'tok' }).get('/a');
    await clientWith(capture).get('/b');

    expect(seen[0]?.authorization).toBe('Bearer tok');
    expect(seen[1]?.authorization).toBeUndefined();
  });

  it('turns a server error into something friendly', async () => {
    const client = clientWith(
      async () =>
        await Promise.resolve(
          jsonResponse(500, { error: { code: 'INTERNAL_ERROR', requestId: 'req-1' } }),
        ),
    );

    const result = await client.get('/v1/children');
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe('server');
    // The request id is captured for support and is not in what a child sees.
    expect(result.failure?.requestId).toBe('req-1');
    expect(result.failure?.message).not.toContain('req-1');
  });

  it('survives a body that is not JSON', async () => {
    const client = clientWith(
      async () =>
        await Promise.resolve({
          ok: false,
          status: 502,
          text: async () => await Promise.resolve('<html>Bad Gateway</html>'),
        } as unknown as Response),
    );

    const result = await client.get('/v1/children');
    expect(result.failure?.kind).toBe('server');
    // A proxy's HTML must never reach a child's screen.
    expect(result.failure?.message).not.toContain('html');
  });

  it('treats a transport failure as a network problem', async () => {
    const client = clientWith(async () => {
      await Promise.resolve();
      throw new Error('Network request failed');
    });

    const result = await client.get('/v1/children');
    expect(['offline', 'slow']).toContain(result.failure?.kind);
    expect(result.failure?.message).not.toContain('Network request failed');
  });
});
