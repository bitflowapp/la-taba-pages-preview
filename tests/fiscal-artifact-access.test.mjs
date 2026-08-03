import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../supabase/functions/fiscal-artifact-access/index.ts', import.meta.url), 'utf8');

test('Edge fiscal entrega URLs privadas efímeras tras autorización SQL', () => {
  assert.match(source, /authorize_fiscal_artifact_access/);
  assert.match(source, /createSignedUrl\(artifact\.storage_path, 60/);
  assert.match(source, /expiresAt/);
  assert.match(source, /ARTIFACT_ACCESS_DENIED/);
  assert.match(source, /return json\(\{ signedUrl: signed\.signedUrl,/);
  assert.doesNotMatch(source, /return json\(\{[^}]*storage_path/i);
});

test('Edge fiscal limita CORS a Tauri u orígenes configurados', () => {
  assert.match(source, /tauriOrigin/);
  assert.match(source, /tauri\\\.localhost/);
  assert.match(source, /FISCAL_PANEL_ORIGINS/);
  assert.match(source, /authorization, apikey, content-type/);
});

test('la service role sólo existe en el perímetro privado Edge', () => {
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  const clientSource = fs.readFileSync(new URL('../js/repositories/supabase-fiscal-repository.js', import.meta.url), 'utf8');
  assert.doesNotMatch(clientSource, /service.?role|storage_path/i);
});
