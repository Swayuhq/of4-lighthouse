import type { NextConfig } from 'next';

const config: NextConfig = {
  // Cedar loads its wasm file from beside its own code, so bundling it breaks the path. Node loads it as is.
  serverExternalPackages: ['@cedar-policy/cedar-wasm'],
};

export default config;
