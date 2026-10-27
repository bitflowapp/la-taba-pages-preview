// Console input without echo, split from the terminal so the keyboard rules can be tested without a terminal.
//
// Why this exists: the first version of guardar-vendedor-b.mjs read raw keystrokes and treated every byte as part of
// the value. A pasted id ends with CR+LF; the LF stayed in the buffer and was delivered to the NEXT prompt as an
// immediate Enter, so the (hidden) nickname came back empty and failed the format check without saying why. Ctrl+V,
// arrow keys and bracketed-paste markers were also taken as text. Nothing here ever prints a typed value.
import { spawnSync } from 'node:child_process';

const ESC = '\u001b';
// CSI sequences (arrows, bracketed paste markers), SS3 (application cursor keys) and two-character escapes.
const ESCAPE_SEQUENCE = /^\u001b(?:\[[0-?]*[ -/]*[@-~]|O[@-~]|[@-Z\\-_])/;
const INVISIBLE = /[​-‏⁠﻿]/;

export function nuevoEstado({ saltarLF = false } = {}) {
  return { texto: '', terminado: false, cancelado: false, pegar: false, saltarLF };
}

/** Feeds what the terminal delivered into `estado`. Returns the same object. Never touches the terminal. */
export function procesar(estado, entrada) {
  const s = String(entrada);
  let i = 0;
  while (i < s.length && !estado.terminado) {
    const c = s[i];
    if (c === ESC) {
      const m = ESCAPE_SEQUENCE.exec(s.slice(i));
      i += m ? m[0].length : 1;
      continue;
    }
    i += 1;
    if (c === '\r') { estado.terminado = true; estado.saltarLF = true; continue; }
    if (c === '\n') {
      if (estado.saltarLF) { estado.saltarLF = false; continue; }
      estado.terminado = true;
      continue;
    }
    estado.saltarLF = false;
    if (c === '\u0003' || c === '\u0004') { estado.cancelado = true; estado.terminado = true; continue; }
    if (c === '\u007f' || c === '\b') { estado.texto = Array.from(estado.texto).slice(0, -1).join(''); continue; }
    if (c === '\u0015') { estado.texto = ''; continue; }
    if (c === '\u0016') { estado.pegar = true; continue; }
    if (c === ' ') { estado.texto += ' '; continue; }
    if (INVISIBLE.test(c)) continue;
    if (c < ' ' || (c >= '\u007f' && c <= '\u009f')) continue;
    estado.texto += c;
  }
  return estado;
}

/** Counts by class, for messages that must not repeat the value. */
export function describirTexto(texto) {
  const t = String(texto);
  const cuenta = { longitud: Array.from(t).length, letras: 0, digitos: 0, espacios: 0, controles: 0, otros: 0 };
  for (const c of t) {
    if (/[A-Za-z]/.test(c)) cuenta.letras += 1;
    else if (/[0-9]/.test(c)) cuenta.digitos += 1;
    else if (/\s/.test(c)) cuenta.espacios += 1;
    else if (c < ' ' || (c >= '\u007f' && c <= '\u009f')) cuenta.controles += 1;
    else cuenta.otros += 1;
  }
  return cuenta;
}
const resumen = (t) => {
  const d = describirTexto(t);
  return `${d.longitud} caracteres: ${d.letras} letras, ${d.digitos} dígitos, ${d.espacios} espacios, ${d.controles} de control, ${d.otros} otros`;
};

export function validarId(texto) {
  const t = String(texto).trim();
  if (/^\d{8,12}$/.test(t)) return { ok: true, valor: t };
  return { ok: false, motivo: `el id debe ser numérico de 8 a 12 dígitos (recibí ${resumen(t)})` };
}

// Same alphabet guardarSecreto() accepts for the credential's user name, without spaces.
export function validarUsuario(texto) {
  const t = String(texto).trim();
  if (/^[A-Za-z0-9._@+-]{3,80}$/.test(t)) return { ok: true, valor: t };
  return { ok: false, motivo: `el usuario admite letras, números y . _ @ + - (3 a 80); recibí ${resumen(t)}` };
}

export function validarClave(texto) {
  const t = String(texto);
  const d = describirTexto(t);
  if (d.longitud < 4) return { ok: false, motivo: `la contraseña está vacía o es demasiado corta (${d.longitud} caracteres)` };
  if (d.controles) return { ok: false, motivo: 'la contraseña tiene caracteres de control' };
  if (d.longitud > 200) return { ok: false, motivo: `la contraseña es demasiado larga (${d.longitud} caracteres)` };
  return { ok: true, valor: t };
}

/** First line of the Windows clipboard, for Ctrl+V when the terminal does not paste by itself. Never logged. */
export function leerPortapapeles() {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (r.status !== 0) return '';
  return String(r.stdout || '').split(/\r?\n/)[0];
}

/**
 * Asks one question. `oculto` prints nothing for typed characters. Returns { valor, cancelado, saltarLF } where
 * `saltarLF` must be handed to the next prompt so a CR+LF paste does not answer it.
 */
export function pedir(pregunta, { oculto = false, entrada = process.stdin, salida = process.stdout, saltarLF = false,
  portapapeles = leerPortapapeles } = {}) {
  return new Promise((resolve, reject) => {
    if (!entrada.isTTY) return reject(new Error('Hace falta una terminal interactiva (abrí una ventana de PowerShell).'));
    const estado = nuevoEstado({ saltarLF });
    salida.write(pregunta);
    entrada.setRawMode(true);
    entrada.resume();
    if (typeof entrada.setEncoding === 'function') entrada.setEncoding('utf8');
    const terminar = () => {
      entrada.setRawMode(false);
      entrada.pause();
      entrada.removeListener('data', alRecibir);
      salida.write('\n');
      resolve({ valor: estado.texto, cancelado: estado.cancelado, saltarLF: estado.saltarLF });
    };
    const alRecibir = (chunk) => {
      const antes = estado.texto;
      procesar(estado, chunk);
      if (estado.pegar && !estado.terminado) {
        estado.pegar = false;
        procesar(estado, portapapeles() || '');
      }
      // Every answer is required, so an Enter on an empty answer is a stray one (a pasted line break, a double tap):
      // keep waiting instead of failing. Ctrl+C is the way out.
      if (estado.terminado && !estado.cancelado && estado.texto === '') estado.terminado = false;
      if (!oculto) {
        // Echo only what was added or removed in this chunk (also when the same chunk carries the Enter).
        if (estado.texto.startsWith(antes)) salida.write(estado.texto.slice(antes.length));
        else salida.write(`\r${pregunta}${estado.texto}`);
      }
      if (estado.terminado) terminar();
    };
    entrada.on('data', alRecibir);
  });
}
