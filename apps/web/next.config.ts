import type { NextConfig } from 'next';

/**
 * This surface handles billing and personal data, so the security headers are
 * part of the app config rather than left to a reverse proxy that may or may not
 * be in front of it in every environment.
 *
 * See SECURITY.md §7.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Fail the build on a type error rather than shipping it. Next's defaults
  // already do this; stated explicitly so nobody "temporarily" flips it.
  // (Linting is not configured here — it runs once, at the workspace root.)
  typescript: { ignoreBuildErrors: false },
  transpilePackages: ['@kids/ui', '@kids/types', '@kids/validation'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
