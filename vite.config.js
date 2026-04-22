import { defineConfig } from 'vite';

export default defineConfig({
  /** So phone / tablet on Wi‑Fi can open `http://<your-PC-LAN-IP>:5173` (see terminal). */
  server: {
    host: true,
    port: 5173,
    strictPort: false
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('three/examples')) return 'three-examples';
          if (id.includes('three')) return 'three-vendor';
          if (id.includes('cannon-es')) return 'cannon-vendor';
        }
      }
    },
    chunkSizeWarningLimit: 550
  }
});
