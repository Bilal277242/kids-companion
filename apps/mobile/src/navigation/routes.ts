/**
 * Where the child can be.
 *
 * A plain state machine rather than a navigation library. Child mode has no back
 * button, no deep links, no tabs, and no history a child would ever use — the
 * thirteen screens form a small graph, and modelling that directly is both
 * smaller than the library and easier to reason about.
 *
 * THE ROUTES ARE ALSO A PERMISSION BOUNDARY: `canReach` is what stops a child
 * arriving somewhere that assumes a child is selected, and it is the reason no
 * screen has to defend itself against a missing id.
 */

export type Route =
  | 'welcome'
  | 'parent_handoff'
  | 'child_select'
  | 'character_select'
  | 'home'
  | 'conversation'
  | 'voice'
  | 'story'
  | 'practice'
  | 'vocabulary'
  | 'achievements'
  | 'progress'
  | 'settings';

export interface NavState {
  readonly route: Route;
  readonly childId?: string;
  readonly childName?: string;
  readonly characterSlug?: string;
  readonly conversationId?: string;
}

/** Routes that need a signed-in parent AND a chosen child. */
const NEEDS_CHILD: ReadonlySet<Route> = new Set<Route>([
  'character_select',
  'home',
  'conversation',
  'voice',
  'story',
  'practice',
  'vocabulary',
  'achievements',
  'progress',
]);

/** Routes that additionally need a character. */
const NEEDS_CHARACTER: ReadonlySet<Route> = new Set<Route>(['conversation', 'voice', 'story']);

export const canReach = (state: NavState, route: Route): boolean => {
  if (NEEDS_CHILD.has(route) && state.childId === undefined) return false;
  if (NEEDS_CHARACTER.has(route) && state.characterSlug === undefined) return false;
  return true;
};

/**
 * Where "back" goes.
 *
 * Every route has ONE parent, so a child can always get home in at most two
 * taps and can never end up somewhere they cannot leave. There is no history
 * stack: a four-year-old pressing back eleven times should reach home, not
 * retrace a path they do not remember taking.
 */
export const parentRoute = (route: Route): Route => {
  // The default IS the rule here: every screen below home returns home, and
  // listing all thirteen would hide that behind a wall of cases.
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
  switch (route) {
    case 'welcome':
    case 'parent_handoff':
      return 'welcome';
    case 'child_select':
      return 'welcome';
    case 'character_select':
      return 'child_select';
    case 'home':
      return 'child_select';
    default:
      return 'home';
  }
};

export const navigate = (
  state: NavState,
  route: Route,
  patch: Partial<NavState> = {},
): NavState => {
  const next: NavState = { ...state, ...patch, route };
  // A navigation the state cannot support goes home rather than to a screen that
  // would have to defend itself against a missing id.
  return canReach(next, route)
    ? next
    : { ...next, route: next.childId === undefined ? 'welcome' : 'home' };
};

/** Clears everything about a child. Used on "switch child" and on sign-out. */
export const clearChild = (state: NavState): NavState => ({
  route: state.route === 'welcome' ? 'welcome' : 'child_select',
});
