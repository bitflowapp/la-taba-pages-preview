// Checks the newest backup's actual ciphertext and hashes, never decrypts it
// or reads a key. A missing/corrupted latest copy, invalid clock/limit or stale
// backup raises the alarm, even if a manifest still claims it was verified.
// --root <snapshots> --max-hours 26 [--project-ref <ref>] [--require-restore-test]
// Schedule it from any machine that can see the backup folder (Windows Task Scheduler, cron) and alert on exit code 1.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MAGIC } from './postgres-backup.mjs';

export function newestBackup(root, { projectRef } = {}) {
  if(projectRef!==undefined&&!/^[a-z]{20}$/.test(projectRef)) throw Error('Invalid backup project reference');
  const found = [];
  const visit = (dir, depth) => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.name === 'manifest.json') {
        try {
          const manifest = JSON.parse(fs.readFileSync(full, 'utf8'));
          const capturedAt = Date.parse(manifest.capturedAt);
          if (Number.isFinite(capturedAt) && /^[a-f0-9]{64}$/.test(manifest.encryptedSha256 || '') &&
              manifest.encryptionRoundtripVerified === true && /^[a-z]{20}$/.test(manifest.projectRef || '') &&
              (!projectRef || manifest.projectRef===projectRef)) {
            found.push({ file: full, capturedAt, projectRef: manifest.projectRef,
              restoreTestCompleted: manifest.restoreTestCompleted === true, manifest });
          }
        } catch { /* not a backup manifest */ }
      }
    }
  };
  visit(root, 0);
  const newest=found.sort((a,b)=>b.capturedAt-a.capturedAt)[0];
  if(!newest) return null;
  const {manifest,...result}=newest;
  // Use canonical filenames, never a path supplied by the manifest. Examine
  // the latest candidate itself; an older intact copy must not hide its loss.
  result.integrityVerified=false;
  try {
    for(const [name,expected] of [['database.pgdump.aesgcm',manifest.encryptedSha256],
      ['roles.sql.aesgcm',manifest.rolesBackup?.encryptedSha256]]) {
      const file=path.join(path.dirname(newest.file),name);
      if(!/^[a-f0-9]{64}$/.test(expected || '')||!fs.lstatSync(file).isFile()) return result;
      const bytes=fs.readFileSync(file);
      if(!bytes.subarray(0,MAGIC.length).equals(MAGIC)||createHash('sha256').update(bytes).digest('hex')!==expected) return result;
      if(bytes.length<MAGIC.length+4) return result;
      const headerLength=bytes.readUInt32BE(MAGIC.length),headerEnd=MAGIC.length+4+headerLength;
      if(headerLength>10000||headerEnd>=bytes.length) return result;
      const header=JSON.parse(bytes.subarray(MAGIC.length+4,headerEnd).toString('utf8'));
      if(header.metadata?.projectRef!==manifest.projectRef) return result;
    }
    result.integrityVerified=true;
  } catch { /* unavailable or unreadable ciphertext is not a healthy backup */ }
  return result;
}

export function evaluateFreshness(newest, { maxHours, requireRestoreTest = false, now = Date.now() }) {
  if(!Number.isFinite(maxHours)||maxHours<=0||!Number.isFinite(now)) return {ok:false,reason:'invalid freshness limit or clock'};
  if (!newest) return { ok: false, reason: 'no verified backup found' };
  if(!Number.isFinite(newest.capturedAt)||newest.capturedAt>now+5*60_000) return {ok:false,reason:'backup timestamp is invalid or in the future'};
  if(newest.integrityVerified!==true) return {ok:false,reason:'newest backup ciphertext is missing, unreadable or corrupted'};
  const ageHours = Math.max(0,(now - newest.capturedAt) / 3_600_000);
  if (ageHours > maxHours) return { ok: false, reason: `newest backup is ${ageHours.toFixed(1)} h old (limit ${maxHours} h)`, ageHours };
  if (requireRestoreTest && !newest.restoreTestCompleted) return { ok: false, reason: 'newest backup was never restore-tested', ageHours };
  return { ok: true, ageHours };
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (direct) {
  const value = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const root = value('--root');
  if (!root) throw new Error('--root is required');
  const result = evaluateFreshness(newestBackup(path.resolve(root), {projectRef:value('--project-ref')}), {
    maxHours: Number(value('--max-hours') || 26), requireRestoreTest: process.argv.includes('--require-restore-test'),
  });
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}
