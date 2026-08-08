/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Never let a production build overwrite chunks used by a running dev server.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next"
};

export default nextConfig;
