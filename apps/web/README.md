# apps/web

**Not yet implemented. Phase 5.**

The parent-facing web surface. **No child experience lives here** — child mode is mobile-only ([Q-16](../../docs/OPEN_QUESTIONS.md)).

## Responsibilities

- Parent dashboard: conversation history, safety flags, learning progress
- Parental controls: time limits, topic and character settings, language
- Account and subscription management
- Web checkout — likely load-bearing depending on how [Q-02](../../docs/OPEN_QUESTIONS.md) resolves, since app-store billing rules constrain in-app purchase of subscriptions
- Data export and account deletion
- Marketing and legal pages

## Notes

- Refresh tokens in `HttpOnly; Secure; SameSite=Strict` cookies.
- A restrictive CSP. This surface handles billing and personal data.
- Accessible to a conventional standard — this is an adult interface, unlike child mode.
- Urdu and RTL support from the start, not retrofitted.
