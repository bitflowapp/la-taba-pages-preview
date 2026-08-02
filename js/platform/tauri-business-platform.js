import { BusinessPlatformAdapter } from './business-platform-adapter.js';
import { BrowserBusinessPlatform } from './browser-business-platform.js';

export class TauriBusinessPlatform extends BusinessPlatformAdapter {
  constructor(invoke = globalThis.__TAURI__?.core?.invoke) { super(); this.invoke = invoke; }
  assertAvailable() { if (typeof this.invoke !== 'function') throw new Error('El bridge Tauri no est\u00e1 disponible.'); }
  async initialize() { this.assertAvailable(); return this.invoke('initialize_business_runtime'); }
  async notify(payload) { this.assertAvailable(); return this.invoke('notify_business_event', { payload }); }
  async setMuted(muted) { this.assertAvailable(); return this.invoke('set_notifications_muted', { muted: Boolean(muted) }); }
  async setAutostart(enabled) { this.assertAvailable(); return this.invoke('set_autostart_enabled', { enabled: Boolean(enabled) }); }
  async listPrinters() { this.assertAvailable(); return this.invoke('list_printers'); }
  async print(request) { this.assertAvailable(); return this.invoke('print_document', { request }); }
  async exit() { this.assertAvailable(); return this.invoke('exit_application'); }
  async commandStorage() {
    this.assertAvailable();
    const invoke = this.invoke;
    return Object.freeze({
      put: (command) => invoke('outbox_put', { command }),
      get: (commandId) => invoke('outbox_get', { commandId }),
      list: () => invoke('outbox_list'),
      findByIdempotencyKey: (idempotencyKey) => invoke('outbox_find_by_idempotency_key', { idempotencyKey }),
      deleteWhere: () => Promise.reject(new Error('El archivo de confirmados se ejecuta mediante mantenimiento nativo.')),
    });
  }
}

export function createBusinessPlatform() {
  return typeof globalThis.__TAURI__?.core?.invoke === 'function'
    ? new TauriBusinessPlatform()
    : new BrowserBusinessPlatform();
}
