import fs from 'node:fs';
import path from 'node:path';
import type { LoginTicket } from './types.js';

// El Ticket de Acceso es un secreto de corta vida y tiene que sobrevivir al
// reinicio del proceso: WSAA retiene el TA vigente y rechaza pedidos repetidos
// dentro de una ventana de retención (10 minutos en homologación, 2 en
// producción, "modificables sin aviso previo" según el manual del
// desarrollador). Un worker que reinicia y pide otro TA sin haber guardado el
// anterior queda bloqueado hasta que esa ventana venza.
export interface TicketStore {
  read(key: string): LoginTicket | null;
  write(key: string, ticket: LoginTicket): void;
  clear(): void;
}

export class MemoryTicketStore implements TicketStore {
  readonly #tickets = new Map<string, LoginTicket>();
  read(key: string): LoginTicket | null { return this.#tickets.get(key) || null; }
  write(key: string, ticket: LoginTicket): void { this.#tickets.set(key, ticket); }
  clear(): void { this.#tickets.clear(); }
}

export class FileTicketStore implements TicketStore {
  readonly #file: string;

  constructor(file: string) {
    if (!path.isAbsolute(file)) throw new Error('La ruta del ticket de acceso debe ser absoluta.');
    this.#file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  }

  read(key: string): LoginTicket | null {
    const ticket = this.#readAll()[key];
    if (!ticket || typeof ticket !== 'object') return null;
    const { token, sign, expirationTime, generationTime, service } = ticket as Record<string, unknown>;
    if (typeof token !== 'string' || typeof sign !== 'string' || typeof expirationTime !== 'string') return null;
    if (!token || !sign || !Number.isFinite(Date.parse(expirationTime))) return null;
    return Object.freeze({
      token,
      sign,
      expirationTime,
      generationTime: typeof generationTime === 'string' ? generationTime : '',
      service: typeof service === 'string' ? service : '',
    });
  }

  write(key: string, ticket: LoginTicket): void {
    const tickets = this.#readAll();
    tickets[key] = ticket;
    // Se escribe a un temporal y se renombra: un corte a mitad de escritura no
    // deja un archivo de estado corrupto que después no se pueda leer.
    const temporary = `${this.#file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(tickets), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.#file);
    try { fs.chmodSync(this.#file, 0o600); } catch { /* sistemas sin permisos POSIX */ }
  }

  clear(): void {
    try { fs.rmSync(this.#file, { force: true }); } catch { /* nada que borrar */ }
  }

  #readAll(): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.#file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      // Un estado ilegible no puede tumbar el worker: se trata como "sin ticket"
      // y el próximo login lo reescribe.
      return {};
    }
  }
}

export function ticketIsUsable(ticket: LoginTicket | null, now: Date, marginMs: number): boolean {
  if (!ticket) return false;
  const expiration = Date.parse(ticket.expirationTime);
  return Number.isFinite(expiration) && expiration - now.getTime() > marginMs;
}
