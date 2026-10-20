import { defineConfig } from '@farmfe/core';
import fs from 'node:fs';

// Read .env.local (written by `npx convex dev`) so CONVEX_URL works locally;
// in CI the variable comes from the environment (`npx convex deploy --cmd`).
function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split('\n')
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#\n]*)"?/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1], m[2].trim()]),
  );
}
const env = { ...readEnvFile('.env.local'), ...process.env };
const convexUrl = env.FARM_CONVEX_URL || env.CONVEX_URL || env.VITE_CONVEX_URL || '';

export default defineConfig({
  compilation: {
    input: { index: './index.html' },
    output: { path: 'dist', publicPath: '/' },
    sourcemap: false,
    define: { 'process.env.FARM_CONVEX_URL': JSON.stringify(convexUrl) },
  },
  plugins: ['@farmfe/plugin-react'],
});
