/** @type {import('next').NextConfig} */
const nextConfig = {
  // Railway: standalone keeps the deployed image small and self-contained.
  output: 'standalone',

  // prompts/master_icp.md is read from disk at runtime. Tell Next to carry it
  // into the standalone bundle so the container has it after build.
  outputFileTracingIncludes: {
    '/api/**/*': ['./prompts/**'],
  },

  reactStrictMode: true,

  eslint: {
    // Deploys must not die on lint. Run `npm run lint` locally instead.
    ignoreDuringBuilds: true,
  },

  experimental: {
    // Generation streams for minutes; keep server actions/body limits sane.
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
};

export default nextConfig;
