import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE_IDENTIFIER_KEY = /^(?:serial|serialnumber|udid|deviceid|hardwareid)$/i;
const SAFE_IDENTIFIER_VALUE = /^(?:|<redacted>|redacted|not-collected|unknown|n\/a)$/i;
const LOCAL_PATH_PATTERNS = [
  {
    category: 'local-drive-path',
    expression: /(?<![A-Za-z0-9_.-])[A-Za-z]:[\\/][^\s`"'<>|]+/g,
  },
  {
    category: 'personal-home-path',
    expression: /(?<![A-Za-z0-9_.:/-])\/(?:Users|home)\/[^/\s`"'<>|]+(?:\/[^\s`"'<>|]+)*/g,
  },
];
const PUBLIC_QA_ASSET_PATH = /^assets\/(?:.*\/)?qa-[^/]*\.webp$/i;
const PUBLIC_QA_ASSET_REFERENCE = /\bqa-[a-z0-9][a-z0-9._-]*\.webp\b/gi;

export function findPrivateIdentifiers(relativePath, source) {
  if (path.extname(relativePath).toLowerCase() !== '.json') return [];

  let value;
  try {
    value = JSON.parse(source);
  } catch {
    return [];
  }

  const findings = [];
  const visit = (candidate, jsonPath = '$') => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${jsonPath}[${index}]`));
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;

    for (const [key, child] of Object.entries(candidate)) {
      const childPath = `${jsonPath}.${key}`;
      if (
        PRIVATE_IDENTIFIER_KEY.test(key)
        && typeof child === 'string'
        && !SAFE_IDENTIFIER_VALUE.test(child.trim())
      ) {
        findings.push({
          file: relativePath,
          location: childPath,
          category: 'private-device-identifier',
        });
      }
      visit(child, childPath);
    }
  };

  visit(value);
  return findings;
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

export function findPersonalLocalPaths(relativePath, source) {
  const findings = [];

  for (const { category, expression } of LOCAL_PATH_PATTERNS) {
    expression.lastIndex = 0;
    let match = expression.exec(source);
    while (match) {
      findings.push({
        file: relativePath,
        location: `line ${lineNumberAt(source, match.index)}`,
        category,
      });
      match = expression.exec(source);
    }
  }

  return findings;
}

function isPublicRuntimeFile(relativePath) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  return normalizedPath === 'index.html'
    || normalizedPath === 'sw.js'
    || normalizedPath === 'manifest.webmanifest'
    || normalizedPath === 'runtime-config.js'
    || normalizedPath.startsWith('js/')
    || normalizedPath.startsWith('styles/')
    || /^[^/]+\.(?:css|html|js)$/i.test(normalizedPath);
}

export function findPublicQaAssets(relativePath, source) {
  const normalizedPath = relativePath.replaceAll('\\', '/');

  if (source === undefined) {
    return PUBLIC_QA_ASSET_PATH.test(normalizedPath)
      ? [{
          file: normalizedPath,
          location: 'tracked path',
          category: 'public-qa-asset',
        }]
      : [];
  }

  if (!isPublicRuntimeFile(normalizedPath)) return [];

  const findings = [];
  PUBLIC_QA_ASSET_REFERENCE.lastIndex = 0;
  let match = PUBLIC_QA_ASSET_REFERENCE.exec(source);
  while (match) {
    findings.push({
      file: normalizedPath,
      location: `line ${lineNumberAt(source, match.index)}`,
      category: 'public-qa-runtime-reference',
    });
    match = PUBLIC_QA_ASSET_REFERENCE.exec(source);
  }
  return findings;
}

export function trackedFilePaths(root = ROOT) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });

  return output
    .split('\0')
    .filter(Boolean)
    .map((relativePath) => relativePath.replaceAll('\\', '/'));
}

export function trackedTextFiles(root = ROOT, relativePaths = trackedFilePaths(root)) {
  return relativePaths.flatMap((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    let content;
    try {
      content = fs.readFileSync(absolutePath);
    } catch {
      return [];
    }
    if (content.includes(0)) return [];
    return [{ relativePath, source: content.toString('utf8') }];
  });
}

export function auditReleaseHygiene(root = ROOT) {
  const relativePaths = trackedFilePaths(root);
  const pathFindings = relativePaths.flatMap((relativePath) => (
    findPublicQaAssets(relativePath)
  ));
  const contentFindings = trackedTextFiles(root, relativePaths)
    .flatMap(({ relativePath, source }) => [
      ...findPrivateIdentifiers(relativePath, source),
      ...findPersonalLocalPaths(relativePath, source),
      ...findPublicQaAssets(relativePath, source),
    ]);
  return [...pathFindings, ...contentFindings];
}

function run() {
  const findings = auditReleaseHygiene();
  if (!findings.length) {
    console.log('Release hygiene check passed.');
    return;
  }

  console.error(`Release hygiene check failed with ${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`- ${finding.file} (${finding.location}; ${finding.category})`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) run();
