import { connectivityLabel } from './business-connectivity.js';

export function buildBusinessRuntimeViewModel({ connectivity = {}, commands = [], muted = false } = {}) {
  const active = commands.filter((command) => ['pending', 'sending'].includes(command.state));
  const conflicted = commands.filter((command) => command.state === 'conflicted');
  const failed = commands.filter((command) => command.state === 'failed');
  // "Reconectando" con la cola vacía es una promesa de trabajo que no existe:
  // sin comandos pendientes ni reconciliación previa, lo honesto es decir que
  // no hay nada que sincronizar todavía.
  const idleWithoutEvidence = connectivity.state === 'reconnecting'
    && active.length === 0
    && !connectivity.lastReconciledAt;
  return Object.freeze({
    connectionLabel: idleWithoutEvidence ? 'Sin comandos pendientes' : connectivityLabel(connectivity),
    connectionState: connectivity.state || 'reconnecting',
    lastReconciledAt: connectivity.lastReconciledAt || null,
    pendingCount: active.length,
    conflictCount: conflicted.length,
    failedCount: failed.length,
    muted: Boolean(muted),
    attentionRequired: conflicted.length + failed.length,
  });
}
