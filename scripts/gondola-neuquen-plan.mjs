/*
 * Arma y revisa el plan de carga de la góndola comercial de Neuquén.
 *
 * QUÉ HACE Y QUÉ NO
 * -----------------
 * Es una HOJA: no abre la red, no lee credenciales y no escribe en ninguna
 * base. Toma `catalog/gondola-neuquen.mjs`, comprueba que cada fila cumpla el
 * contrato que la vitrina exige, y emite el lote SQL que aplica la carga.
 *
 * Esa separación es deliberada. El lote queda como un archivo de texto que una
 * persona puede leer entero antes de aplicarlo, en vez de vivir adentro de un
 * proceso que además maneja un token. Aplicarlo es un paso aparte y explícito.
 *
 * POR QUÉ NO SE USA `import-product-catalog.mjs`
 * ---------------------------------------------
 * El importador del repo pide dos cosas que hoy no se pueden dar:
 *
 *   1. un JWT de owner autenticado, y la contraseña del dueño no vive en
 *      ninguna herramienta: la eligió él en su terminal;
 *   2. `image_path` como valor OBLIGATORIO de cada fila —y la RPC que usa por
 *      debajo, `stage_catalog_products`, aborta con «No approved asset» si el
 *      producto no tiene un asset registrado—.
 *
 * El punto 2 es un hueco real del contrato: la migración 108 desacopló vender
 * de tener foto EN LA TABLA, pero ni el validador ni la RPC se enteraron. Queda
 * anotado como riesgo abierto en GONDOLA-NEUQUEN.md; cerrarlo es otra misión.
 *
 *   node scripts/gondola-neuquen-plan.mjs                 # plan y revisión
 *   node scripts/gondola-neuquen-plan.mjs --sql           # además emite el lote
 *   node scripts/gondola-neuquen-plan.mjs --sql --sin-publicar
 *   node scripts/gondola-neuquen-plan.mjs --sql --verificado-por=<uuid>
 */
import fs from 'node:fs';
import path from 'node:path';
import { GONDOLA, CRITERIO_PRECIO } from '../catalog/gondola-neuquen.mjs';

export const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
export const LEDGER_TAXONOMIA = '20260818040000';

/**
 * Vocabulario de categorías que la góndola entiende. Cada nombre slugifica a un
 * id que la vitrina conoce; la migración 20260818040000 los admite en la base.
 */
export const CATEGORIAS_GONDOLA = Object.freeze([
  'Gaseosas', 'Mixers', 'Energizantes', 'Aguas', 'Aguas saborizadas', 'Isotónicas', 'Hielo',
  'Cervezas', 'Fernet', 'Aperitivos', 'Vinos', 'Espumantes', 'Destilados',
]);

/**
 * El contrato que la vitrina exige de cada fila.
 *
 * `rowToCatalogProduct` devuelve `null` —y el producto DESAPARECE de la tienda,
 * sin error y sin aviso— si `presentation` no es igual a `variant`, si
 * `capacity` no es exactamente `capacity_value` + `capacity_unit`, o si la
 * unidad no está en la lista corta. Revisarlo acá vale más que descubrirlo
 * mirando una góndola con huecos.
 */
export function revisarContratoDeVitrina(gondola) {
  const problemas = [];
  const vistos = new Set();
  const categorias = new Set(CATEGORIAS_GONDOLA);
  for (const p of gondola) {
    const donde = `${p.sku}: `;
    if (vistos.has(p.sku)) problemas.push(`${donde}SKU repetido`);
    vistos.add(p.sku);
    if (p.presentation !== p.variant) problemas.push(`${donde}presentation tiene que ser igual a variant`);
    if (p.capacity !== `${p.capacityValue} ${p.capacityUnit}`) problemas.push(`${donde}capacity no coincide con capacity_value + capacity_unit`);
    if (!['ml', 'l', 'g', 'kg', 'unidad'].includes(p.capacityUnit)) problemas.push(`${donde}capacity_unit fuera de la lista que acepta la vitrina`);
    if (!categorias.has(p.category)) problemas.push(`${donde}categoría «${p.category}» fuera del vocabulario de la góndola`);
    if (!(p.price > 0)) problemas.push(`${donde}precio no positivo`);
    if (!Number.isInteger(p.stock) || p.stock < 1) problemas.push(`${donde}stock inicial tiene que ser un entero mayor a cero`);
    if (p.alcoholic && p.minimumAge !== 18) problemas.push(`${donde}con alcohol y sin edad mínima`);
    if (!p.alcoholic && p.minimumAge !== null) problemas.push(`${donde}sin alcohol y con edad mínima`);
    if (p.soldAsPack && !(p.unitsPerPack > 1)) problemas.push(`${donde}declarado como pack con un solo envase`);
    if (!p.soldAsPack && p.unitsPerPack !== 1) problemas.push(`${donde}trae más de una unidad y no declara si el bulto es lo que se vende`);
    for (const campo of ['brand', 'name', 'subcategory', 'packagingType', 'description']) {
      if (!String(p[campo] || '').trim()) problemas.push(`${donde}${campo} vacío`);
    }
    if (String(p.description).length > 180) problemas.push(`${donde}descripción de más de 180 caracteres: la vitrina la recorta`);
    if (/\b(test|prueba|qa|dummy|fixture|placeholder|lorem|staging)\b/i.test(`${p.sku} ${p.name} ${p.description}`)) {
      problemas.push(`${donde}parece un producto de prueba y no puede entrar a producción`);
    }
  }
  return problemas;
}

/** Coherencia entre formatos: nadie puede pagar más por litro en el pack. */
export function revisarCoherenciaDePrecios(gondola) {
  const avisos = [];
  const porLitro = (p) => (p.price / (p.capacityValue * (p.soldAsPack ? p.unitsPerPack : 1))) * 1000;
  for (const pack of gondola.filter((p) => p.soldAsPack)) {
    const unidad = gondola.find((p) => !p.soldAsPack
      && p.brand === pack.brand
      && p.category === pack.category
      && p.capacityValue === pack.capacityValue
      && p.variant === pack.variant);
    if (!unidad) continue;
    if (porLitro(pack) >= porLitro(unidad)) {
      avisos.push(`${pack.sku}: el pack no es más barato por litro que ${unidad.sku}. Un pack así no lo lleva nadie.`);
    }
  }
  return avisos;
}

const lit = (valor) => (valor === null || valor === undefined ? 'null' : `'${String(valor).replaceAll("'", "''")}'`);
const bool = (valor) => (valor ? 'true' : 'false');
const arrayTexto = (valores) => `array[${valores.map(lit).join(',')}]::text[]`;

/**
 * El lote que aplica la carga: una sola transacción, o entran todos o ninguno.
 *
 * Publicar exige `verificadoPor`: `verified_by` es una FK a `auth.users` y
 * significa «una persona miró estos datos maestros y responde por ellos».
 * Ninguna herramienta puede afirmar eso por su cuenta.
 *
 * `alcoholComprable` es una compuerta APARTE, y falla cerrada.
 *
 * Verificar los datos maestros de un fernet y tener permiso municipal para
 * venderlo son dos cosas distintas: la primera la firma quien mira la ficha, la
 * segunda la otorga el municipio. Por eso los productos con alcohol se cargan
 * verificados y catalogados —para que estén bien puestos el día que la
 * habilitación se acredite— pero NO comprables mientras esa acreditación no
 * exista. `available = false` con `is_verified = true` es exactamente eso, y la
 * base lo admite: `products_available_requires_verification` sólo exige la
 * verificación para publicar, nunca al revés.
 */
export function construirLote(gondola, {
  verificadoPor = '',
  publicar = true,
  alcoholComprable = false,
} = {}) {
  if (publicar && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verificadoPor)) {
    throw new Error('publicar exige el uuid de la persona que verifica los datos maestros');
  }
  const conAlcohol = gondola.filter((p) => p.alcoholic).length;
  const valores = gondola.map((p) => `  (${lit(BUSINESS_ID)}, ${lit(p.externalId)}, ${lit(p.sku)}, ${lit(p.brand)}, ${lit(p.name)},`
    + `\n   ${lit(p.description)}, ${lit(p.category)}, ${lit(p.subcategory)}, ${lit(p.variant)}, ${lit(p.presentation)},`
    + `\n   ${p.capacityValue}, ${lit(p.capacityUnit)}, ${lit(p.capacity)}, ${lit(p.packagingType)}, ${p.unitsPerPack}, ${bool(p.soldAsPack)},`
    + `\n   ${p.price}, ${p.stock}, ${bool(p.chilled)}, ${bool(p.alcoholic)}, ${p.minimumAge === null ? 'null' : p.minimumAge},`
    + `\n   ${p.sortOrder}, ${arrayTexto(p.tags)})`).join(',\n');

  // `available` sale de dos decisiones, no de una: publicar el catálogo y tener
  // permiso para vender alcohol. Se resuelve por fila, en el propio SQL, para
  // que el lote diga la regla en vez de traerla ya aplicada.
  const disponible = publicar
    ? (alcoholComprable ? 'true' : 'not e.is_alcoholic')
    : 'false';

  return `-- Góndola comercial de TABA · Neuquén Capital · ${gondola.length} SKU
-- Generado por scripts/gondola-neuquen-plan.mjs desde catalog/gondola-neuquen.mjs.
-- No editar a mano: se regenera. Los precios se derivan del costo de reposición.
--
-- Una sola transacción: o entran los ${gondola.length} o no entra ninguno.
-- Idempotente: correrlo dos veces deja el mismo catálogo.
${publicar
    ? `-- PUBLICA: is_verified = true, verified_by = ${verificadoPor}.`
    : '-- NO PUBLICA: is_verified = false, available = false. La publicación es otro paso.'}
${publicar && !alcoholComprable
    ? `-- LICENSE GATE: los ${conAlcohol} productos con alcohol entran verificados y
-- catalogados pero con available = false. Quedan bien puestos en su categoría y
-- NO se pueden comprar. Se habilitan cuando la habilitación comercial del local
-- para expendio de bebidas alcohólicas esté acreditada, y no antes.`
    : ''}${publicar && alcoholComprable
    ? `-- ALCOHOL COMPRABLE: los ${conAlcohol} productos con alcohol entran disponibles.
-- Esto sólo es correcto si la habilitación comercial está acreditada Y el
-- comercio tiene alcohol_sales_enabled con su política horaria configurada.`
    : ''}

begin;

do $gondola$
begin
  if not exists (
    select 1 from public.businesses where id = ${lit(BUSINESS_ID)}
  ) then
    raise exception 'El negocio ${BUSINESS_ID} no existe en este proyecto.';
  end if;
  if (select max(version) from supabase_migrations.schema_migrations) < '${LEDGER_TAXONOMIA}' then
    raise exception 'Falta la migración ${LEDGER_TAXONOMIA} (taxonomía de la góndola): la base rechaza Mixers, Energizantes, Fernet, Aperitivos, Vinos, Destilados y Aguas saborizadas.';
  end if;
end
$gondola$;

create temporary table gondola_entrante (
  business_id uuid, external_id text, sku text, brand text, name text,
  description text, category text, subcategory text, variant text, presentation text,
  capacity_value numeric, capacity_unit text, capacity text, packaging_type text,
  units_per_pack integer, sold_as_pack boolean,
  price numeric, stock integer, chilled boolean, is_alcoholic boolean, minimum_age integer,
  sort_order integer, tags text[]
) on commit drop;

insert into gondola_entrante values
${valores};

insert into public.products (
  business_id, external_id, sku, brand, name, description, category, subcategory,
  variant, presentation, capacity_value, capacity_unit, capacity, packaging_type,
  units_per_pack, sold_as_pack, price, price_status, stock, chilled, is_alcoholic,
  minimum_age, sort_order, tags, catalog_origin, is_active,
  is_verified, verified_at, verified_by, available, updated_at
)
select
  e.business_id, e.external_id, e.sku, e.brand, e.name, e.description, e.category, e.subcategory,
  e.variant, e.presentation, e.capacity_value, e.capacity_unit, e.capacity, e.packaging_type,
  e.units_per_pack, e.sold_as_pack, e.price, 'confirmed', e.stock, e.chilled, e.is_alcoholic,
  e.minimum_age, e.sort_order, e.tags, 'commercial', true,
  ${bool(publicar)}, ${publicar ? 'now()' : 'null'}, ${publicar ? lit(verificadoPor) : 'null'},
  ${disponible}, now()
from gondola_entrante e
on conflict (business_id, external_id) do update set
  sku = excluded.sku, brand = excluded.brand, name = excluded.name,
  description = excluded.description, category = excluded.category,
  subcategory = excluded.subcategory, variant = excluded.variant,
  presentation = excluded.presentation, capacity_value = excluded.capacity_value,
  capacity_unit = excluded.capacity_unit, capacity = excluded.capacity,
  packaging_type = excluded.packaging_type, units_per_pack = excluded.units_per_pack,
  sold_as_pack = excluded.sold_as_pack, price = excluded.price,
  price_status = excluded.price_status, stock = excluded.stock, chilled = excluded.chilled,
  is_alcoholic = excluded.is_alcoholic, minimum_age = excluded.minimum_age,
  sort_order = excluded.sort_order, tags = excluded.tags,
  catalog_origin = excluded.catalog_origin, is_active = true,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  verified_by = excluded.verified_by, available = excluded.available,
  updated_at = now();

commit;

-- Relectura: lo que quedó escrito, no lo que se pidió escribir.
select category,
       count(*)::int as filas,
       count(*) filter (where available)::int as publicados,
       min(price)::numeric as precio_min,
       max(price)::numeric as precio_max
  from public.products
 where business_id = ${lit(BUSINESS_ID)}
 group by category
 order by category;
`;
}

// ── Informe por consola ──────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1].replaceAll('\\\\', '/')}`
  || process.argv[1]?.endsWith('gondola-neuquen-plan.mjs')) {
  const banderas = new Set(process.argv.slice(2).map((a) => a.split('=')[0]));
  const verificadoPor = (process.argv.slice(2).find((a) => a.startsWith('--verificado-por=')) || '').split('=')[1] || '';
  const publicar = !banderas.has('--sin-publicar');
  const alcoholComprable = banderas.has('--alcohol-comprable');

  const porCategoria = new Map();
  for (const p of GONDOLA) porCategoria.set(p.category, (porCategoria.get(p.category) || 0) + 1);
  const conAlcohol = GONDOLA.filter((p) => p.alcoholic).length;

  console.log(`GÓNDOLA NEUQUÉN · ${GONDOLA.length} SKU · ${conAlcohol} con alcohol · ${GONDOLA.length - conAlcohol} sin alcohol`);
  console.log(`precio = costo de reposición × ${CRITERIO_PRECIO.margenUnidad} (pack × ${CRITERIO_PRECIO.margenPack}), redondeado a $${CRITERIO_PRECIO.redondeoA}`);
  console.log(`costo: ${CRITERIO_PRECIO.fuenteCosto} · medido ${CRITERIO_PRECIO.medidoEl}`);
  console.log(`contraste: ${CRITERIO_PRECIO.fuenteContraste}`);
  console.log('');
  for (const [categoria, cuantos] of [...porCategoria].sort()) {
    const precios = GONDOLA.filter((p) => p.category === categoria).map((p) => p.price);
    console.log(`  ${String(cuantos).padStart(3)}  ${categoria.padEnd(20)} $${Math.min(...precios).toLocaleString('es-AR')} – $${Math.max(...precios).toLocaleString('es-AR')}`);
  }

  const problemas = revisarContratoDeVitrina(GONDOLA);
  const avisos = revisarCoherenciaDePrecios(GONDOLA);
  console.log('');
  for (const p of problemas) console.error(`ERROR ${p}`);
  for (const a of avisos) console.error(`ERROR ${a}`);
  if (problemas.length || avisos.length) {
    console.error(`\n${problemas.length + avisos.length} problema(s). No se emite ningún lote.`);
    process.exit(1);
  }
  console.log(`contrato de la vitrina: ${GONDOLA.length}/${GONDOLA.length} · coherencia de precios: sin observaciones`);

  const derivados = GONDOLA.filter((p) => p.derivado);
  if (derivados.length) {
    console.log('');
    console.log(`costos derivados (${derivados.length}), con su justificación escrita en el catálogo:`);
    for (const p of derivados) console.log(`  ${p.sku}`);
  }

  console.log('');
  console.log(alcoholComprable
    ? `ALCOHOL COMPRABLE · los ${conAlcohol} con alcohol entrarían disponibles.\n`
      + '  Sólo es correcto con la habilitación comercial acreditada Y\n'
      + '  alcohol_sales_enabled con su política horaria configurada.'
    : `LICENSE GATE · los ${conAlcohol} con alcohol entran verificados y catalogados,\n`
      + '  con available = false: se ven en el catálogo y NO se pueden comprar.\n'
      + '  Se habilitan cuando la habilitación comercial del local para expendio de\n'
      + '  bebidas alcohólicas esté acreditada. Para habilitarlos: --alcohol-comprable.');

  if (banderas.has('--sql')) {
    const destino = path.resolve(process.cwd(), 'artifacts/taba2-gondola-neuquen');
    fs.mkdirSync(destino, { recursive: true });
    const archivo = path.join(destino, publicar ? 'gondola-neuquen.sql' : 'gondola-neuquen-sin-publicar.sql');
    fs.writeFileSync(archivo, construirLote(GONDOLA, { verificadoPor, publicar, alcoholComprable }), 'utf8');
    console.log('');
    console.log(`lote escrito: ${path.relative(process.cwd(), archivo)}`);
    console.log(publicar
      ? `  ${GONDOLA.length - conAlcohol} comprables · ${conAlcohol} con alcohol ${alcoholComprable ? 'comprables' : 'catalogados y NO comprables'} · verified_by=${verificadoPor}`
      : `  carga los ${GONDOLA.length} sin publicar`);
  }
}
