/*
 * DÓNDE VIVEN LAS CONTRASEÑAS DE LA AUTOMATIZACIÓN.
 *
 * En el Credential Manager de Windows, que es el almacén del sistema operativo
 * para esto. Nunca en el repositorio, nunca en un `.env`, nunca en un archivo
 * temporal, nunca en un argumento de línea de comandos.
 *
 * LO DE LOS ARGUMENTOS NO ES PARANOIA. `cmdkey /generic:X /pass:Y` es la forma
 * corta de escribir una credencial en Windows, y mientras ese proceso vive
 * cualquier usuario de la máquina puede leer su línea de comandos entera —con
 * la contraseña adentro— desde el administrador de tareas o con un WMI de una
 * línea. Por eso acá el secreto viaja por ENTRADA ESTÁNDAR: el proceso hijo lo
 * lee de un tubo que nadie más ve.
 *
 * Este módulo es la mitad que faltaba de `scripts/lib/supabase-cli-token.mjs`:
 * aquél sabía LEER la credencial que el CLI de Supabase deja puesta; acá se
 * puede además escribir y borrar, para las identidades que esta automatización
 * crea y administra por su cuenta.
 *
 * REGLA QUE NO SE NEGOCIA: ninguna función de este archivo imprime un secreto,
 * ni entero, ni truncado, ni por accidente dentro de un mensaje de error. Lo
 * que se devuelve a quien llama es el valor; lo que se muestra es «sí» o «no».
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/** Prefijo de todos los objetivos que administra esta automatización. */
export const PREFIJO = 'TABA2 E2E';

export class SecretoNoDisponible extends Error {}

const soloWindows = () => {
  if (process.platform !== 'win32') {
    throw new SecretoNoDisponible('el almacén de credenciales de Windows sólo existe en Windows');
  }
};

/*
 * La declaración de las cuatro funciones de `advapi32` que hacen falta. Se
 * escribe una sola vez y se antepone a cada guion: `Add-Type` compila dentro
 * del proceso hijo, así que no queda nada en disco.
 */
const COMILLA = String.fromCharCode(39);
const DECLARACION = [
  `Add-Type -Namespace "" -Name TabaCred -MemberDefinition ${COMILLA}`,
  '[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]',
  ' public static extern bool CredRead(string t, uint y, uint f, out IntPtr c);',
  ' [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]',
  ' public static extern bool CredWrite(ref CREDENTIAL c, uint f);',
  ' [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]',
  ' public static extern bool CredDelete(string t, uint y, uint f);',
  ' [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr b);',
  ' [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {',
  ' public uint Flags; public uint Type; public string TargetName; public string Comment;',
  ' public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;',
  ' public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;',
  ' public uint AttributeCount; public IntPtr Attributes; public string TargetAlias;',
  ` public string UserName; }${COMILLA}; `,
].join('');

/** Ejecuta un guion de PowerShell pasándole `entrada` por stdin. */
function powershell(guion, entrada = '') {
  soloWindows();
  return execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${DECLARACION}${guion}`],
    { encoding: 'utf8', input: entrada, stdio: ['pipe', 'pipe', 'ignore'] },
  );
}

/**
 * Valida y completa el nombre del objetivo.
 *
 * El nombre entra en un guion de PowerShell entre comillas, así que se acota a
 * un alfabeto sin comillas, sin `$` y sin backtick: cualquier cosa que pudiera
 * cerrar la cadena o interpolar queda afuera antes de llegar al intérprete.
 */
export function objetivoCompleto(nombre) {
  const limpio = String(nombre || '').trim();
  if (!/^[A-Za-z0-9 :._-]{3,80}$/.test(limpio)) {
    throw new SecretoNoDisponible(`nombre de credencial inválido: «${limpio}»`);
  }
  return limpio.startsWith(`${PREFIJO}:`) ? limpio : `${PREFIJO}:${limpio}`;
}

/**
 * Lee un secreto. Devuelve `null` si no existe —que no es un error: la primera
 * corrida en una máquina nueva encuentra el almacén vacío y tiene que poder
 * decirlo sin romperse.
 */
export function leerSecreto(nombre) {
  const objetivo = objetivoCompleto(nombre);
  let salida = '';
  try {
    salida = powershell([
      '$p=[IntPtr]::Zero; ',
      `if (-not [TabaCred]::CredRead("${objetivo}",1,0,[ref]$p)) { exit 3 }; `,
      '$c=[System.Runtime.InteropServices.Marshal]::PtrToStructure($p,[type][TabaCred+CREDENTIAL]); ',
      '$b=New-Object byte[] $c.CredentialBlobSize; ',
      '[System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$b,0,$c.CredentialBlobSize); ',
      '$u=$c.UserName; ',
      '[TabaCred]::CredFree($p); ',
      '[Console]::Out.Write($u); [Console]::Out.Write([char]10); ',
      '[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($b).Trim([char]0))',
    ].join(''));
  } catch {
    return null;
  }
  const corte = salida.indexOf('\n');
  if (corte === -1) return null;
  return {
    usuario: salida.slice(0, corte).trim(),
    secreto: salida.slice(corte + 1),
  };
}

export const existeSecreto = (nombre) => leerSecreto(nombre) !== null;

/**
 * Guarda un secreto. El valor entra por stdin y no aparece en ningún lugar que
 * otro proceso de la máquina pueda mirar.
 *
 * `Persist = 2` es CRED_PERSIST_LOCAL_MACHINE: sobrevive al cierre de sesión,
 * que es lo que hace falta para que una corrida programada encuentre la
 * credencial sin que nadie la vuelva a escribir.
 */
export function guardarSecreto(nombre, usuario, secreto) {
  const objetivo = objetivoCompleto(nombre);
  if (!secreto || typeof secreto !== 'string') throw new SecretoNoDisponible('no hay secreto para guardar');
  const nombreUsuario = String(usuario || 'e2e');
  if (!/^[A-Za-z0-9 @:._+-]{1,120}$/.test(nombreUsuario)) {
    throw new SecretoNoDisponible('nombre de usuario de la credencial inválido');
  }
  const salida = powershell([
    '$s=[Console]::In.ReadToEnd(); ',
    '$b=[System.Text.Encoding]::UTF8.GetBytes($s); ',
    '$m=[System.Runtime.InteropServices.Marshal]::AllocHGlobal($b.Length); ',
    '[System.Runtime.InteropServices.Marshal]::Copy($b,0,$m,$b.Length); ',
    '$c=New-Object TabaCred+CREDENTIAL; ',
    '$c.Type=1; ',
    `$c.TargetName="${objetivo}"; `,
    `$c.UserName="${nombreUsuario}"; `,
    '$c.CredentialBlobSize=$b.Length; $c.CredentialBlob=$m; $c.Persist=2; ',
    '$ok=[TabaCred]::CredWrite([ref]$c,0); ',
    '[System.Runtime.InteropServices.Marshal]::FreeHGlobal($m); ',
    'if (-not $ok) { exit 4 }; [Console]::Out.Write("guardada")',
  ].join(''), secreto);
  if (!salida.includes('guardada')) throw new SecretoNoDisponible(`no se pudo guardar «${objetivo}»`);
  return { objetivo, usuario: nombreUsuario };
}

export function borrarSecreto(nombre) {
  const objetivo = objetivoCompleto(nombre);
  try {
    powershell(`if (-not [TabaCred]::CredDelete("${objetivo}",1,0)) { exit 3 }; [Console]::Out.Write("borrada")`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Una contraseña que ninguna persona tiene que recordar ni escribir.
 *
 * El proyecto de Auth exige 12 caracteres (`password_min_length`); acá se
 * generan 32 con entropía criptográfica, sobre un alfabeto sin comillas ni
 * caracteres que PowerShell interprete —el valor viaja por stdin y un `$` o un
 * backtick suelto ahí es un problema que no hace falta tener—.
 */
export function generarContrasena(largo = 32) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.';
  const limite = 256 - (256 % alfabeto.length);
  let salida = '';
  while (salida.length < largo) {
    const bytes = randomBytes(largo * 2);
    for (let i = 0; salida.length < largo && i < bytes.length; i += 1) {
      // Rechazo del sesgo por módulo: se descartan los bytes que no entran justos.
      if (bytes[i] < limite) salida += alfabeto[bytes[i] % alfabeto.length];
    }
  }
  return salida;
}
