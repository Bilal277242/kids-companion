import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { createApiClient } from './src/api/client.js';
import { OfflineBanner } from './src/components/index.js';
import type { AudioPort } from './src/hooks/audio-port.js';
import { createExpoAudioPort } from './src/hooks/expo-audio-port.js';
import { canReach, navigate, type NavState, type Route } from './src/navigation/routes.js';
import {
  AchievementsScreen,
  CharacterSelectScreen,
  ChildSelectScreen,
  ConversationScreen,
  HomeScreen,
  ParentHandoffScreen,
  PracticeScreen,
  ProgressScreen,
  SettingsScreen,
  StoryScreen,
  VocabularyScreen,
  VoiceScreen,
  WelcomeScreen,
  type ScreenProps,
} from './src/screens/index.js';
import { createSessionStore } from './src/state/session.js';
import { childTheme } from './src/theme/child-theme.js';

/**
 * Child mode.
 *
 * WHAT IS NOT IN THIS BINARY: no API key, no database credential, no admin
 * capability, no payment flow. The app talks to our API and holds exactly one
 * secret — the parent's own session token, obtained in the parent app and kept
 * in the platform keystore.
 *
 * The API base URL comes from the Expo config at build time. It is not a secret
 * (it is in every network trace anyway) and it is the only piece of environment
 * this app reads.
 */

const API_BASE_URL: string =
  typeof process.env.EXPO_PUBLIC_API_BASE_URL === 'string'
    ? process.env.EXPO_PUBLIC_API_BASE_URL
    : 'http://localhost:3000';

/** The platform keystore. Keychain on iOS, Keystore on Android — never AsyncStorage. */
const keystore = {
  get: async (key: string) => (await SecureStore.getItemAsync(key)) ?? undefined,
  set: async (key: string, value: string) => {
    await SecureStore.setItemAsync(key, value);
  },
  remove: async (key: string) => {
    await SecureStore.deleteItemAsync(key);
  },
};

export default function App() {
  const [nav, setNav] = useState<NavState>({ route: 'welcome' });
  // Optimistic: a device that has not reported yet is assumed online, because
  // showing "no internet" to a child whose connection is fine is worse than a
  // request that fails and retries.
  const [online, setOnline] = useState(true);

  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        setOnline(state.isConnected !== false);
      }),
    [],
  );

  const session = useMemo(() => createSessionStore(keystore), []);
  const audio = useMemo((): AudioPort => createExpoAudioPort(), []);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE_URL,
        getToken: session.token,
        isOnline: () => online,
        // A failure's request id goes to the support log a PARENT can send, and
        // never to the screen. See src/api/errors.ts.
        onFailure: () => undefined,
      }),
    [session, online],
  );

  const go = (route: Route, patch: Record<string, unknown> = {}) => {
    setNav((current) => navigate(current, route, patch));
  };

  const props: ScreenProps = {
    api,
    audio,
    go,
    online,
    ...(nav.childId === undefined ? {} : { childId: nav.childId }),
    ...(nav.childName === undefined ? {} : { childName: nav.childName }),
    ...(nav.characterSlug === undefined ? {} : { characterSlug: nav.characterSlug }),
    ...(nav.conversationId === undefined ? {} : { conversationId: nav.conversationId }),
  };

  // A route the state cannot support falls back rather than rendering a screen
  // that would have to defend itself against a missing id.
  const route = canReach(nav, nav.route) ? nav.route : 'welcome';

  return (
    <View style={{ flex: 1, backgroundColor: childTheme.colors.background }}>
      <StatusBar style="dark" />
      <OfflineBanner visible={!online} />
      {renderRoute(route, props)}
    </View>
  );
}

const renderRoute = (route: Route, props: ScreenProps) => {
  switch (route) {
    case 'welcome':
      return <WelcomeScreen {...props} />;
    case 'parent_handoff':
      return <ParentHandoffScreen {...props} />;
    case 'child_select':
      return <ChildSelectScreen {...props} />;
    case 'character_select':
      return <CharacterSelectScreen {...props} />;
    case 'home':
      return <HomeScreen {...props} />;
    case 'conversation':
      return <ConversationScreen {...props} />;
    case 'voice':
      return <VoiceScreen {...props} />;
    case 'story':
      return <StoryScreen {...props} />;
    case 'practice':
      return <PracticeScreen {...props} />;
    case 'vocabulary':
      return <VocabularyScreen {...props} />;
    case 'achievements':
      return <AchievementsScreen {...props} />;
    case 'progress':
      return <ProgressScreen {...props} />;
    case 'settings':
      return <SettingsScreen {...props} />;
  }
};
