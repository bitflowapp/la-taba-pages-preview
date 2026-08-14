import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(root, '.claude', 'skills');
const systemDoc = path.join(root, 'docs', 'CLAUDE-COMMERCIAL-SKILLS.md');

// Los seis campos que aceptan TODAS las vías de distribución del estándar
// Agent Skills. Cualquier otro rompe el empaquetado con un error duro, así que
// el paquete se restringe a estos aunque Claude Code acepte más.
const SPEC_FRONTMATTER_FIELDS = new Set([
  'name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools',
]);

const EXPECTED_SKILLS = [
  'taba-catalog-management',
  'taba-commercial-analytics',
  'taba-commercial-qa',
  'taba-copy-ux',
  'taba-loyalty',
  'taba-merchandising',
  'taba-pricing-promotions',
  'taba-reorder-retention',
];

// El cuerpo de un SKILL.md se carga entero cuando la skill se activa. La guía
// oficial admite hasta ~500 líneas; este paquete apunta más abajo porque son
// ocho skills que pueden activarse juntas.
const MAX_SKILL_BODY_LINES = 140;

function listSkillDirectories() {
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readSkill(name) {
  const file = path.join(skillsRoot, name, 'SKILL.md');
  const source = fs.readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  assert.ok(match, `${name}: SKILL.md no empieza con frontmatter YAML`);
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf(':');
    assert.ok(separator > 0, `${name}: línea de frontmatter inválida: ${line}`);
    frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { name, file, frontmatter, body: match[2], source };
}

function listMarkdownFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(candidate));
    else if (entry.name.endsWith('.md')) files.push(candidate);
  }
  return files;
}

const skillDirectories = listSkillDirectories();
const skills = skillDirectories.map(readSkill);
const packMarkdown = listMarkdownFiles(skillsRoot);

test('el paquete contiene exactamente las ocho skills comerciales', () => {
  assert.deepEqual(skillDirectories, EXPECTED_SKILLS);
});

test('cada frontmatter respeta el estándar Agent Skills', () => {
  for (const skill of skills) {
    for (const field of Object.keys(skill.frontmatter)) {
      assert.ok(
        SPEC_FRONTMATTER_FIELDS.has(field),
        `${skill.name}: campo "${field}" fuera del estándar; rompe el empaquetado`,
      );
    }

    const declaredName = skill.frontmatter.name;
    assert.equal(declaredName, skill.name, `${skill.name}: name debe coincidir con la carpeta`);
    assert.match(declaredName, /^[a-z0-9-]+$/, `${skill.name}: sólo minúsculas, números y guiones`);
    assert.ok(declaredName.length <= 64, `${skill.name}: name supera 64 caracteres`);
    assert.doesNotMatch(
      declaredName,
      /anthropic|claude/i,
      `${skill.name}: el name no puede contener palabras reservadas`,
    );

    const { description } = skill.frontmatter;
    assert.ok(description && description.length > 0, `${skill.name}: description vacía`);
    assert.ok(description.length <= 1024, `${skill.name}: description supera 1024 caracteres`);
    assert.doesNotMatch(description, /[<>]/, `${skill.name}: la description no admite etiquetas`);
    // La description es lo ÚNICO que decide si la skill se activa: tiene que
    // decir qué hace y cuándo usarla.
    assert.match(
      description,
      /Usar cuando/i,
      `${skill.name}: la description no declara cuándo activarse`,
    );
  }
});

test('el cuerpo de cada SKILL.md se mantiene chico', () => {
  for (const skill of skills) {
    const lines = skill.body.split(/\r?\n/).length;
    assert.ok(
      lines <= MAX_SKILL_BODY_LINES,
      `${skill.name}: ${lines} líneas de cuerpo, máximo ${MAX_SKILL_BODY_LINES}. Mover a references/`,
    );
  }
});

test('cada skill declara qué NO le corresponde', () => {
  // Sin esta sección las skills se pisan: tres explicando la misma regla con
  // palabras distintas es peor que ninguna.
  for (const skill of skills) {
    assert.match(
      skill.body,
      /## Nunca|Qué nunca hace/,
      `${skill.name}: falta la sección de límites`,
    );
  }
});

test('todo enlace relativo del paquete resuelve', () => {
  for (const file of packMarkdown) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, target] of source.matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)) {
      const resolved = path.resolve(path.dirname(file), target);
      assert.ok(
        fs.existsSync(resolved),
        `${path.relative(root, file)}: enlace roto → ${target}`,
      );
    }
  }
});

test('las rutas del repo que citan las skills existen', () => {
  const repoPath = /^(?:js|catalog|data|docs|tests|scripts|assets|styles|supabase|templates)\/[A-Za-z0-9._/-]+$|^[A-Z][A-Z0-9-]*\.md$/;
  for (const file of packMarkdown) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, token] of source.matchAll(/`([^`\n]+)`/g)) {
      if (!repoPath.test(token)) continue;
      assert.ok(
        fs.existsSync(path.join(root, token)),
        `${path.relative(root, file)}: cita una ruta que no existe → ${token}`,
      );
    }
  }
});

test('los comandos npm que citan las skills existen', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  for (const file of packMarkdown) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, script] of source.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
      assert.ok(
        Object.hasOwn(scripts, script),
        `${path.relative(root, file)}: cita un script inexistente → npm run ${script}`,
      );
    }
  }
});

test('ninguna skill congela datos comerciales volátiles', () => {
  // Un precio, un stock o una promo copiados acá sobreviven al día en que
  // dejaron de ser ciertos, y nadie los audita porque parecen documentación.
  const frozen = [
    { pattern: /ARS\s*\d/i, what: 'importe en pesos' },
    { pattern: /\$\s?\d{1,3}(?:[.,]\d{3})+/, what: 'importe con separador de miles' },
    { pattern: /\$\s?\d{2,}/, what: 'importe' },
    { pattern: /\d+\s*%\s*(?:de\s*)?(?:descuento|off)/i, what: 'descuento concreto' },
    { pattern: /\bstock\s*[:=]\s*\d+/i, what: 'stock concreto' },
  ];
  for (const file of packMarkdown) {
    const source = fs.readFileSync(file, 'utf8');
    for (const { pattern, what } of frozen) {
      assert.doesNotMatch(
        source,
        pattern,
        `${path.relative(root, file)}: ${what} congelado; referenciar la fuente en vez de copiar el valor`,
      );
    }
  }
});

test('ninguna skill filtra rutas locales ni secretos', () => {
  const leaks = [
    { pattern: /(?<![A-Za-z0-9_.-])[A-Za-z]:[\\/][^\s`"'<>|]+/, what: 'ruta con letra de unidad' },
    { pattern: /(?<![A-Za-z0-9_.:/-])\/(?:Users|home)\/[^/\s`"'<>|]+/, what: 'ruta personal' },
    { pattern: /sb_secret_|service_role|eyJ[A-Za-z0-9_-]{20,}/, what: 'credencial' },
    { pattern: /APP_USR-|TEST-[0-9a-f]{8}/, what: 'credencial de pagos' },
  ];
  for (const file of packMarkdown) {
    const source = fs.readFileSync(file, 'utf8');
    for (const { pattern, what } of leaks) {
      assert.doesNotMatch(source, pattern, `${path.relative(root, file)}: ${what}`);
    }
  }
});

test('cada regla comercial tiene una sola dueña', () => {
  const doc = fs.readFileSync(systemDoc, 'utf8');
  const section = /## Quién es dueño de cada regla\r?\n([\s\S]*?)\r?\n## /.exec(doc);
  assert.ok(section, 'falta la tabla de dueños en el documento del sistema');

  const owners = new Map();
  for (const [, rule, owner] of section[1].matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|\s*`([a-z0-9-]+)`\s*\|$/gm)) {
    assert.ok(!owners.has(rule), `la regla ${rule} aparece dos veces en la tabla de dueños`);
    assert.ok(EXPECTED_SKILLS.includes(owner), `la regla ${rule} se asigna a una skill inexistente: ${owner}`);
    owners.set(rule, owner);
  }

  assert.ok(owners.size >= 20, `la tabla de dueños quedó corta: ${owners.size} reglas`);
  const withoutRules = EXPECTED_SKILLS.filter((skill) => ![...owners.values()].includes(skill));
  assert.deepEqual(withoutRules, [], `estas skills no son dueñas de ninguna regla: ${withoutRules}`);
});

test('el documento del sistema lista las ocho skills', () => {
  const doc = fs.readFileSync(systemDoc, 'utf8');
  for (const skill of EXPECTED_SKILLS) {
    assert.ok(doc.includes(skill), `el documento del sistema no menciona ${skill}`);
  }
});

test('las diez reglas de oro están una sola vez, en el documento del sistema', () => {
  const doc = fs.readFileSync(systemDoc, 'utf8');
  const goldenSection = /## Las diez reglas de oro\r?\n([\s\S]*?)\r?\n## /.exec(doc);
  assert.ok(goldenSection, 'faltan las reglas de oro');
  const numbered = goldenSection[1].match(/^\d+\. /gm) || [];
  assert.equal(numbered.length, 10, 'las reglas de oro deben ser exactamente diez');
});
