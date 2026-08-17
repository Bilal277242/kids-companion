import { colors, spacing } from '@kids/ui';

/**
 * Foundation placeholder. The parent dashboard lands in Phase 5.
 *
 * It exists now to prove the build pipeline end to end: Next.js compiles, the
 * shared `@kids/ui` package resolves across the workspace boundary, and design
 * tokens are consumed from one source rather than redefined per app.
 */
export default function HomePage() {
  return (
    <main
      style={{
        padding: spacing.xl,
        fontFamily: 'system-ui, sans-serif',
        color: colors.text,
        background: colors.surface,
        minHeight: '100vh',
      }}
    >
      <h1 style={{ marginBottom: spacing.sm }}>kids-companion</h1>
      <p style={{ color: colors.textMuted, marginBottom: spacing.lg }}>
        Parent dashboard — foundation only. No features are implemented yet.
      </p>
      <p style={{ color: colors.textMuted, fontSize: 14 }}>
        See <code>DEVELOPMENT_PLAN.md</code> for what ships in Phase 5.
      </p>
    </main>
  );
}
