import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Nothing to configure. The client talks to the service over its own origin
  // with CORS, which is the shape it would have in production anyway: the API
  // and the operator UI are separately deployed.
};

export default nextConfig;
