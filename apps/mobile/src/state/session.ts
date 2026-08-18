import type { FriendlyFailure } from '../api/errors.js';

/**
 * The session.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CHILD APP NEVER HOLDS A CREDENTIAL OF ITS OWN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * There is no child login (that decision predates this app: children are
 * profiles owned by a parent, not accounts). What the app holds is the PARENT's
 * access token, obtained by a grown-up on the handoff screen and kept in the
 * platform keystore — Keychain on iOS, Keystore on Android — rather than in
 * AsyncStorage, which is a plaintext file any backup or rooted device can read.
 *
 * No API key, no database credential, and no admin capability is present in this
 * binary at all. A mobile app is a file an attacker can decompile at leisure, so
 * anything embedded in it is public.
 */

export interface SecureStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const ACCESS_TOKEN = 'kc.access_token';

export interface Session {
  readonly signedIn: boolean;
  readonly failure?: FriendlyFailure;
}

export const createSessionStore = (store: SecureStore) => {
  // Cached in memory so the hot path does not hit the keystore on every request,
  // and cleared on sign-out so a switched-away token cannot be reused.
  let cached: string | undefined;

  return {
    token: async (): Promise<string | undefined> => {
      if (cached !== undefined) return cached;
      cached = await store.get(ACCESS_TOKEN);
      return cached;
    },

    signIn: async (accessToken: string): Promise<void> => {
      cached = accessToken;
      await store.set(ACCESS_TOKEN, accessToken);
    },

    signOut: async (): Promise<void> => {
      cached = undefined;
      await store.remove(ACCESS_TOKEN);
    },

    isSignedIn: async (): Promise<boolean> => (await store.get(ACCESS_TOKEN)) !== undefined,
  };
};

export type SessionStore = ReturnType<typeof createSessionStore>;

/** An in-memory store, for tests. Never used on a device. */
export const createMemoryStore = (): SecureStore => {
  const map = new Map<string, string>();
  return {
    get: async (key) => await Promise.resolve(map.get(key)),
    set: async (key, value) => {
      map.set(key, value);
      await Promise.resolve();
    },
    remove: async (key) => {
      map.delete(key);
      await Promise.resolve();
    },
  };
};
