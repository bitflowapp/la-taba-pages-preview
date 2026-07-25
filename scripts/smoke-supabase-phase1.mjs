#!/usr/bin/env node

console.error([
  'Este smoke legado fue deshabilitado.',
  'Usaba escrituras REST directas y GPS simulado incompatibles con la seguridad productiva.',
  'Ejecutá: npm run smoke:supabase',
].join('\n'));

process.exitCode = 1;
