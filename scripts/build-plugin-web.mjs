// Builds the web analyzer as one self-contained HTML page for the plugin's WebView.
// Output: plugin/web/index.html (embedded into the plugin binary at build time).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist-plugin');
const outFile = join(root, 'plugin', 'web', 'index.html');

rmSync(distDir, { recursive: true, force: true });
execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', distDir], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, LIQUIDSPECTRA_PLUGIN: '1' },
});

let html = readFileSync(join(distDir, 'index.html'), 'utf8');

// Inline every module script and stylesheet so the page needs no other file
html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const code = readFileSync(join(distDir, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${code}</script>`;
});
html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => {
  return `<style>${readFileSync(join(distDir, href), 'utf8')}</style>`;
});
// Preloads point at chunks that are now inlined
html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, '');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
rmSync(distDir, { recursive: true, force: true });
console.log(`Plugin web bundle: ${outFile} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
