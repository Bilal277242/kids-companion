import { colors, fontSizes, radii, spacing, touchTargets } from '@kids/ui';

/**
 * Child-mode theme.
 *
 * Extends the shared tokens rather than redefining them. What is added here is
 * everything that only makes sense for a screen a small child is holding:
 * character colours, the size of the one button that matters, and durations
 * chosen so that motion reads as alive rather than as urgent.
 *
 * THE TYPOGRAPHY RULE: nothing a pre-reader must understand is carried by text
 * alone. Every screen works from colour, shape, character, and voice; text is a
 * second channel for the children who can use it. That is why sizes start large
 * and why no screen depends on a sentence being read.
 */

export const childTheme = {
  colors: {
    ...colors,
    background: colors.playBackground,
    accent: colors.playAccent,
    /** Warm, distinct, and distinguishable without relying on hue alone. */
    buddy: '#f2a03d',
    lily: '#a978d8',
    captain: '#3d8ce0',
    professor: '#3fa37a',
    /** The talk button while listening. Deliberately not red — red means stop. */
    listening: '#2f9e6e',
    thinking: '#8f9aa8',
    card: '#ffffff',
    shadow: 'rgba(58, 42, 20, 0.14)',
  },

  spacing,
  radii,

  text: {
    /** Sizes run large. A pre-reader relies on shape; a reader is 6 and needs 20pt. */
    hero: 40,
    title: fontSizes.playPrimary,
    body: 20,
    caption: fontSizes.body,
  },

  /**
   * Touch targets.
   *
   * 72pt for anything a child taps, versus the 44pt adult floor. A missed tap on
   * the talk button does not read as "I missed" to a four-year-old — it reads as
   * "it's broken", and they stop trying.
   */
  touch: {
    min: touchTargets.child,
    talkButton: 168,
  },

  motion: {
    /** Slow enough to be calm, fast enough not to feel stuck. */
    gentle: 420,
    /** The listening pulse. One breath per cycle. */
    pulse: 1_400,
    /** How long a celebration holds before it gets out of the way. */
    celebrate: 1_800,
  },
} as const;

export type CharacterColourKey = 'buddy' | 'lily' | 'captain' | 'professor';

/** Maps a character slug to its colour, with a safe default for an unknown one. */
export const characterColour = (slug: string): string => {
  const key = slug.split('-')[0] ?? '';
  const map: Record<string, string> = {
    buddy: childTheme.colors.buddy,
    lily: childTheme.colors.lily,
    captain: childTheme.colors.captain,
    professor: childTheme.colors.professor,
  };
  return map[key] ?? childTheme.colors.accent;
};

/** The emoji face a character wears. Recognisable to a child who cannot read its name. */
export const characterFace = (slug: string): string => {
  const map: Record<string, string> = {
    'buddy-the-dog': '🐶',
    'lily-the-fairy': '🧚',
    'captain-sky': '🚀',
    'professor-owl': '🦉',
  };
  return map[slug] ?? '⭐';
};
