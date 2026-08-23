import { useEffect, useReducer, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type {
  ApiClient,
  CharacterSummary,
  ChildSummary,
  PracticeExercise,
  Turn,
} from '../api/client.js';
import { failureFor, type FriendlyFailure } from '../api/errors.js';
import {
  Badge,
  Body,
  BigButton,
  Card,
  CharacterAvatar,
  FriendlyError,
  ProgressBar,
  Screen,
  SpeechBubble,
  TalkButton,
  Thinking,
  Title,
} from '../components/index.js';
import type { AudioPort } from '../hooks/audio-port.js';
import {
  buttonLabelFor,
  initialTalkContext,
  isPressable,
  talkReducer,
} from '../hooks/recorder-machine.js';
import type { Route } from '../navigation/routes.js';
import { characterColour, characterFace, childTheme } from '../theme/child-theme.js';

/**
 * The child screens.
 *
 * Every one of them obeys the same three rules, which is why they look
 * repetitive and why that repetition is the point: a child learns one screen and
 * knows them all.
 *
 *   * The character is always present, and always in the same place.
 *   * The primary action is one enormous button, always at the bottom.
 *   * Nothing important is carried by text alone.
 *
 * The conversation loop — character → child speaks → AI responds → character
 * speaks — is implemented once, in `ConversationScreen`, and the voice and story
 * screens are that same loop with a different frame around it.
 */

export interface ScreenProps {
  readonly api: ApiClient;
  readonly audio: AudioPort;
  readonly go: (route: Route, patch?: Record<string, unknown>) => void;
  readonly childId?: string;
  readonly childName?: string;
  readonly characterSlug?: string;
  readonly conversationId?: string;
  readonly online: boolean;
}

/* ========================================================================== */
/* 1. Welcome                                                                 */
/* ========================================================================== */

export const WelcomeScreen = ({ go }: ScreenProps) => (
  <Screen testID="screen-welcome">
    <View style={styles.hero}>
      <CharacterAvatar slug="buddy-the-dog" size={180} />
      <Text style={styles.heroText}>Hello!</Text>
      <Body>Tap the big button to start.</Body>
    </View>
    <BigButton
      label="Let's play!"
      face="👋"
      onPress={() => {
        go('child_select');
      }}
      testID="start-button"
    />
    <BigButton
      label="For grown-ups"
      face="🔒"
      colour={childTheme.colors.textMuted}
      onPress={() => {
        go('parent_handoff');
      }}
      testID="grownup-button"
    />
  </Screen>
);

/* ========================================================================== */
/* 2. Parent authentication handoff                                           */
/* ========================================================================== */

/**
 * The handoff.
 *
 * A DELIBERATE DEAD END FOR A CHILD. There is no password field here and no way
 * to sign in from child mode: signing in happens in the parent app, and this
 * screen exists to say so and to stop.
 *
 * A child who wanders in must not be able to do anything, and must not be made
 * to feel they did something wrong.
 */
export const ParentHandoffScreen = ({ go }: ScreenProps) => (
  <Screen testID="screen-parent-handoff">
    <View style={styles.hero}>
      <Text style={styles.lock}>🔒</Text>
      <Title>This bit is for grown-ups</Title>
      <Body>
        A grown-up can sign in and change settings in the parent app. Nothing here is set up from
        this screen.
      </Body>
    </View>
    <BigButton
      label="Back to playing"
      face="🎈"
      onPress={() => {
        go('welcome');
      }}
      testID="back-button"
    />
  </Screen>
);

/* ========================================================================== */
/* 3. Child selection                                                         */
/* ========================================================================== */

export const ChildSelectScreen = ({ api, go, online }: ScreenProps) => {
  const [children, setChildren] = useState<ChildSummary[] | undefined>();
  const [failure, setFailure] = useState<FriendlyFailure | undefined>();

  const load = () => {
    setFailure(undefined);
    setChildren(undefined);
    void api.get<{ items: ChildSummary[] }>('/v1/children').then((result) => {
      if (result.ok && result.data) setChildren(result.data.items);
      else setFailure(result.failure ?? failureFor('unknown'));
    });
  };

  useEffect(load, [api, online]);

  if (failure)
    return (
      <Screen testID="screen-child-select">
        <FriendlyError
          message={failure.message}
          {...(failure.retryable ? { onRetry: load } : {})}
        />
      </Screen>
    );
  if (!children)
    return (
      <Screen testID="screen-child-select">
        <Thinking slug="buddy-the-dog" />
      </Screen>
    );

  return (
    <Screen scroll testID="screen-child-select">
      <Title>Who's playing?</Title>
      <View style={styles.grid}>
        {children.map((child) => (
          <Card
            key={child.id}
            testID={`child-${child.id}`}
            onPress={() => {
              go('character_select', { childId: child.id, childName: child.displayName });
            }}
          >
            <Text style={styles.cardFace}>{child.avatarKey ?? '🙂'}</Text>
            <Text style={styles.cardLabel}>{child.displayName}</Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
};

/* ========================================================================== */
/* 4. Character selection                                                     */
/* ========================================================================== */

export const CharacterSelectScreen = ({ api, go, childId }: ScreenProps) => {
  const [characters, setCharacters] = useState<CharacterSummary[] | undefined>();
  const [failure, setFailure] = useState<FriendlyFailure | undefined>();

  const load = () => {
    setFailure(undefined);
    void api.get<{ items: CharacterSummary[] }>('/v1/characters').then((result) => {
      if (result.ok && result.data) setCharacters(result.data.items);
      else setFailure(result.failure ?? failureFor('unknown'));
    });
  };

  useEffect(load, [api, childId]);

  if (failure)
    return (
      <Screen>
        <FriendlyError
          message={failure.message}
          {...(failure.retryable ? { onRetry: load } : {})}
        />
      </Screen>
    );
  if (!characters)
    return (
      <Screen>
        <Thinking slug="buddy-the-dog" />
      </Screen>
    );

  return (
    <Screen scroll testID="screen-character-select">
      <Title>Who shall we play with?</Title>
      <View style={styles.grid}>
        {characters.map((character) => (
          <Card
            key={character.id}
            testID={`character-${character.slug}`}
            colour={characterColour(character.slug)}
            onPress={() => {
              go('home', { characterSlug: character.slug });
            }}
          >
            <Text style={styles.cardFace}>{characterFace(character.slug)}</Text>
            <Text style={[styles.cardLabel, styles.onColour]}>{character.displayName}</Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
};

/* ========================================================================== */
/* 5. Child home                                                              */
/* ========================================================================== */

/**
 * Home.
 *
 * Six destinations, each a face and a colour. A pre-reader navigates this screen
 * entirely by shape, which is why the icons are fixed and never reorder — a
 * child learns "the star one is my badges" long before they can read "Badges".
 */
export const HomeScreen = ({ go, childName, characterSlug = 'buddy-the-dog' }: ScreenProps) => (
  <Screen scroll testID="screen-home">
    <View style={styles.homeHeader}>
      <CharacterAvatar slug={characterSlug} size={120} />
      <Title>{childName === undefined ? 'Hello!' : `Hello, ${childName}!`}</Title>
    </View>

    <View style={styles.grid}>
      {(
        [
          ['conversation', '💬', 'Chat', childTheme.colors.buddy],
          ['voice', '🎤', 'Talk', childTheme.colors.listening],
          ['story', '📖', 'Story', childTheme.colors.lily],
          ['practice', '🗣️', 'Say it', childTheme.colors.captain],
          ['vocabulary', '🔤', 'Words', childTheme.colors.professor],
          ['achievements', '⭐', 'Stars', childTheme.colors.accent],
        ] as const
      ).map(([route, face, label, colour]) => (
        <Card
          key={route}
          testID={`home-${route}`}
          colour={colour}
          onPress={() => {
            go(route);
          }}
        >
          <Text style={styles.cardFace}>{face}</Text>
          <Text style={[styles.cardLabel, styles.onColour]}>{label}</Text>
        </Card>
      ))}
    </View>

    <BigButton
      label="My progress"
      face="🌱"
      colour={childTheme.colors.textMuted}
      onPress={() => {
        go('progress');
      }}
      testID="home-progress"
    />
  </Screen>
);

/* ========================================================================== */
/* 6 & 7. Conversation and voice                                              */
/* ========================================================================== */

/**
 * The loop.
 *
 *   character → child speaks → AI responds → character speaks
 *
 * One implementation, used by both the chat and voice screens and by story mode.
 * The state machine is in `recorder-machine.ts` and is unit-tested; this
 * component is the thin part that draws it and moves bytes.
 */
export const ConversationScreen = ({
  api,
  audio,
  go,
  childId,
  characterSlug = 'buddy-the-dog',
  online,
  mode = 'voice',
}: ScreenProps & { mode?: 'voice' | 'story' }) => {
  const [talk, dispatch] = useReducer(talkReducer, initialTalkContext);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [starting, setStarting] = useState(true);

  // Start a session once, when the screen opens.
  useEffect(() => {
    let cancelled = false;
    void api.post<{ id: string }>('/api/conversations/start', { childId }).then((result) => {
      if (cancelled) return;
      setStarting(false);
      if (result.ok && result.data) setConversationId(result.data.id);
      else dispatch({ type: 'FAILED', failure: result.failure ?? failureFor('unknown') });
    });
    return () => {
      cancelled = true;
    };
  }, [api, childId]);

  const press = () => {
    if (talk.state === 'recording') {
      dispatch({ type: 'PRESS' });
      void finishTurn();
      return;
    }
    if (talk.state === 'speaking') void audio.stopPlayback();

    dispatch({ type: 'PRESS' });
    void begin();
  };

  const begin = async () => {
    const outcome = await audio.requestPermission();
    if (outcome !== 'granted') {
      dispatch({ type: 'PERMISSION_DENIED' });
      return;
    }
    try {
      await audio.startRecording();
      dispatch({ type: 'PERMISSION_GRANTED' });
    } catch {
      dispatch({ type: 'FAILED', failure: failureFor('microphone_blocked') });
    }
  };

  const finishTurn = async () => {
    const recorded = await audio.stopRecording();
    if (!recorded || conversationId === undefined) {
      dispatch({ type: 'FAILED', failure: failureFor('nothing_heard') });
      return;
    }

    try {
      const form = new FormData();
      form.append('conversationId', conversationId);
      // React Native's FormData takes this shape for a file; the cast is the
      // documented way to satisfy the DOM lib's stricter type.
      form.append('audio', {
        uri: recorded.uri,
        name: 'turn.m4a',
        type: recorded.mimeType,
      } as unknown as Blob);

      const result = await api.upload<Turn>('/api/voice/turns', form);

      if (!result.ok || !result.data) {
        dispatch({ type: 'FAILED', failure: result.failure ?? failureFor('unknown') });
        return;
      }

      const turn = result.data;
      if (turn.status === 'unintelligible' || turn.status === 'rejected') {
        dispatch({ type: 'FAILED', failure: failureFor('nothing_heard') });
        return;
      }

      dispatch({ type: 'REPLY', reply: turn.reply, hasAudio: turn.audio != null });

      if (turn.audio != null) {
        // Absolute, and carrying the session token: the player fetches this
        // itself, so it gets neither the base url nor the authorization header
        // that `api.post` would have added. See `mediaSource`.
        await audio.play(await api.mediaSource(`/api/voice/audio/${turn.audio.key}`));
        dispatch({ type: 'PLAYBACK_FINISHED' });
      }
    } finally {
      // ALWAYS, on every path including the failures above. A child's voice
      // sitting in a cache directory is the data the server refuses to keep, and
      // a phone is a device that gets lost.
      await audio.discard(recorded.uri);
    }
  };

  if (starting)
    return (
      <Screen>
        <Thinking slug={characterSlug} />
      </Screen>
    );

  if (talk.state === 'failed' && talk.failure) {
    return (
      <Screen testID="screen-conversation">
        <FriendlyError
          message={talk.failure.message}
          slug={characterSlug}
          {...(talk.failure.retryable
            ? {
                onRetry: () => {
                  dispatch({ type: 'RESET' });
                },
              }
            : {})}
        />
        <BigButton
          label="Go home"
          face="🏠"
          colour={childTheme.colors.textMuted}
          onPress={() => {
            go('home');
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen testID={mode === 'story' ? 'screen-story' : 'screen-conversation'}>
      <View style={styles.hero}>
        <CharacterAvatar slug={characterSlug} speaking={talk.state === 'speaking'} size={160} />
        {talk.reply !== undefined && <SpeechBubble text={talk.reply} testID="reply-bubble" />}
        {talk.state === 'idle' && talk.reply === undefined && (
          <Body>{mode === 'story' ? 'Shall we make a story?' : 'What shall we talk about?'}</Body>
        )}
      </View>

      <View style={styles.talkRow}>
        <TalkButton
          label={buttonLabelFor(talk.state)}
          listening={talk.state === 'recording'}
          thinking={talk.state === 'thinking'}
          disabled={!isPressable(talk.state) || !online}
          colour={characterColour(characterSlug)}
          onPress={press}
        />
      </View>

      <BigButton
        label="Go home"
        face="🏠"
        colour={childTheme.colors.textMuted}
        onPress={() => {
          void audio.stopPlayback();
          go('home');
        }}
        testID="home-button"
      />
    </Screen>
  );
};

export const VoiceScreen = (props: ScreenProps) => <ConversationScreen {...props} mode="voice" />;
export const StoryScreen = (props: ScreenProps) => <ConversationScreen {...props} mode="story" />;

/* ========================================================================== */
/* 9. Speech practice                                                         */
/* ========================================================================== */

export const PracticeScreen = ({
  api,
  go,
  childId,
  characterSlug = 'buddy-the-dog',
}: ScreenProps) => {
  const [exercises, setExercises] = useState<PracticeExercise[] | undefined>();
  const [failure, setFailure] = useState<FriendlyFailure | undefined>();

  const load = () => {
    setFailure(undefined);
    void api
      .get<{ items: PracticeExercise[] }>(`/api/practice/exercises?childId=${childId ?? ''}`)
      .then((result) => {
        if (result.ok && result.data) setExercises(result.data.items);
        else setFailure(result.failure ?? failureFor('unknown'));
      });
  };

  useEffect(load, [api, childId]);

  if (failure)
    return (
      <Screen>
        <FriendlyError
          message={failure.message}
          slug={characterSlug}
          {...(failure.retryable ? { onRetry: load } : {})}
        />
      </Screen>
    );
  if (!exercises)
    return (
      <Screen>
        <Thinking slug={characterSlug} />
      </Screen>
    );

  return (
    <Screen scroll testID="screen-practice">
      <Title>Let's say some words!</Title>
      <View style={styles.grid}>
        {exercises.map((exercise) => (
          <Card
            key={exercise.exerciseKey}
            testID={`exercise-${exercise.exerciseKey}`}
            onPress={() => undefined}
          >
            <Text style={styles.cardFace}>{exercise.kind === 'syllable' ? '👏' : '🗣️'}</Text>
            <Text style={styles.cardLabel}>{exercise.title}</Text>
          </Card>
        ))}
      </View>
      <BigButton
        label="Go home"
        face="🏠"
        colour={childTheme.colors.textMuted}
        onPress={() => {
          go('home');
        }}
      />
    </Screen>
  );
};

/* ========================================================================== */
/* 10. Vocabulary                                                             */
/* ========================================================================== */

export const VocabularyScreen = ({
  api,
  go,
  childId,
  characterSlug = 'buddy-the-dog',
}: ScreenProps) => {
  const [words, setWords] = useState<{ word: string }[] | undefined>();
  const [failure, setFailure] = useState<FriendlyFailure | undefined>();

  const load = () => {
    setFailure(undefined);
    void api
      .get<{ vocabulary: { recent: { word: string }[] } }>(
        `/api/parent/progress/${childId ?? ''}?days=30`,
      )
      .then((result) => {
        if (result.ok && result.data) setWords(result.data.vocabulary.recent);
        else setFailure(result.failure ?? failureFor('unknown'));
      });
  };

  useEffect(load, [api, childId]);

  if (failure)
    return (
      <Screen>
        <FriendlyError
          message={failure.message}
          slug={characterSlug}
          {...(failure.retryable ? { onRetry: load } : {})}
        />
      </Screen>
    );
  if (!words)
    return (
      <Screen>
        <Thinking slug={characterSlug} />
      </Screen>
    );

  return (
    <Screen scroll testID="screen-vocabulary">
      <Title>Words I've used!</Title>
      {words.length === 0 && <Body>Chat with your friend and your words will appear here.</Body>}
      <View style={styles.grid}>
        {words.map((entry) => (
          <Card key={entry.word} testID={`word-${entry.word}`}>
            <Text style={styles.cardLabel}>{entry.word}</Text>
          </Card>
        ))}
      </View>
      <BigButton
        label="Go home"
        face="🏠"
        colour={childTheme.colors.textMuted}
        onPress={() => {
          go('home');
        }}
      />
    </Screen>
  );
};

/* ========================================================================== */
/* 11. Achievements                                                           */
/* ========================================================================== */

const BADGE_FACES: Readonly<Record<string, string>> = {
  first_try: '⭐',
  ten_attempts: '🏅',
  fifty_attempts: '🏆',
  first_session: '🚩',
  five_sessions: '🚀',
  three_days: '☀️',
  explorer: '🧭',
};

export const AchievementsScreen = ({
  api,
  go,
  childId,
  characterSlug = 'buddy-the-dog',
}: ScreenProps) => {
  const [earned, setEarned] = useState<{ key: string; title: string }[] | undefined>();
  const [failure, setFailure] = useState<FriendlyFailure | undefined>();

  const load = () => {
    setFailure(undefined);
    void api
      .get<{ achievements: { key: string; title: string }[] }>(
        `/api/practice/progress?childId=${childId ?? ''}`,
      )
      .then((result) => {
        if (result.ok && result.data) setEarned(result.data.achievements);
        else setFailure(result.failure ?? failureFor('unknown'));
      });
  };

  useEffect(load, [api, childId]);

  if (failure)
    return (
      <Screen>
        <FriendlyError
          message={failure.message}
          slug={characterSlug}
          {...(failure.retryable ? { onRetry: load } : {})}
        />
      </Screen>
    );
  if (!earned)
    return (
      <Screen>
        <Thinking slug={characterSlug} />
      </Screen>
    );

  const held = new Set(earned.map((a) => a.key));

  return (
    <Screen scroll testID="screen-achievements">
      <Title>My stars</Title>
      <View style={styles.grid}>
        {Object.entries(BADGE_FACES).map(([key, face]) => (
          <Badge
            key={key}
            testID={`badge-${key}`}
            face={face}
            title={earned.find((a) => a.key === key)?.title ?? key.replace(/_/g, ' ')}
            // Unearned badges are DIMMED, never hidden. A child seeing what is
            // still to come is encouraged; a child seeing an empty screen is not.
            earned={held.has(key)}
          />
        ))}
      </View>
      <BigButton
        label="Go home"
        face="🏠"
        colour={childTheme.colors.textMuted}
        onPress={() => {
          go('home');
        }}
      />
    </Screen>
  );
};

/* ========================================================================== */
/* 12. Progress, for a child                                                  */
/* ========================================================================== */

/**
 * Progress a child can read.
 *
 * NO NUMBERS AND NO COMPARISONS. Three growing things — words, chats, practice —
 * shown as bars that fill up. A child seeing "12 of 50" learns they are behind;
 * a child seeing a bar that is fuller than last time learns they are growing.
 *
 * The parent's version of this screen has the real figures, in the parent app,
 * where an adult can put them in context.
 */
export const ProgressScreen = ({
  api,
  go,
  childId,
  characterSlug = 'buddy-the-dog',
}: ScreenProps) => {
  const [data, setData] = useState<{ words: number; chats: number; tries: number } | undefined>();
  const [failure, setFailure] = useState<FriendlyFailure | undefined>();

  const load = () => {
    setFailure(undefined);
    void api
      .get<{
        vocabulary: { distinctWords: number };
        daily: { conversationCount: number; pronunciationAttempts: number }[];
      }>(`/api/parent/progress/${childId ?? ''}?days=30`)
      .then((result) => {
        if (result.ok && result.data) {
          setData({
            words: result.data.vocabulary.distinctWords,
            chats: result.data.daily.reduce((sum, d) => sum + d.conversationCount, 0),
            tries: result.data.daily.reduce((sum, d) => sum + d.pronunciationAttempts, 0),
          });
        } else setFailure(result.failure ?? failureFor('unknown'));
      });
  };

  useEffect(load, [api, childId]);

  if (failure)
    return (
      <Screen>
        <FriendlyError
          message={failure.message}
          slug={characterSlug}
          {...(failure.retryable ? { onRetry: load } : {})}
        />
      </Screen>
    );
  if (!data)
    return (
      <Screen>
        <Thinking slug={characterSlug} />
      </Screen>
    );

  return (
    <Screen scroll testID="screen-progress">
      <Title>Look how you're growing!</Title>
      <CharacterAvatar slug={characterSlug} size={120} />

      {(
        [
          ['🔤', 'Words', data.words / 50, childTheme.colors.professor],
          ['💬', 'Chats', data.chats / 20, childTheme.colors.buddy],
          ['🗣️', 'Practice', data.tries / 40, childTheme.colors.captain],
        ] as const
      ).map(([face, label, fraction, colour]) => (
        <View key={label} style={styles.progressRow} testID={`progress-${label.toLowerCase()}`}>
          <Text style={styles.cardFace}>{face}</Text>
          <View style={styles.progressBody}>
            <Text style={styles.cardLabel}>{label}</Text>
            <ProgressBar fraction={fraction} colour={colour} />
          </View>
        </View>
      ))}

      <BigButton
        label="Go home"
        face="🏠"
        colour={childTheme.colors.textMuted}
        onPress={() => {
          go('home');
        }}
      />
    </Screen>
  );
};

/* ========================================================================== */
/* 13. Settings                                                               */
/* ========================================================================== */

/**
 * Settings a child may touch.
 *
 * Exactly two: switch to a different character, and switch to a different child.
 * NOTHING ELSE IS HERE. Time limits, content filters, schedules, and every other
 * control live in the parent app behind a grown-up's sign-in, because a setting
 * a child can change is not a parental control.
 */
export const SettingsScreen = ({ go, characterSlug = 'buddy-the-dog' }: ScreenProps) => (
  <Screen testID="screen-settings">
    <Title>Change things</Title>
    <CharacterAvatar slug={characterSlug} size={110} />

    <BigButton
      label="Different friend"
      face="🔄"
      onPress={() => {
        go('character_select');
      }}
      testID="change-character"
    />
    <BigButton
      label="Different player"
      face="🙂"
      colour={childTheme.colors.captain}
      onPress={() => {
        go('child_select');
      }}
      testID="change-child"
    />
    <Body>Grown-ups can change everything else in the parent app.</Body>

    <BigButton
      label="Go home"
      face="🏠"
      colour={childTheme.colors.textMuted}
      onPress={() => {
        go('home');
      }}
    />
  </Screen>
);

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: childTheme.spacing.md },
  heroText: { fontSize: childTheme.text.hero, fontWeight: '800', color: childTheme.colors.text },
  lock: { fontSize: 72 },

  homeHeader: { alignItems: 'center', gap: childTheme.spacing.sm },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: childTheme.spacing.md,
    justifyContent: 'center',
  },
  cardFace: { fontSize: 48, textAlign: 'center' },
  cardLabel: {
    fontSize: childTheme.text.body,
    fontWeight: '700',
    textAlign: 'center',
    color: childTheme.colors.text,
  },
  onColour: { color: '#ffffff' },

  talkRow: { alignItems: 'center', paddingVertical: childTheme.spacing.lg },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: childTheme.spacing.md },
  progressBody: { flex: 1, gap: childTheme.spacing.xs },
});
