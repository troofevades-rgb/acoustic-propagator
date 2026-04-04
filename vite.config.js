import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import path from 'path';
import fs from 'fs';

// Copy Cesium static assets to dist on build
function cesiumAssetsCopy() {
  return {
    name: 'cesium-assets-copy',
    writeBundle() {
      const cesiumSource = path.resolve(__dirname, 'node_modules/cesium/Build/Cesium');
      const cesiumDest = path.resolve(__dirname, 'dist/cesium');

      const items = ['Workers', 'ThirdParty', 'Assets', 'Widgets', 'Cesium.js'];
      items.forEach((item) => {
        const src = path.join(cesiumSource, item);
        const dest = path.join(cesiumDest, item);
        if (!fs.existsSync(src)) return;
        if (fs.statSync(src).isDirectory()) {
          fs.cpSync(src, dest, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      });
    },
  };
}

export default defineConfig({
  root: 'src',
  envDir: path.resolve(__dirname),
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/index.html'),
    },
    chunkSizeWarningLimit: 5000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    electron([
      {
        entry: path.resolve(__dirname, 'electron/main.js'),
        onstart(args) {
          args.startup();
        },
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['electron', 'electron-store'],
            },
          },
        },
      },
      {
        entry: path.resolve(__dirname, 'electron/preload.js'),
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    electronRenderer(),
    cesiumAssetsCopy(),
  ],
  server: {
    port: 5173,
    fs: {
      allow: ['..'],
    },
  },
});
