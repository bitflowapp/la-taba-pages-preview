/*
 * El token del CLI de Supabase, leído de donde el CLI lo guarda.
 *
 * POR QUÉ EXISTE
 * --------------
 * Todos los guiones que hablan con la Management API piden
 * `SUPABASE_ACCESS_TOKEN` en el entorno, y hasta ahora cada uno resolvía por su
 * cuenta de dónde sacarlo: `set-pickup-point.mjs` trae su propia copia del
 * lector, pegada adentro del archivo. Una credencial leída en tres lugares
 * distintos se endurece en uno solo y se olvida en los otros dos.
 *
 * Acá vive una sola vez, con las reglas escritas al lado del código.
 *
 * LAS REGLAS, que no se negocian
 * ------------------------------
 *   · el valor se inyecta SÓLO al entorno del proceso que lo necesita;
 *   · nunca se imprime, ni entero ni truncado;
 *   · nunca viaja como argumento de línea de comandos —los argumentos se ven en
 *     la lista de procesos de cualquier usuario de la máquina—;
 *   · nunca se escribe a disco: ni artefacto, ni log, ni archivo temporal;
 *   · nunca entra al repositorio;
 *   · se borra del entorno al terminar.
 *
 * `conToken()` implementa las seis: recibe una función, le presta el token por
 * el entorno mientras corre, y lo borra en el `finally` —también si la función
 * lanza—.
 *
 * DÓNDE VIVE EL TOKEN
 * -------------------
 * En Windows, el CLI lo guarda en el Credential Manager bajo
 * `LegacyGeneric:target=Supabase CLI:supabase`. Se lee con `CredRead` de
 * `advapi32`, que es la API del sistema para eso; `cmdkey /list` confirma que
 * la entrada existe sin exponer el valor.
 *
 * Si ya hay `SUPABASE_ACCESS_TOKEN` en el entorno, se respeta y no se toca el
 * almacén: quien opera puede traer el suyo.
 */
import { execFileSync } from 'node:child_process';

const OBJETIVO = 'Supabase CLI:supabase';

const LECTOR_POWERSHELL = [
  'Add-Type -Namespace "" -Name TabaCredLib -MemberDefinition \'',
  '[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]',
  ' public static extern bool CredRead(string t, uint y, uint f, out IntPtr c);',
  ' [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr b);',
  ' [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {',
  ' public uint Flags; public uint Type; public string TargetName; public string Comment;',
  ' public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;',
  ' public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;',
  ' public uint AttributeCount; public IntPtr Attributes; public string TargetAlias;',
  ' public string UserName; }\'; ',
  '$p=[IntPtr]::Zero; ',
  `if (-not [TabaCredLib]::CredRead("${OBJETIVO}",1,0,[ref]$p)) { exit 3 }; `,
  '$c=[System.Runtime.InteropServices.Marshal]::PtrToStructure($p,[type][TabaCredLib+CREDENTIAL]); ',
  '$b=New-Object byte[] $c.CredentialBlobSize; ',
  '[System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$b,0,$c.CredentialBlobSize); ',
  '[TabaCredLib]::CredFree($p); ',
  '[System.Text.Encoding]::UTF8.GetString($b).Trim([char]0)',
].join('');

/**
 * Devuelve el token. No lo imprime y no lo guarda en ningún lado.
 * Lanza si no está: fallar es preferible a seguir sin credencial y confundir
 * un 401 con un problema de datos.
 */
export function leerTokenDelCli() {
  const delEntorno = process.env.SUPABASE_ACCESS_TOKEN;
  if (delEntorno) return delEntorno;
  if (process.platform !== 'win32') {
    throw new Error('Fuera de Windows el token tiene que venir en SUPABASE_ACCESS_TOKEN.');
  }
  let valor = '';
  try {
    valor = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', LECTOR_POWERSHELL],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    throw new Error(`No hay credencial guardada bajo «${OBJETIVO}». Corré: supabase login`);
  }
  if (!valor) throw new Error(`La credencial «${OBJETIVO}» existe pero vino vacía.`);
  return valor;
}

/**
 * Presta el token por el entorno mientras corre `tarea`, y lo borra después.
 *
 * El `finally` es la parte importante: si la tarea lanza, el token se borra
 * igual. Y se restaura lo que hubiera antes, para no pisarle el entorno a quien
 * ya traía el suyo.
 */
export async function conToken(tarea) {
  const previo = process.env.SUPABASE_ACCESS_TOKEN;
  const token = leerTokenDelCli();
  process.env.SUPABASE_ACCESS_TOKEN = token;
  try {
    return await tarea(token);
  } finally {
    if (previo === undefined) delete process.env.SUPABASE_ACCESS_TOKEN;
    else process.env.SUPABASE_ACCESS_TOKEN = previo;
  }
}
