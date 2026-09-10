import type { NextConfig } from 'next';

/**
 * Security headers (§30). CSP is intentionally explicit about the CDNs the
 * legacy design depends on — Google Fonts and the Bootstrap Icons webfont.
 * `robotBlocker@main` is deliberately NOT allowlisted: it was a branch-pinned
 * third-party script and is not carried over.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
  // Every image is now local. The legacy page pulled its logo from Google's
  // favicon scraper, which 302s to t2.gstatic.com — allowlisting the visible
  // host was not enough, and the mark simply failed to load behind a CSP.
  // Self-hosting LCA's own icon removes the dependency and the redirect.
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Browsers ignore HSTS over plain http, so this is inert in local
          // development and takes effect on the HTTPS deployment (§30).
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // Severs the window.opener relationship, so a page this one opens
          // cannot reach back into it.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      {
        // SSE must never be buffered or cached by the CDN (§23).
        source: '/api/stream',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-transform' },
          { key: 'X-Accel-Buffering', value: 'no' },
        ],
      },
    ];
  },
};

export default nextConfig;
