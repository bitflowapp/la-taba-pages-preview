// Prepare the existing storefront for an isolated preview. Does not publish.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sha256 } from './plan.mjs';
import { withRecoveryProject } from './hosted-client.mjs';
import { auditProductImageRights, PRODUCT_IMAGE_NAMESPACES } from '../lib/publishable-image-rights.mjs';
import { runtimeDeclarado, sello } from '../deploy/sellar-version.mjs';

const value = name => process.argv[process.argv.indexOf(name) + 1];
if (!['--target', '--out', '--commit'].every(arg => process.argv.includes(arg))) throw new Error('Requires --target --out --commit');
const target = JSON.parse(fs.readFileSync(value('--target'), 'utf8'));
const out = path.resolve(value('--out'));
if (process.platform === 'win32' && !/^D:\\/i.test(out)) throw new Error('Use D: for recovery artifacts');
if (fs.existsSync(out) || out === ROOT || out.startsWith(ROOT + path.sep)) throw new Error('New output directory required');
const version = sello({ commit: value('--commit'), runtime: runtimeDeclarado(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')),
  construidoEn: new Date().toISOString() });
await withRecoveryProject(target, async ({ request }) => {
  const keys = await request('/api-keys?reveal=true');
  const key = keys.find(key => key.type === 'publishable');
  if (!key) throw new Error('Publishable key unavailable');
  const rights = auditProductImageRights(ROOT);
  const allowed = new Set(rights.filter(image => image.publishable).map(image => image.path));
  const filter = source => {
    const relative = path.relative(ROOT, source).replaceAll('\\', '/');
    return fs.statSync(source).isDirectory() || !PRODUCT_IMAGE_NAMESPACES.some(ns => relative.startsWith(ns)) || allowed.has(relative);
  };
  fs.mkdirSync(out, { recursive: true });
  for (const entry of ['index.html', 'styles.css', 'styles', 'manifest.webmanifest', 'runtime-config.js',
    'sw.js', '.nojekyll', '_headers', 'assets', 'js', 'pago', 'cuenta']) {
    fs.cpSync(path.join(ROOT, entry), path.join(out, entry), { recursive: true, filter });
  }
  const runtime = { mode: 'production', repository: { provider: 'supabase', deploymentEnvironment: 'staging',
    supabaseUrl: `https://${target.projectRef}.supabase.co`, publishableKey: key.api_key,
    businessId: '00000000-0000-4000-8000-000000000001', pollMs: 5000 } };
  fs.writeFileSync(path.join(out, 'runtime-config.js'), `globalThis.__LA_TABA_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(runtime)});\n`);
  fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify(version, null, 2) + '\n');
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push({ path: path.relative(out, file).replaceAll('\\', '/'), sha256: sha256(fs.readFileSync(file)), bytes: fs.statSync(file).size });
    }
  };
  walk(out);
  fs.writeFileSync(out + '-receipt.json', JSON.stringify({ ...version, projectRef: target.projectRef,
    checkoutOrigin: target.checkoutOrigin, deployed: false, files }, null, 2) + '\n');
  console.log(JSON.stringify({ out, deployed: false, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }));
});
