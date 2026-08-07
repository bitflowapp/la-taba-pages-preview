#!/usr/bin/env node
/**
 * Configura la política de venta de alcohol del negocio de staging.
 *
 * Era el bloqueante abierto de la RC de piloto: con `alcohol_sales_enabled =
 * false` y sin política ni horario, `create_checkout_session` rechaza todo
 * producto o combo +18 con "politica o confirmacion de edad incompleta", y
 * dos de los tres combos cobrables de staging son +18.
 *
 * La política se configura ENTERA o no se configura: el checkout exige las
 * cuatro piezas (habilitación, edad mínima, ventana horaria, timezone) y una
 * política a medias es indistinguible de una rota. El horario por defecto
 * (20:00–06:00, cruzando medianoche) es una ventana de tienda de bebidas con
 * delivery nocturno pensada para STAGING/QA; el horario del piloto real lo
 * decide el negocio y se cambia con los mismos flags.
 *
 *   TABA_ALCOHOL_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TABA_BUSINESS_ID=... \
 *   node scripts/configure-staging-alcohol-policy.mjs [--disable]
 *     [--minimum-age 18] [--start 20:00] [--end 06:00]
 *     [--timezone America/Argentina/Buenos_Aires]
 */

const CONFIRMATION = 'I_UNDERSTAND_THIS_MUTATES_STAGING';
const env = (name) => String(process.env[name] || '').trim();

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const BUSINESS_ID = env('TABA_BUSINESS_ID');

if (env('TABA_ALCOHOL_CONFIRM') !== CONFIRMATION) {
  console.error(`Defini TABA_ALCOHOL_CONFIRM=${CONFIRMATION} para configurar la politica.`);
  process.exit(2);
}
for (const [name, value] of Object.entries({ SUPABASE_URL, SERVICE_ROLE_KEY, BUSINESS_ID })) {
  if (!value) {
    console.error(`Falta ${name}.`);
    process.exit(2);
  }
}
if (/(^|\.)la-taba-demo\./.test(SUPABASE_URL)) {
  console.error('Este script nunca corre contra la-taba-demo.');
  process.exit(2);
}

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const disable = process.argv.includes('--disable');
const minimumAge = Number(argValue('--minimum-age', '18'));
const start = argValue('--start', '20:00');
const end = argValue('--end', '06:00');
const timezone = argValue('--timezone', 'America/Argentina/Buenos_Aires');

if (!disable) {
  if (!Number.isInteger(minimumAge) || minimumAge < 18 || minimumAge > 99) {
    console.error('La edad minima tiene que ser un entero entre 18 y 99.');
    process.exit(2);
  }
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    console.error('El horario se indica como HH:MM (ej. 20:00).');
    process.exit(2);
  }
  // El timezone lo valida el propio runtime de ICU: un nombre inventado
  // rompería el chequeo horario del checkout en silencio.
  try {
    new Intl.DateTimeFormat('es-AR', { timeZone: timezone });
  } catch (_) {
    console.error(`Timezone IANA desconocido: ${timezone}`);
    process.exit(2);
  }
}

async function rest(pathAndQuery, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${pathAndQuery} → ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

const before = (await rest(
  `businesses?select=name,alcohol_sales_enabled,alcohol_minimum_age,alcohol_sales_start,alcohol_sales_end,alcohol_timezone&id=eq.${BUSINESS_ID}`,
))[0];
if (!before) {
  console.error('El negocio no existe en este proyecto.');
  process.exit(2);
}
console.log('Antes:', JSON.stringify(before));

const patch = disable
  ? { alcohol_sales_enabled: false }
  : {
    alcohol_sales_enabled: true,
    alcohol_minimum_age: minimumAge,
    alcohol_sales_start: `${start}:00`,
    alcohol_sales_end: `${end}:00`,
    alcohol_timezone: timezone,
  };

const [after] = await rest(`businesses?id=eq.${BUSINESS_ID}`, {
  method: 'PATCH',
  body: JSON.stringify(patch),
});

console.log('Después:', JSON.stringify({
  alcohol_sales_enabled: after.alcohol_sales_enabled,
  alcohol_minimum_age: after.alcohol_minimum_age,
  alcohol_sales_start: after.alcohol_sales_start,
  alcohol_sales_end: after.alcohol_sales_end,
  alcohol_timezone: after.alcohol_timezone,
}));

if (!disable) {
  const complete = after.alcohol_sales_enabled
    && Number.isInteger(after.alcohol_minimum_age)
    && after.alcohol_sales_start
    && after.alcohol_sales_end
    && after.alcohol_timezone;
  if (!complete) {
    console.error('La política quedó incompleta; revisá el negocio antes de vender alcohol.');
    process.exit(1);
  }
  const hourNow = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  console.log(`Política completa. Hora actual en ${timezone}: ${hourNow} · ventana ${start}–${end}.`);
}
