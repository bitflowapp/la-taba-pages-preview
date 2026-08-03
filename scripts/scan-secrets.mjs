import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', '.temp', 'node_modules', 'coverage', 'playwright-report', 'test-results']);
const findings = [];
const patterns = [
  ['Mercado Pago access token', /\b(?:APP_USR|TEST)-[A-Za-z0-9_-]{20,}\b/],
  ['private key', /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['assigned Mercado Pago secret', /MERCADOPAGO_(?:ACCESS_TOKEN|WEBHOOK_SECRET)\s*[:=]\s*['"]?(?!\$\{|\{\{|<|your_|example|replace)[A-Za-z0-9._-]{16,}/i],
];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(candidate);
    else if (entry.isFile() && fs.statSync(candidate).size <= 2_000_000) inspect(candidate);
  }
}

function inspect(file) {
  const content = fs.readFileSync(file);
  if (content.includes(0)) return;
  const text = content.toString('utf8');
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) findings.push(`${path.relative(root, file)}: ${label}`);
  }
}

walk(root);
if (findings.length) {
  console.error('Potential secret material found:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log('Secret scan passed: no assigned payment credentials or private keys found.');
