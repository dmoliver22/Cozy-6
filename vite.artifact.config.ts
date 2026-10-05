/**
 * Build for the claude.ai Artifact page: same game, but three.js and Rapier stay external
 * (loaded from jsDelivr through an import map) so the page only ships our own code.
 * `npm run build:artifact` runs this and then scripts/build-artifact.mjs, which inlines the
 * result into artifact/pot-luck.html.
 */
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

const isLib = (id: string) => id === 'three' || id.startsWith('three/') || id === '@dimforge/rapier3d-compat';

export default mergeConfig(
  base,
  defineConfig({
    define: { __ARTIFACT__: 'true' },
    build: {
      outDir: 'dist-artifact',
      emptyOutDir: true,
      cssCodeSplit: false,
      modulePreload: { polyfill: false },
      rolldownOptions: { external: isLib },
    },
  }),
);
