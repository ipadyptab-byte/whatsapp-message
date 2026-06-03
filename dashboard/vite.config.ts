import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

// Copy _redirects for SPA routing fallback after build
function copyRedirects() {
  return {
    name: 'copy-redirects',
    closeBundle() {
      const redirectsPath = resolve(__dirname, 'dist', '_redirects');
      const redirectsContent = '/*    /index.html   200';
      try {
        if (!existsSync(resolve(__dirname, 'dist'))) {
          mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
        }
        require('fs').writeFileSync(redirectsPath, redirectsContent);
      } catch (e) {
        // Ignore errors
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copyRedirects()],
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
