import { BusinessPlatformAdapter } from './business-platform-adapter.js';
import { createIndexedDbCommandStorage } from './indexeddb-command-storage.js';

export class BrowserBusinessPlatform extends BusinessPlatformAdapter {
  constructor(options = {}) { super(); this.options = options; this.storage = null; }
  async notify({ title, body }) {
    if (!globalThis.Notification || Notification.permission !== 'granted') return false;
    new Notification(String(title || 'TABA Negocio'), { body: String(body || ''), tag: 'taba-business' });
    return true;
  }
  async commandStorage() {
    this.storage ||= createIndexedDbCommandStorage(this.options.indexedDb);
    return this.storage;
  }
}
