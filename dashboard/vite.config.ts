import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Copy _redirects for SPA routing fallback after build
    {
      name: 'copy-redirects',
      closeBundle() {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const redirectsPath = resolve(__dirname, 'dist', '_redirects');
        const redirectsContent = '/*    /index.html   200';
        try {
          if (!existsSync(resolve(__dirname, 'dist'))) {
            mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
          }
          writeFileSync(redirectsPath, redirectsContent);
        } catch (e) {
          // Ignore errors
        }
      },
    },
  ],
  appType: 'spa', // Enable SPA fallback for client-side routing
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || '0.2.1'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 2886,
    proxy: {
      '/api': {
        target: 'http://localhost:2785',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
