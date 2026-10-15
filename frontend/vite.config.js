import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Data Collection Hub › Google Ads shows apps-script/GoogleAdsReport.js
    // for copy-paste, imported with ?raw from outside this folder.
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
});
