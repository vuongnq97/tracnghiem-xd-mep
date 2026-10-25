import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import datasetHandler from './api/dataset.js';

function vercelApiDevPlugin() {
  return {
    name: 'vercel-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/dataset', (req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          try {
            req.body = body ? JSON.parse(body) : {};
          } catch {
            req.body = {};
          }
          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (obj) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(obj));
          };
          await datasetHandler(req, res);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), vercelApiDevPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          xlsx: ['xlsx'],
          vendor: ['react', 'react-dom', 'lucide-react'],
        },
      },
    },
  },
});
