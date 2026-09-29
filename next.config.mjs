/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  images: { unoptimized: true },
  async redirects() {
    // El enlace viejo del panel (/es/sorteo) y cualquier variante con idioma.
    return [{ source: "/:locale(es|en)/sorteo", destination: "/", permanent: false }];
  },
};

export default nextConfig;
