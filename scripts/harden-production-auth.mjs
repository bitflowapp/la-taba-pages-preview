// Lo unico del Auth productivo que se puede cerrar sin dominio y sin proveedor.
//
// `production-auth-posture.mjs` MIDE. Esto ESCRIBE, y por eso pide autorizacion
// explicita en vez de correr solo:
//
//   $env:TABA2_PRODUCTION_AUTH_HARDENING = "I_AUTHORIZE_TABA2_PRODUCTION_AUTH_HARDENING"
//   $env:SUPABASE_ACCESS_TOKEN = <token del CLI>
//   node scripts/harden-production-auth.mjs --ref wwcpogltfgzgkrlilbcd
//
// Sin `--apply` no escribe: imprime lo que cambiaria y sale 0.
//
// ## Que cambia, y por que solo esto
//
//   password_hibp_enabled: false -> true
//
// Rechaza contrasenas que aparecen en brechas publicas conocidas. Es un toggle
// nativo de Supabase —no hay proveedor que contratar ni credencial que
// inventar— y afecta a las cuentas del Panel y del Rider, que son las unicas
// que usan contrasena. Con `auth.users` en cero no puede dejar afuera a nadie:
// solo se aplica al crear o cambiar una contrasena.
//
// ## Que NO cambia, y por que
//
//   site_url            necesita un host productivo que todavia no existe.
//                       Ponerle el de staging mezclaria los entornos, y
//                       cualquier otro seria inventar un dominio.
//   uri_allow_list      ya esta vacia, que es el minimo privilegio posible
//                       mientras no haya host. Agregarle algo hoy seria abrir.
//   captcha             exige una cuenta de hCaptcha o Turnstile que no existe.
//   disable_signup      cerrarlo apaga el Customer: el ingreso anonimo pasa por
//                       el mismo /signup. Lo que lo hace inerte es que crear
//                       identidad no reparte rol.
//   sessions_timebox    caducar sesiones es una decision de producto: le pega
//   sessions_inactivity al Customer anonimo igual que al Panel, y hoy nadie
//                       decidio cuanto dura un turno en el local.
//   smtp                recuperar contrasena por correo necesita un proveedor.
//
// Salida 0 = aplicado o nada que hacer. 1 = no se pudo. 2 = falta autorizacion.

import process from 'node:process';

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const APPROVAL = 'I_AUTHORIZE_TABA2_PRODUCTION_AUTH_HARDENING';

// Lo que este guion sabe cambiar. Una sola clave: si manana hay otra, se agrega
// aca con su razon, y no por una bandera generica que acepte cualquier campo.
const CAMBIOS = {
  password_hibp_enabled: {
    deseado: true,
    porque: 'rechaza contrasenas filtradas en brechas conocidas; sin proveedor externo',
  },
};

// Campos que NO se tocan y que ademas se comparan antes y despues: si el PATCH
// mueve alguno, se reporta. Un cambio parcial que arrastra otra cosa es
// exactamente el accidente que hay que poder ver.
const VIGILADOS = [
  'site_url', 'uri_allow_list', 'disable_signup', 'external_anonymous_users_enabled',
  'external_email_enabled', 'mailer_autoconfirm', 'password_min_length', 'jwt_exp',
  'refresh_token_rotation_enabled', 'security_refresh_token_reuse_interval',
  'security_captcha_enabled', 'rate_limit_anonymous_users', 'rate_limit_verify',
  'rate_limit_otp', 'rate_limit_token_refresh', 'rate_limit_email_sent',
  'sessions_timebox', 'sessions_inactivity_timeout', 'mfa_totp_enroll_enabled',
  'security_update_password_require_reauthentication',
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ref = (arg('ref') || '').trim();
if (ref !== PRODUCTION_REF) {
  console.error(`--ref debe ser ${PRODUCTION_REF}; no hay default implicito`);
  process.exit(2);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('falta SUPABASE_ACCESS_TOKEN en el entorno');
  process.exit(2);
}

const aplicar = process.argv.includes('--apply');
if (aplicar && process.env.TABA2_PRODUCTION_AUTH_HARDENING !== APPROVAL) {
  console.error(`--apply exige TABA2_PRODUCTION_AUTH_HARDENING = ${APPROVAL}`);
  process.exit(2);
}

async function leer() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const antes = await leer();

const pendientes = Object.entries(CAMBIOS)
  .filter(([clave, { deseado }]) => antes[clave] !== deseado);

console.log(`--- ENDURECIMIENTO DE AUTH (${ref}) ---`);
for (const [clave, { deseado, porque }] of Object.entries(CAMBIOS)) {
  const actual = antes[clave];
  const estado = actual === deseado ? 'ya esta' : `${actual} -> ${deseado}`;
  console.log(`  ${clave.padEnd(24)} ${estado.padEnd(18)} ${porque}`);
}

// `process.exitCode` en vez de `process.exit()`: en Windows, salir con una
// conexion keep-alive todavia abierta dispara una asercion de libuv y devuelve 9
// en vez del codigo pedido, que es justo lo que un gate no puede permitirse.
if (!pendientes.length) {
  console.log('\n  nada que cambiar');
} else if (!aplicar) {
  console.log(`\n  ${pendientes.length} cambio(s) pendiente(s). Correr con --apply y la autorizacion para escribir.`);
} else {
  const cuerpo = Object.fromEntries(pendientes.map(([clave, { deseado }]) => [clave, deseado]));
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) {
    console.error(`  PATCH fallo: ${r.status} ${(await r.text()).slice(0, 300)}`);
    process.exitCode = 1;
  } else {
    const despues = await leer();
    const sinAplicar = pendientes.filter(([clave, { deseado }]) => despues[clave] !== deseado);
    const deriva = VIGILADOS.filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]));

    console.log(`\n  aplicados         : ${pendientes.length - sinAplicar.length}/${pendientes.length}`);
    console.log(`  deriva no pedida  : ${deriva.length ? deriva.join(', ') : 'ninguna'}`);

    if (sinAplicar.length || deriva.length) process.exitCode = 1;
    else console.log('\n  RESULTADO         : APLICADO');
  }
}
