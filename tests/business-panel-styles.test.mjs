import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const businessCss = fs.readFileSync(path.join(root, 'styles', 'business.css'), 'utf8');
const tokensCss = fs.readFileSync(path.join(root, 'styles', 'tokens.css'), 'utf8');

function ruleBody(css, selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `falta la regla ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  assert.ok(open !== -1 && close !== -1, `la regla ${selector} está incompleta`);
  return css.slice(open + 1, close);
}

test('el corte de palabra global sigue existiendo, y por eso hace falta el ajuste local', () => {
  // Si algún día se quita esta regla global, el override de abajo deja de ser necesario.
  assert.match(tokensCss, /h1,\s*\n\s*h2,\s*\n\s*h3,\s*\n\s*strong \{\s*\n\s*overflow-wrap: anywhere;/);
});

test('los títulos de tarjeta no se parten al medio cuando el estado los aprieta', () => {
  const body = ruleBody(businessCss, '.device-row header strong,\n.opening-check header strong');
  assert.match(body, /overflow-wrap: break-word;/);
  assert.match(body, /min-width: 0;/);
  assert.doesNotMatch(body, /overflow-wrap: anywhere;/);
});

test('el encabezado deja caer el estado a la línea siguiente en vez de exprimir el título', () => {
  const body = ruleBody(businessCss, '.device-row header,\n.opening-check header');
  assert.match(body, /flex-wrap: wrap;/);
  assert.match(body, /display: flex;/);
});
