import { defineConfig } from '@farmfe/core';

export default defineConfig({
  compilation: {
    input: { index: './index.html' },
    output: { path: 'dist', publicPath: './' },
  },
  envPrefix: ['FARM_', 'VITE_'],
  plugins: ['@farmfe/plugin-react'],
});
