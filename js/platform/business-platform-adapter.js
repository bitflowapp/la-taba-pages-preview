export class BusinessPlatformAdapter {
  async initialize() {}
  async notify() { return false; }
  async setMuted() { return false; }
  async setAutostart() { return false; }
  async listPrinters() { return []; }
  async print() { throw new Error('La impresi\u00f3n nativa no est\u00e1 disponible.'); }
  async exit() { return false; }
  async commandStorage() { throw new Error('No hay almacenamiento de comandos configurado.'); }
}
