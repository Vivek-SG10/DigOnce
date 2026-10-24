import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Dev-only middleware: routes POST /api/parse to the serverless handler
  const apiMiddlewarePlugin = {
    name: 'api-middleware',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/parse', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          Object.assign(process.env, env);

          let body = '';
          await new Promise((resolve, reject) => {
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', resolve);
            req.on('error', reject);
          });
          const parsed = JSON.parse(body || '{}');
          req.body = parsed;

          let statusCode = 200;
          const shimRes = {
            status(code) { statusCode = code; return this; },
            json(data) {
              res.writeHead(statusCode, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data));
            },
          };

          const mod = await server.ssrLoadModule('/api/parse.js');
          const handler = mod.default;
          await handler(req, shimRes);
        } catch (err) {
          console.error('[api-middleware] error:', err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ useFallback: true, error: String(err) }));
        }
      });
    },
  };

  return {
    plugins: [react(), tailwindcss(), apiMiddlewarePlugin],
    server: {
      port: 5173,
    },
    // Exclude leaflet from bundling — it's loaded from CDN as window.L
    // react-leaflet will resolve its `import L from 'leaflet'` to the pre-bundled shim
    optimizeDeps: {
      include: ['leaflet', 'react-leaflet'],
    },
    build: {
      rollupOptions: {
        // In production build, treat leaflet as external (uses window.L from CDN)
        external: [],
      },
    },
  };
});
