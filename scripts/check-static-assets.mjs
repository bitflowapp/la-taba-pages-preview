import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'runtime-config.js',
  'sw.js',
  '.nojekyll',
  'README.md',
  'assets/icon.svg',
  'js/config.js',
  'js/data.js',
  'js/state.js',
  'js/cart.js',
  'js/orders.js',
  'js/business.js',
  'js/delivery.js',
  'js/production-operations.js',
  'js/core/runtime-config.js',
  'js/repositories/unavailable_order_repository.js',
  'js/services/supabase-auth.js',
  'js/services/supabase-client.js',
  'js/ui.js',
  'js/app.js',
  'js/vendor/supabase.js',
];

const missing = requiredFiles.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)));
if (missing.length) {
  console.error(`Missing required files: ${missing.join(', ')}`);
  process.exit(1);
}

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!indexHtml.includes('<script type="module" src="js/app.js"></script>')) {
  console.error('index.html must load js/app.js as an ES module.');
  process.exit(1);
}

if (indexHtml.includes('src="/js/') || indexHtml.includes('href="/js/') || indexHtml.includes('src="/assets/')) {
  console.error('index.html contains root-absolute asset paths that can break on GitHub Pages.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const manifestFields = ['name', 'short_name', 'start_url', 'display', 'icons'];
const missingManifestFields = manifestFields.filter((field) => manifest[field] == null || manifest[field] === '');
if (missingManifestFields.length) {
  console.error(`manifest.webmanifest missing fields: ${missingManifestFields.join(', ')}`);
  process.exit(1);
}

if (!Array.isArray(manifest.icons) || !manifest.icons.length) {
  console.error('manifest.webmanifest must include at least one icon.');
  process.exit(1);
}

const badIconPaths = manifest.icons.filter((icon) => typeof icon.src !== 'string' || icon.src.startsWith('/'));
if (badIconPaths.length) {
  console.error('manifest.webmanifest contains non-relative icon paths.');
  process.exit(1);
}
