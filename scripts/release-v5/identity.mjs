import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { ROOT, PROTOCOL, PROJECT, FUNCTIONS, VERIFY_JWT, EXPAND, CONTRACT, identity, sha256 } from './model.mjs';

export const RUNTIME_WRAPPER = `function __tabaServeV5(handler) {
  return Deno.serve((request, info) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.endsWith('/__taba_release_v5')) {
      const nonce = url.searchParams.get('nonce') || '';
      if (!/^[a-f0-9-]{36}$/.test(nonce)) return new Response(null, {status: 400});
      return new Response(JSON.stringify({...globalThis.__TABA_RELEASE_V5__, nonce,
        deployment_id: Deno.env.get('DENO_DEPLOYMENT_ID') || null}), {
        headers: {'content-type': 'application/json', 'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff'}
      });
    }
    return handler(request, info);
  });
}\n`;

export function localContext(root = ROOT, { requireClean = true } = {}) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(path.resolve(git(['rev-parse', '--show-toplevel'])).toLowerCase(), path.resolve(root).toLowerCase(), 'wrong repository root');
  if (requireClean) assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '', 'release requires immutable clean checkout');
  const commit = git(['rev-parse', 'HEAD']);
  const reviewed = file => requireClean ? execFileSync('git',['show',`${commit}:${file}`],{cwd:root,windowsHide:true}) : fs.readFileSync(path.join(root,file));
  const files = EXPAND.map(name => ({ path: `supabase/migrations/${name}`, sha256: sha256(reviewed(`supabase/migrations/${name}`)) }));
  return { commit, expand: files, expand_sha: identity(files), contract_sha: sha256(reviewed(CONTRACT)), compatibility_sha: sha256(reviewed('scripts/release-v5/compatibility.json')) };
}

// A compiler follows executable imports, including shared files and every npm
// dependency. There are no server-resolved package ranges, dynamic imports or
// local file dependencies in the upload. The exact JS bytes are the source
// identity; Supabase's EZBR hash remains a separate, remote identity domain.
export async function buildSources(root = ROOT, { commit } = {}) {
  const outputs = {};
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const config = fs.readFileSync(path.join(root,'supabase/config.toml'),'utf8');
  for (const slug of FUNCTIONS) {
    const section = new RegExp(`\\[functions\\.${slug}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(config)?.[1];
    assert.ok(section, 'explicit function gateway configuration required');
    const lines = section.split('\n').map(line=>line.replace(/#.*/,'').trim()).filter(Boolean);
    assert.deepEqual(lines,[`verify_jwt = ${VERIFY_JWT[slug]}`],'unsupported/mismatched deployment configuration');
    const loaded = new Map();
    const result = await build({
      absWorkingDir: root, entryPoints: [`supabase/functions/${slug}/index.ts`],
      write: false, bundle: true, metafile: true, platform: 'browser', format: 'esm',
      target: 'es2022', charset: 'utf8', legalComments: 'none', sourcemap: false,
      plugins: [{ name: 'pinned-deno-npm', setup(builder) {
        builder.onLoad({ filter: /\.(?:[cm]?js|ts|json)$/ }, ({path: file}) => {
          const contents = fs.readFileSync(file);
          const relative = path.relative(root,file).replaceAll('\\','/');
          if (commit && !relative.startsWith('node_modules/')) {
            const reviewed = execFileSync('git',['show',`${commit}:${relative}`],{cwd:root,windowsHide:true});
            assert.equal(sha256(contents),sha256(reviewed),'runtime source differs from immutable commit');
          }
          loaded.set(relative,sha256(contents));
          return { contents, loader: file.endsWith('.json')?'json':file.endsWith('.ts')?'ts':'js' };
        });
        builder.onResolve({ filter: /^npm:/ }, async ({ path: specifier, resolveDir }) => {
          const match = /^npm:((?:@[^/]+\/)?[^@/]+)@(\d+\.\d+\.\d+)$/.exec(specifier);
          assert.ok(match, 'only exact npm import versions are permitted');
          assert.equal(lock.packages[`node_modules/${match[1]}`]?.version, match[2], 'Deno/npm version mismatch');
          return builder.resolve(match[1], { resolveDir, kind: 'import-statement' });
        });
      } }],
    });
    assert.equal(result.outputFiles.length, 1);
    for (const output of Object.values(result.metafile.outputs)) assert.deepEqual(output.imports, [], 'unbundled runtime dependency');
    const inputs = Object.keys(result.metafile.inputs).sort();
    for (const input of inputs) {
      assert.ok(!/\.deno\.ts$|\.test\.|(?:^|\/)tests\//.test(input), 'test-only module entered production graph');
      assert.ok(!path.isAbsolute(input) && !input.startsWith('../'), 'runtime dependency escapes repository');
      if (input.startsWith('node_modules/')) {
        const packagePath = input.match(/^(node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1];
        assert.ok(lock.packages[packagePath]?.integrity, 'unlocked runtime package');
        const installed = JSON.parse(fs.readFileSync(path.join(root, packagePath, 'package.json'), 'utf8'));
        assert.equal(installed.version, lock.packages[packagePath].version, 'installed package version mismatch');
      }
    }
    const source = result.outputFiles[0].text;
    assert.ok(Buffer.byteLength(source) < 4_000_000, 'server bundle size limit');
    const inputHashes = inputs.map(file => { assert.ok(loaded.has(file),'unobserved compiler input');return { path: file, sha256: loaded.get(file) }; });
    outputs[slug] = { source, sha256: sha256(source), inputs, inputHashes, verify_jwt: VERIFY_JWT[slug] };
  }
  const sourceIdentity = identity({ protocol: PROTOCOL, wrapper_sha: sha256(RUNTIME_WRAPPER), functions: FUNCTIONS.map(slug => ({ slug, sha256: outputs[slug].sha256, inputs: outputs[slug].inputHashes, verify_jwt: outputs[slug].verify_jwt })) });
  return { outputs, sourceIdentity };
}
export function markedSource(built, slug, releaseId) {
  assert.ok(FUNCTIONS.includes(slug));
  assert.match(releaseId, /^[a-f0-9-]{36}$/i);
  const marker = { protocol: PROTOCOL, project: PROJECT, release_id: releaseId, source_identity: built.sourceIdentity, function: slug };
  assert.equal((built.outputs[slug].source.match(/\bDeno\.serve\(/g)||[]).length,1,'one reviewed runtime entrypoint required');
  const wrapped = built.outputs[slug].source.replace(/\bDeno\.serve\(/,'__tabaServeV5(');
  return `Object.defineProperty(globalThis, '__TABA_RELEASE_V5__', {value: Object.freeze(${JSON.stringify(marker)})});\n${RUNTIME_WRAPPER}${wrapped}`;
}
