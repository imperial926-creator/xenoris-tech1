/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Business-critical data must never be silently stale; individual routes opt into
  // caching deliberately rather than relying on aggressive defaults.
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
};

module.exports = nextConfig;
