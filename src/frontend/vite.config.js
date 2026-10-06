import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  worker: { format: 'es' },
  preview: { proxy: { '/api': 'http://127.0.0.1:8000', '/admin': 'http://127.0.0.1:8000' } },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  plugins: [
    react(),
    tailwindcss(),
  ],
});
