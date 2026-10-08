import process from 'node:process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const DEFAULT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function preloadMapStyle(styleUrl) {
  return {
    name: 'preload-map-style',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'preconnect', href: new URL(styleUrl).origin, crossorigin: '' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'preload', href: styleUrl, as: 'fetch', crossorigin: '' }, injectTo: 'head' },
    ],
  };
}

export default defineConfig(({ mode }) => ({
  worker: { format: 'es' },
  preview: { proxy: { '/api': 'http://127.0.0.1:8000', '/admin': 'http://127.0.0.1:8000' } },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  plugins: [
    react(),
    tailwindcss(),
    preloadMapStyle(loadEnv(mode, process.cwd()).VITE_MAP_STYLE_URL || DEFAULT_MAP_STYLE),
  ],
}));
