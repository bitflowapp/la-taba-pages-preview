// Panel › Impresora del local: el agente de impresión, visto desde el Panel.
// ---------------------------------------------------------------------------
// El agente de Windows (agents/windows-local-agent) reporta cada minuto si está
// vivo, qué impresoras ve y cuántos tickets tiene en cola. Las RPC ya existían
// (`get_local_print_status`, `create_local_device_pairing`,
// `revoke_local_device`, `configure_business_print_settings`); faltaba dónde
// mirarlas sin abrir la base.
//
// La impresora NO es requisito para abrir: sin agente, los pedidos se atienden
// igual desde el Panel. Esta pantalla sólo dice qué hay y cómo vincular la PC.
import { escapeHtml } from '../ui.js';
import { humanizeFailure } from './business-operation-language.js';

const AGENT_LABEL = Object.freeze({
  ONLINE: ['En línea', 'success', 'El agente está conectado y puede imprimir.'],
  OFFLINE: ['Sin conexión', 'danger', 'El agente no reporta hace más de dos minutos. Revisá que la PC del local esté prendida y con internet.'],
  NOT_REGISTERED: ['Sin vincular', 'warning', 'Todavía no hay ninguna PC vinculada. La impresión es opcional: los pedidos se atienden igual desde el Panel.'],
});

const PRINTER_STATUS = Object.freeze({
  READY: ['Lista', 'success'],
  OK: ['Lista', 'success'],
  ERROR: ['Con error', 'danger'],
  OFFLINE: ['Apagada o desconectada', 'danger'],
  PAPER_OUT: ['Sin papel', 'danger'],
  UNKNOWN: ['Sin dato', 'neutral'],
});

let printStatus = null;
let state = { phase: 'idle', message: '' };
let loadStarted = false;
let generation = 0;
let pairing = null;
let busy = false;

export function resetPrintAgent() {
  generation += 1;
  printStatus = null;
  state = { phase: 'idle', message: '' };
  loadStarted = false;
  pairing = null;
  busy = false;
}

export function activatePrintAgent(context) {
  if (loadStarted) return null;
  loadStarted = true;
  return refreshPrintAgent(context);
}

export async function refreshPrintAgent(context, message = '') {
  const current = generation;
  state = { phase: 'loading', message };
  context?.onChange?.();
  const response = typeof context?.getLocalPrintStatus === 'function' ? await context.getLocalPrintStatus() : { ok: false };
  if (current !== generation) return { ok: false, staleContext: true };
  if (response?.ok && response.data) {
    printStatus = response.data;
    state = { phase: 'ready', message };
  } else {
    state = { phase: 'error', message: humanizeFailure(response?.message, 'No pudimos leer el estado de la impresora.') };
  }
  context?.onChange?.();
  return response;
}

function done(ok, message) { return { handled: true, ok, message }; }

export async function handlePrintAgentAction(target, context) {
  if (!target?.closest) return null;
  const root = target.closest('[data-business-ops-center]');
  if (target.closest('[data-print-agent-refresh]')) {
    const response = await refreshPrintAgent(context);
    return done(Boolean(response?.ok), response?.ok ? 'Estado actualizado.' : state.message);
  }
  if (target.closest('[data-print-agent-pair]')) {
    if (busy) return done(false, 'Ya hay algo en curso.');
    const name = String(root?.querySelector('[name="printAgentDeviceName"]')?.value || '').trim();
    if (name.length < 1 || name.length > 80) return done(false, 'Poné un nombre para esta PC (por ejemplo, «Mostrador»).');
    busy = true;
    const response = await context.createLocalDevicePairing(name);
    busy = false;
    if (!response?.ok || !response.data?.pairing_code) {
      const message = humanizeFailure(response?.message, 'No se pudo generar el código.');
      state = { ...state, message };
      context?.onChange?.();
      return done(false, message);
    }
    pairing = { code: response.data.pairing_code, deviceName: response.data.device_name, expiresAt: response.data.expires_at };
    context?.onChange?.();
    return done(true, 'Código generado. Escribilo en el agente de la PC del local.');
  }
  if (target.closest('[data-print-agent-pairing-dismiss]')) {
    pairing = null;
    await refreshPrintAgent(context);
    return done(true, '');
  }
  const revoke = target.closest('[data-print-agent-revoke]');
  if (revoke) {
    if (busy) return done(false, 'Ya hay algo en curso.');
    const reason = String(revoke.closest('[data-print-agent-device]')?.querySelector('[name="printAgentRevokeReason"]')?.value || '').trim();
    if (reason.length < 3) return done(false, 'Contá en pocas palabras por qué se desvincula esta PC.');
    busy = true;
    const response = await context.revokeLocalDevice({ deviceId: revoke.dataset.printAgentRevoke, reason });
    busy = false;
    const message = response?.ok ? 'PC desvinculada: ya no puede imprimir ni pedir tickets.' : humanizeFailure(response?.message, 'No se pudo desvincular.');
    await refreshPrintAgent(context, message);
    return done(Boolean(response?.ok), message);
  }
  const auto = target.closest('[data-print-agent-auto]');
  if (auto) {
    if (busy) return done(false, 'Ya hay algo en curso.');
    const enabled = auto.dataset.printAgentAuto === 'true';
    busy = true;
    const response = await context.configurePrintSettings({ auto_print_enabled: enabled });
    busy = false;
    const message = response?.ok
      ? (enabled ? 'Impresión automática activada: cada pedido nuevo sale en papel.' : 'Impresión automática desactivada.')
      : humanizeFailure(response?.message, 'No se pudo cambiar la impresión automática.');
    await refreshPrintAgent(context, message);
    return done(Boolean(response?.ok), message);
  }
  return null;
}

export function renderPrintAgentSurface({ role = '', data = printStatus, status = state, code = pairing, downloadUrl = '' } = {}) {
  const elevated = ['owner', 'admin'].includes(String(role));
  const header = `<header><div><p class="eyebrow">Panel del negocio</p><h2>Impresora del local</h2>
    <p>El agente de impresión de la PC del local. Es opcional: sin impresora, los pedidos se atienden igual.</p></div></header>`;
  if (!data) {
    return `<section class="business-ops-panel business-print-agent">${header}
      ${status.phase === 'error' ? `<p class="production-intake-error" role="alert">${escapeHtml(status.message)}</p>` : '<p class="form-hint" aria-live="polite">Leyendo el estado de la impresora…</p>'}
      <div class="button-row"><button class="secondary-button compact" type="button" data-print-agent-refresh>Reintentar</button></div>
    </section>`;
  }
  const agent = AGENT_LABEL[data.agent] || AGENT_LABEL.NOT_REGISTERED;
  const queue = data.queue || {};
  const devices = Array.isArray(data.devices) ? data.devices : [];
  const auto = data.settings?.auto_print_enabled === true;
  return `<section class="business-ops-panel business-print-agent">${header}
    ${status.message ? `<p class="business-ops-feedback" role="status">${escapeHtml(status.message)}</p>` : ''}
    <div class="operation-summary tone-${agent[1] === 'success' ? 'calm' : 'attention'}" role="status" data-print-agent-state="${escapeHtml(String(data.agent || 'NOT_REGISTERED'))}">
      <strong>Agente: ${escapeHtml(agent[0])}</strong><span>${escapeHtml(agent[2])}</span>
    </div>
    <div class="closure-grid">
      <article class="closure-section"><span>En cola</span><strong>${Number(queue.queued || 0)}</strong></article>
      <article class="closure-section"><span>Imprimiendo</span><strong>${Number(queue.in_flight || 0)}</strong></article>
      <article class="closure-section tone-${Number(queue.needs_review || 0) ? 'attention' : 'calm'}"><span>Para revisar</span><strong>${Number(queue.needs_review || 0)}</strong></article>
      <article class="closure-section tone-${Number(queue.failed_24h || 0) ? 'attention' : 'calm'}"><span>Fallidos (24 h)</span><strong>${Number(queue.failed_24h || 0)}</strong></article>
    </div>
    <section class="business-config-block">
      <h3>PCs vinculadas</h3>
      ${devices.length ? devices.map((device) => renderDevice(device, elevated)).join('') : '<p class="form-hint">Ninguna todavía.</p>'}
    </section>
    <section class="business-config-block">
      <h3>Impresión automática</h3>
      <p class="form-hint">Encendida, cada pedido nuevo sale en papel sin tocar nada. Apagada, se imprime a pedido.</p>
      <p><strong>${auto ? 'Encendida' : 'Apagada'}</strong></p>
      ${elevated ? `<button class="secondary-button compact" type="button" data-print-agent-auto="${auto ? 'false' : 'true'}">${auto ? 'Apagar' : 'Encender'}</button>` : ''}
    </section>
    ${elevated ? renderPairing(code) : ''}
    <section class="business-config-block">
      <h3>Instalar el agente</h3>
      <p class="form-hint">El instalador para Windows es de uso interno y todavía no tiene firma digital: Windows va a pedir confirmación al instalarlo. Instalalo sólo desde el link que te pasa La Taba.</p>
      ${downloadUrl ? `<a class="secondary-button compact" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener noreferrer">Descargar instalador (interno)</a>` : ''}
    </section>
    <div class="button-row"><button class="secondary-button compact" type="button" data-print-agent-refresh>Actualizar</button></div>
  </section>`;
}

function renderPairing(code) {
  if (code) {
    return `<section class="business-config-block team-invite-link" role="status" data-print-agent-pairing>
      <h3>Código para «${escapeHtml(code.deviceName)}»</h3>
      <p class="print-agent-code">${escapeHtml(code.code)}</p>
      <p class="form-hint">En la PC del local abrí el agente de La Taba y escribí este código. Sirve una vez y vence a los 15 minutos.</p>
      <button class="ghost-button compact" type="button" data-print-agent-pairing-dismiss>Listo</button>
    </section>`;
  }
  return `<section class="business-config-block">
    <h3>Vincular una PC</h3>
    <div class="catalog-form-grid"><label>Nombre de la PC<input type="text" name="printAgentDeviceName" maxlength="80" placeholder="Mostrador" autocomplete="off"></label></div>
    <button class="primary-button compact" type="button" data-print-agent-pair>Generar código</button>
  </section>`;
}

function renderDevice(device, elevated) {
  const printers = Array.isArray(device.printers) ? device.printers : [];
  const online = device.agent === 'ONLINE';
  return `<article class="access-request-card tone-${online ? 'success' : device.status === 'revoked' ? 'danger' : 'warning'}" data-print-agent-device="${escapeHtml(device.id)}">
    <header><div><strong>${escapeHtml(device.name || 'PC')}</strong>
      <span class="access-request-kind">${device.status === 'revoked' ? 'Desvinculada' : online ? 'En línea' : 'Sin conexión'}${device.agent_version ? ` · versión ${escapeHtml(device.agent_version)}` : ''}</span></div></header>
    ${printers.length ? `<ul class="print-agent-printers">${printers.map((printer) => {
      const [label, tone] = PRINTER_STATUS[String(printer?.status || 'UNKNOWN').toUpperCase()] || PRINTER_STATUS.UNKNOWN;
      return `<li><span>${escapeHtml(printer?.name || 'Impresora')}</span> <span class="status-pill ${tone}">${label}</span></li>`;
    }).join('')}</ul>` : '<p class="form-hint">Sin impresoras reportadas.</p>'}
    ${elevated && device.status === 'active' ? `<div class="access-request-actions">
      <label class="access-request-role">Motivo para desvincular<input type="text" name="printAgentRevokeReason" maxlength="300" autocomplete="off"></label>
      <button class="ghost-button" type="button" data-print-agent-revoke="${escapeHtml(device.id)}">Desvincular</button>
    </div>` : ''}
  </article>`;
}
