import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'supabase', 'migrations');
const NAME = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/;
const PRODUCTIVE_TABLES = [
  'businesses',
  'business_members',
  'products',
  'orders',
  'order_items',
  'order_events',
  'rider_locations',
  'order_public_tokens',
];

export function reviewMigrations(directory = DIR) {
  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  const issues = [];
  const timestamps = new Set();
  const combined = files.map((file) => {
    const match = file.match(NAME);
    if (!match) issues.push(issue('error', file, 'Nombre inválido; usar YYYYMMDDHHMMSS_descripcion.sql.'));
    if (match && timestamps.has(match[1])) issues.push(issue('error', file, 'Timestamp de migración duplicado.'));
    if (match) timestamps.add(match[1]);

    /*
     * El BOM de UTF-8 al principio del archivo. Un editor de Windows lo pone
     * solo y no se ve en ningún diff, pero Postgres no lo perdona: el primer
     * statement empieza con un carácter que no es SQL y la migración muere con
     *
     *     ERROR: syntax error at or near "﻿" (SQLSTATE 42601)
     *     At statement: 0
     *
     * Pasó el 2026-08-23 con `20260807155000_rider_map_location_contract_
     * reconciliation.sql`: se aplicaron 112 migraciones y se cayó en ésa, sin
     * llegar a las 162 aserciones pgTAP ni al simulacro de restauración. Leer
     * el archivo con `utf8` lo esconde —JavaScript lo deja pasar como un
     * carácter invisible más—, así que se mira el byte crudo.
     */
    const crudo = fs.readFileSync(path.join(directory, file));
    if (crudo[0] === 0xEF && crudo[1] === 0xBB && crudo[2] === 0xBF) {
      issues.push(issue(
        'error',
        file,
        'Empieza con BOM de UTF-8: Postgres lo lee como un carácter fuera de lugar y aborta '
        + 'la migración con «syntax error at or near». Guardar el archivo como UTF-8 sin BOM.',
      ));
    }

    return `\n-- FILE ${file}\n${crudo.toString('utf8')}`;
  }).join('\n');

  const normalized = stripSqlComments(combined).toLowerCase();
  for (const table of PRODUCTIVE_TABLES) {
    if (
      normalized.includes(`create table if not exists public.${table}`)
      && !normalized.includes(`alter table public.${table} enable row level security`)
    ) {
      issues.push(issue('error', '*', `La tabla productiva ${table} no habilita RLS.`));
    }
  }

  if (/\bgrant\s+all(?:\s+privileges)?\s+on\b[\s\S]{0,180}\bto\s+(?:public|anon)\b/i.test(combined)) {
    issues.push(issue('error', '*', 'Grant ALL público/anon detectado.'));
  }
  if (/\bgrant\s+(?:insert|update|delete)(?:\s*,[^;]+)?\s+on\s+table\s+public\.(?:orders|order_items|order_public_tokens)\s+to\s+anon\b/i.test(combined)) {
    issues.push(issue('error', '*', 'Mutación directa anónima sobre pedidos o tokens.'));
  }

  const functions = [...combined.matchAll(
    /create\s+or\s+replace\s+function\s+([\w.]+)\s*\([^;]*?\)\s*returns[\s\S]*?\$\$[\s\S]*?\$\$\s*language[\s\S]*?;/gi,
  )];
  for (const match of functions) {
    const block = match[0];
    if (/security\s+definer/i.test(block) && !/set\s+search_path\s*=\s*(?:pg_catalog,\s*)?public/i.test(block)) {
      issues.push(issue('warning', match[1], 'SECURITY DEFINER sin search_path público explícito en el bloque detectado.'));
    }
  }

  const incompatible = [
    [/\buuid_generate_v4\s*\(/i, 'uuid_generate_v4 requiere extensión uuid-ossp; preferir gen_random_uuid().', null],
    [/\bextensions\.http_/i, 'Dependencia de extensión HTTP no portable.', null],
    [
      /\bnet\.http_/i,
      'Dependencia de pg_net no garantizada en una base vacía.',
      /create\s+extension\s+if\s+not\s+exists\s+pg_net\b/i,
    ],
  ];
  for (const [pattern, message, guaranteedBy] of incompatible) {
    if (pattern.test(combined) && !(guaranteedBy && guaranteedBy.test(combined))) {
      issues.push(issue('warning', '*', message));
    }
  }

  const createdColumns = new Set(
    [...normalized.matchAll(/\b(?:add\s+column\s+if\s+not\s+exists|add\s+column|^\s*)([a-z_][a-z0-9_]*)\s+[\w.]+/gm)]
      .map((match) => match[1]),
  );
  for (const match of combined.matchAll(/create\s+policy[\s\S]*?\busing\s*\(([\s\S]*?)\)\s*(?:with\s+check|;)/gi)) {
    for (const identifier of match[1].matchAll(/\b(?:new|old|o|p|rl)\.([a-z_][a-z0-9_]*)\b/gi)) {
      if (!createdColumns.has(identifier[1].toLowerCase())) {
        issues.push(issue('info', '*', `Revisar columna de política: ${identifier[1]} (el análisis estático no pudo resolverla).`));
      }
    }
  }

  for (const match of combined.matchAll(/insert\s+into\s+public\.([a-z_]+)\s*\(([^)]+)\)/gi)) {
    if (!match[2].trim()) issues.push(issue('error', match[1], 'INSERT sin lista de columnas.'));
  }

  return { files, issues };
}

function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function issue(severity, subject, message) {
  return { severity, subject, message };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const report = reviewMigrations(process.argv[2] ? path.resolve(process.argv[2]) : DIR);
  console.log(`Migraciones revisadas en orden: ${report.files.length}`);
  for (const item of report.issues) {
    console.log(`${item.severity.toUpperCase()} ${item.subject}: ${item.message}`);
  }
  const errors = report.issues.filter((item) => item.severity === 'error');
  if (errors.length) {
    console.error(`Falló la revisión estática con ${errors.length} error(es).`);
    process.exitCode = 1;
  } else {
    console.log('Revisión estática aprobada. Falta aplicar las migraciones a Supabase local o staging.');
  }
}
