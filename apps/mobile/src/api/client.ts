import { toFriendlyFailure, type FriendlyFailure } from './errors.js';

/**
 * The API client.
 *
 * WHAT IS NOT IN THIS FILE, DELIBERATELY: no API key, no database credential, no
 * provider name, no admin endpoint. The app talks to our API and nothing else,
 * and the only secret it ever holds is the parent's own session token — which is
 * theirs, is short-lived, and is kept in the platform keystore rather than in
 * JavaScript memory or AsyncStorage.
 *
 * A mobile binary is a file an attacker can decompile at their leisure. Anything
 * embedded in it is public, so nothing is embedded in it.
 */

export interface ApiResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly failure?: FriendlyFailure;
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  /** Returns the current access token, or undefined when signed out. */
  readonly getToken: () => Promise<string | undefined>;
  /** Whether the device believes it has a connection. Checked BEFORE a request. */
  readonly isOnline: () => boolean;
  readonly fetchImpl?: typeof fetch;
  /** Injected so the timeout is testable without waiting. */
  readonly timeoutMs?: number;
  /** Called with the request id of every failure, for the support log. */
  readonly onFailure?: (failure: FriendlyFailure, route: string) => void;
}

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = <T>(failure: FriendlyFailure): ApiResult<T> => ({ ok: false, failure });

export const createApiClient = (options: ApiClientOptions) => {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const request = async <T>(
    method: 'GET' | 'POST' | 'PUT',
    route: string,
    init: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {},
  ): Promise<ApiResult<T>> => {
    // Checked BEFORE the request, so a child on a train gets the friendly line
    // immediately rather than after a fifteen-second timeout.
    if (!options.isOnline()) {
      const failure = toFriendlyFailure({ offline: true });
      options.onFailure?.(failure, route);
      return fail<T>(failure);
    }

    const token = await options.getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await doFetch(`${options.baseUrl}${route}`, {
        method,
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(init.json === undefined ? {} : { 'content-type': 'application/json' }),
          ...init.headers,
        },
        ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: controller.signal,
      });

      const text = await response.text();
      const parsed: unknown = text === '' ? {} : safeJson(text);

      if (!response.ok) {
        const failure = toFriendlyFailure({ status: response.status, body: parsed });
        options.onFailure?.(failure, route);
        return fail<T>(failure);
      }

      return ok(parsed as T);
    } catch (cause) {
      // An abort is our timeout; anything else is a transport problem, which on
      // a phone is almost always the network rather than the server.
      const timedOut = controller.signal.aborted;
      const failure = toFriendlyFailure({ timedOut, offline: !timedOut, cause });
      options.onFailure?.(failure, route);
      return fail<T>(failure);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    get: async <T>(route: string) => await request<T>('GET', route),
    post: async <T>(route: string, json?: unknown) => await request<T>('POST', route, { json }),
    put: async <T>(route: string, json?: unknown) => await request<T>('PUT', route, { json }),
    /** Multipart, for a voice turn or a practice attempt. */
    upload: async <T>(route: string, form: FormData) =>
      await request<T>('POST', route, { body: form as unknown as BodyInit }),
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    // A body we cannot parse is not a body worth surfacing. The caller will map
    // this to a friendly failure like any other.
    return {};
  }
};

/* -------------------------------------------------------------------------- */
/* The shapes this app actually uses                                           */
/* -------------------------------------------------------------------------- */
/* Only what a CHILD's screens need. No usage figures, no cost, no safety       */
/* internals, no plan details — all of that is the parent app's business.      */

export interface ChildSummary {
  readonly id: string;
  readonly displayName: string;
  readonly avatarKey?: string;
}

export interface CharacterSummary {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
  readonly tagline: string;
}

export interface Conversation {
  readonly id: string;
  readonly character: CharacterSummary;
  readonly status: 'active' | 'ended' | 'flagged';
}

export interface Turn {
  readonly status:
    'ok' | 'blocked' | 'escalated' | 'degraded' | 'ended' | 'unintelligible' | 'rejected';
  readonly reply: string;
  readonly audio?: { key: string; mimeType: string; durationMs: number } | null;
}

export interface PracticeTarget {
  readonly sequence: number;
  readonly text: string;
  readonly syllables: readonly string[];
  readonly hint: string | null;
}

export interface PracticeExercise {
  readonly exerciseKey: string;
  readonly title: string;
  readonly kind: 'word' | 'syllable';
  readonly targets: readonly PracticeTarget[];
}

export interface PracticeAttempt {
  readonly score: number;
  readonly feedback: { band: string; message: string; focus?: string; tryAgain: boolean };
  readonly newAchievements: readonly { key: string; title: string }[];
}
