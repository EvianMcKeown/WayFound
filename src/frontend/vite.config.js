import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  plugins: [
    react(),
    tailwindcss(),
  ],
});
