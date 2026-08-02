import { connectivityLabel } from './business-connectivity.js';

export function buildBusinessRuntimeViewModel({ connectivity = {}, commands = [], muted = false } = {}) {
  const active = commands.filter((command) => ['pending', 'sending'].includes(command.state));
  const conflicted = commands.filter((command) => command.state === 'conflicted');
  const failed = commands.filter((command) => command.state === 'failed');
  return Object.freeze({
    connectionLabel: connectivityLabel(connectivity),
    connectionState: connectivity.state || 'reconnecting',
    lastReconciledAt: connectivity.lastReconciledAt || null,
    pendingCount: active.length,
    conflictCount: conflicted.length,
    failedCount: failed.length,
    muted: Boolean(muted),
    attentionRequired: conflicted.length + failed.length,
  });
}
