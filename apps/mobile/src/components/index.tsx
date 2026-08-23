import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { useReducedMotion } from '../hooks/reduced-motion.js';
import { characterColour, characterFace, childTheme } from '../theme/child-theme.js';

/**
 * The reusable child-mode components.
 *
 * Three rules run through all of them.
 *
 * **Big.** Nothing tappable is smaller than 72pt. A four-year-old's tap accuracy
 * is materially worse than an adult's, and a missed tap reads as "it's broken"
 * rather than as "I missed".
 *
 * **Legible without reading.** Every control carries a face, a colour, and a
 * shape as well as a label. A pre-reader must be able to use the app; text is a
 * second channel for the children who can use it.
 *
 * **Calm.** Animation shows that something is alive and that something is
 * happening. There is no motion that competes for attention, nothing that
 * flashes, and nothing on a timer — a child who wanders off mid-sentence should
 * come back to a screen that waited.
 */

/* -------------------------------------------------------------------------- */
/* Frame                                                                       */
/* -------------------------------------------------------------------------- */

export const Screen = ({
  children,
  scroll = false,
  testID,
}: {
  children: ReactNode;
  scroll?: boolean;
  testID?: string;
}) => {
  const content = <View style={styles.screenInner}>{children}</View>;
  return (
    <View style={styles.screen} testID={testID}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>{content}</ScrollView>
      ) : (
        content
      )}
    </View>
  );
};

export const Title = ({ children }: { children: ReactNode }) => (
  <Text style={styles.title} accessibilityRole="header">
    {children}
  </Text>
);

export const Body = ({ children }: { children: ReactNode }) => (
  <Text style={styles.body}>{children}</Text>
);

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The general-purpose child button.
 *
 * A face, a label, and a colour — three channels for the same meaning, so a
 * child who cannot read the label can still tell the buttons apart.
 */
export const BigButton = ({
  label,
  face,
  colour = childTheme.colors.accent,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  face?: string;
  colour?: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) => (
  <Pressable
    testID={testID}
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled }}
    style={({ pressed }) => [
      styles.bigButton,
      { backgroundColor: colour },
      // A press must be visible without being loud. A child needs to know the
      // tap landed; they do not need it to jump.
      pressed && styles.pressed,
      disabled && styles.disabled,
    ]}
  >
    {face !== undefined && <Text style={styles.buttonFace}>{face}</Text>}
    <Text style={styles.buttonLabel}>{label}</Text>
  </Pressable>
);

/**
 * The talk button. The single most important control in the app.
 *
 * Round, enormous, and always in the same place on every screen that has one, so
 * a child learns where it is before they learn what the words say. It pulses
 * while listening — one slow breath per cycle, which reads as attention rather
 * than as urgency.
 */
export const TalkButton = ({
  label,
  listening,
  thinking,
  onPress,
  disabled = false,
  colour = childTheme.colors.accent,
  testID = 'talk-button',
}: {
  label: string;
  listening: boolean;
  thinking: boolean;
  onPress: () => void;
  disabled?: boolean;
  colour?: string;
  testID?: string;
}) => {
  const pulse = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    // Colour, emoji and label all still change, so stillness costs no meaning.
    if (!listening || reducedMotion) {
      pulse.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.08,
          duration: childTheme.motion.pulse / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: childTheme.motion.pulse / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [listening, pulse, reducedMotion]);

  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Tap to talk to your friend"
        style={({ pressed }) => [
          styles.talkButton,
          { backgroundColor: listening ? childTheme.colors.listening : colour },
          thinking && { backgroundColor: childTheme.colors.thinking },
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.talkFace}>{thinking ? '💭' : listening ? '👂' : '🎤'}</Text>
        <Text style={styles.talkLabel}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
};

/* -------------------------------------------------------------------------- */
/* Character                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The character.
 *
 * The child's anchor on every screen. It breathes constantly — a slow, small
 * scale — so the app feels alive while waiting, and bobs while speaking so a
 * child can see who is talking without reading anything.
 */
export const CharacterAvatar = ({
  slug,
  speaking = false,
  size = 140,
  testID,
}: {
  slug: string;
  speaking?: boolean;
  size?: number;
  testID?: string;
}) => {
  const bob = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    /* Held still rather than looped. That the friend is talking is already in
     * the accessibility label and in the audio that is playing — the bob only
     * ever reinforced it. */
    if (reducedMotion) {
      bob.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: speaking ? 380 : childTheme.motion.pulse,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: speaking ? 380 : childTheme.motion.pulse,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [bob, speaking, reducedMotion]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, speaking ? -10 : -4] });

  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityLabel={speaking ? 'Your friend is talking' : 'Your friend'}
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: characterColour(slug),
          transform: [{ translateY }],
        },
      ]}
    >
      <Text style={{ fontSize: size * 0.5 }}>{characterFace(slug)}</Text>
    </Animated.View>
  );
};

/** A speech bubble. The caption channel, for children who read. */
export const SpeechBubble = ({ text, testID }: { text: string; testID?: string }) => (
  <View style={styles.bubble} testID={testID}>
    <Text style={styles.bubbleText}>{text}</Text>
  </View>
);

/* -------------------------------------------------------------------------- */
/* States                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Loading.
 *
 * Never a percentage and never a spinner alone. A child cannot read a progress
 * bar, and a bare spinner is what a broken app looks like — so the character
 * stays on screen and is simply thinking.
 */
export const Thinking = ({ slug, testID }: { slug: string; testID?: string }) => (
  <View style={styles.centred} testID={testID}>
    <CharacterAvatar slug={slug} size={120} />
    <ActivityIndicator size="large" color={childTheme.colors.accent} style={styles.spinner} />
    <Text style={styles.thinkingText}>Thinking…</Text>
  </View>
);

/**
 * A failure.
 *
 * One warm sentence in the character's voice, and a try-again button when trying
 * again could plausibly help. No code, no status, no request id, no "error".
 */
export const FriendlyError = ({
  message,
  onRetry,
  slug = 'buddy-the-dog',
  testID = 'friendly-error',
}: {
  message: string;
  onRetry?: () => void;
  slug?: string;
  testID?: string;
}) => (
  <View style={styles.centred} testID={testID}>
    <CharacterAvatar slug={slug} size={110} />
    <SpeechBubble text={message} />
    {onRetry !== undefined && (
      <BigButton label="Try again" face="🔄" onPress={onRetry} testID="retry-button" />
    )}
  </View>
);

/**
 * The offline banner.
 *
 * Persistent rather than a toast: a child who missed a toast has no way to find
 * out why nothing is working. Phrased as a fact about the world, not a fault.
 */
export const OfflineBanner = ({ visible }: { visible: boolean }) =>
  visible ? (
    <View style={styles.offline} testID="offline-banner" accessibilityRole="alert">
      <Text style={styles.offlineText}>📡 No internet right now — some things are resting.</Text>
    </View>
  ) : null;

/* -------------------------------------------------------------------------- */
/* Cards, badges, progress                                                     */
/* -------------------------------------------------------------------------- */

export const Card = ({
  children,
  onPress,
  colour = childTheme.colors.card,
  testID,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  colour?: string;
  testID?: string;
  style?: ViewStyle;
}) => {
  const content = <View style={[styles.card, { backgroundColor: colour }, style]}>{children}</View>;
  return onPress === undefined ? (
    <View testID={testID}>{content}</View>
  ) : (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
};

/** An earned badge. Earned ones are full colour; unearned are dimmed, never hidden. */
export const Badge = ({
  face,
  title,
  earned,
  testID,
}: {
  face: string;
  title: string;
  earned: boolean;
  testID?: string;
}) => (
  <View
    style={[styles.badge, !earned && styles.badgeLocked]}
    testID={testID}
    accessible
    accessibilityLabel={earned ? `${title}, earned` : `${title}, not yet`}
  >
    <Text style={styles.badgeFace}>{earned ? face : '⬜'}</Text>
    <Text style={styles.badgeTitle}>{title}</Text>
  </View>
);

/**
 * A progress bar, for children.
 *
 * Shows how far along something is and NEVER a number out of a total. "3 of 20"
 * invites a child to notice they are behind; a bar that is filling up does not.
 */
export const ProgressBar = ({
  fraction,
  colour = childTheme.colors.accent,
  testID,
}: {
  fraction: number;
  colour?: string;
  testID?: string;
}) => {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return (
    <View style={styles.progressTrack} testID={testID} accessibilityRole="progressbar">
      <View
        style={[
          styles.progressFill,
          { width: `${String(clamped * 100)}%` as `${number}%`, backgroundColor: colour },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: childTheme.colors.background },
  screenInner: { flex: 1, padding: childTheme.spacing.lg, gap: childTheme.spacing.md },
  scrollContent: { flexGrow: 1 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: childTheme.spacing.md },

  title: {
    fontSize: childTheme.text.title,
    fontWeight: '800',
    color: childTheme.colors.text,
    textAlign: 'center',
  },
  body: {
    fontSize: childTheme.text.body,
    color: childTheme.colors.text,
    textAlign: 'center',
    lineHeight: childTheme.text.body * 1.4,
  },

  bigButton: {
    minHeight: childTheme.touch.min,
    paddingVertical: childTheme.spacing.md,
    paddingHorizontal: childTheme.spacing.lg,
    borderRadius: childTheme.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: childTheme.spacing.sm,
  },
  buttonFace: { fontSize: 30 },
  buttonLabel: { fontSize: childTheme.text.body, fontWeight: '700', color: '#ffffff' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },

  talkButton: {
    width: childTheme.touch.talkButton,
    height: childTheme.touch.talkButton,
    borderRadius: childTheme.touch.talkButton / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: childTheme.spacing.xs,
  },
  talkFace: { fontSize: 52 },
  talkLabel: { fontSize: childTheme.text.caption, fontWeight: '700', color: '#ffffff' },

  avatar: { alignItems: 'center', justifyContent: 'center' },

  bubble: {
    backgroundColor: childTheme.colors.card,
    borderRadius: childTheme.radii.md * 2,
    padding: childTheme.spacing.md,
    maxWidth: '90%',
  },
  bubbleText: {
    fontSize: childTheme.text.body,
    color: childTheme.colors.text,
    lineHeight: childTheme.text.body * 1.4,
    textAlign: 'center',
  },

  spinner: { marginTop: childTheme.spacing.md },
  thinkingText: { fontSize: childTheme.text.caption, color: childTheme.colors.textMuted },

  offline: {
    backgroundColor: childTheme.colors.warning,
    paddingVertical: childTheme.spacing.sm,
    paddingHorizontal: childTheme.spacing.md,
  },
  offlineText: { color: '#ffffff', fontSize: childTheme.text.caption, textAlign: 'center' },

  card: {
    borderRadius: childTheme.radii.md * 2,
    padding: childTheme.spacing.md,
    minHeight: childTheme.touch.min,
    justifyContent: 'center',
    gap: childTheme.spacing.xs,
  },

  badge: { alignItems: 'center', width: 96, gap: childTheme.spacing.xs },
  badgeLocked: { opacity: 0.35 },
  badgeFace: { fontSize: 44 },
  badgeTitle: {
    fontSize: childTheme.text.caption,
    textAlign: 'center',
    color: childTheme.colors.text,
  },

  progressTrack: {
    height: 20,
    borderRadius: childTheme.radii.pill,
    backgroundColor: '#00000014',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: childTheme.radii.pill },
});
