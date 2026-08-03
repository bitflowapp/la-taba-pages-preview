import { BusinessPlatformAdapter } from './business-platform-adapter.js';
import { createIndexedDbCommandStorage, createIndexedDbPackingCache } from './indexeddb-command-storage.js';

export class BrowserBusinessPlatform extends BusinessPlatformAdapter {
  constructor(options = {}) { super(); this.options = options; this.storage = null; this.packing = null; }
  async notify({ title, body }) {
    if (!globalThis.Notification || Notification.permission !== 'granted') return false;
    new Notification(String(title || 'TABA Negocio'), { body: String(body || ''), tag: 'taba-business' });
    return true;
  }
  async commandStorage() {
    this.storage ||= createIndexedDbCommandStorage(this.options.indexedDb);
    return this.storage;
  }
  async packingCache() {
    this.packing ||= createIndexedDbPackingCache(this.options.indexedDb);
    return this.packing;
  }
  async savePackingCache(snapshot) { return (await this.packingCache()).save(snapshot); }
  async loadPackingCache(businessId) { return (await this.packingCache()).load(businessId); }
  async deletePackingCache(businessId) { return (await this.packingCache()).delete(businessId); }
}
