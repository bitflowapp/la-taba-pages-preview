export class BusinessPlatformAdapter {
  get isNative() { return false; }
  async initialize() {}
  async notify() { return false; }
  async setMuted() { return false; }
  async setAutostart() { return false; }
  async listPrinters() { return []; }
  async probePrinter() { return null; }
  async print() { throw new Error('La impresi\u00f3n nativa no est\u00e1 disponible.'); }
  async queueFiscalPrint() { throw new Error('La reimpresi\u00f3n fiscal durable requiere TABA para Windows.'); }
  async openFiscalCacheFolder() { throw new Error('La cach\u00e9 fiscal local requiere TABA para Windows.'); }
  async createLocalBackup() { throw new Error('El backup local requiere TABA para Windows.'); }
  async verifyLocalBackup() { throw new Error('La verificaci\u00f3n de backup requiere TABA para Windows.'); }
  async exportSupportDiagnostic() { throw new Error('El diagn\u00f3stico local requiere TABA para Windows.'); }
  async openSupportExportFolder() { throw new Error('Las exportaciones de soporte requieren TABA para Windows.'); }
  async checkForSignedUpdate() { return { configured: false, available: false }; }
  async installSignedUpdate() { throw new Error('El canal de actualizaciones firmadas no est\u00e1 disponible.'); }
  async savePackingCache() { throw new Error('La cach\u00e9 durable de packing no est\u00e1 disponible.'); }
  async loadPackingCache() { return null; }
  async deletePackingCache() { return false; }
  async exit() { return false; }
  async commandStorage() { throw new Error('No hay almacenamiento de comandos configurado.'); }
}
