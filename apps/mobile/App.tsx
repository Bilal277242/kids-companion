import { colors, fontSizes, spacing } from '@kids/ui';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Foundation placeholder. Child mode lands in Phase 4, parent mode in Phase 5.
 *
 * It exists now to prove the pipeline: Expo resolves, TypeScript typechecks under
 * the same strict settings as the rest of the workspace, and design tokens come
 * from the shared `@kids/ui` package rather than being redefined per platform.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.title}>Kids Companion</Text>
      <Text style={styles.body}>Foundation only — no features are implemented yet.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.playBackground,
    padding: spacing.lg,
  },
  title: {
    fontSize: fontSizes.display,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: fontSizes.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
