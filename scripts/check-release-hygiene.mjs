import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE_IDENTIFIER_KEY = /^(?:serial|serialnumber|udid|deviceid|hardwareid)$/i;
const SAFE_IDENTIFIER_VALUE = /^(?:|<redacted>|redacted|not-collected|unknown|n\/a)$/i;

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

export function trackedTextFiles(root = ROOT) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });

  return output.split('\0').filter(Boolean).flatMap((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    let content;
    try {
      content = fs.readFileSync(absolutePath);
    } catch {
      return [];
    }
    if (content.includes(0)) return [];
    return [{ relativePath: relativePath.replaceAll('\\', '/'), source: content.toString('utf8') }];
  });
}

export function auditReleaseHygiene(root = ROOT) {
  return trackedTextFiles(root).flatMap(({ relativePath, source }) => (
    findPrivateIdentifiers(relativePath, source)
  ));
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
