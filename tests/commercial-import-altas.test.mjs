/*
 * ALTA PROPUESTA: LO QUE EL IMPORTADOR TIENE PROHIBIDO.
 *
 * El importador comercial se negaba a crear productos, y estaba bien: una
 * planilla de cuatro columnas —sku, precio, stock, publicar— no dice qué es el
 * producto, en qué góndola va, ni si lleva alcohol. Con la tienda 24/7 eso pasó
 * a ser un cuello: abrir el rubro limpieza son decenas de artículos que todavía
 * no existen.
 *
 * Lo que se abrió es una puerta con contrato, y este archivo prueba las CINCO
 * cosas que el encargo prohíbe expresamente, cada una con su caso:
 *
 *   · convertir normal → alcohol, o alcohol → normal;
 *   · publicar alcohol;
 *   · crear SKU duplicados;
 *   · sobrescribir productos por nombre;
 *   · insertar una fila nueva sólo porque tiene un nombre.
 *
 * Y las dos que hacen que la puerta sea usable: que el dry-run muestre
 * exactamente lo que se crearía, y que aplicar sea todo o nada.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ALTA_COLUMNS,
  applyCommercialImport,
  buildCommercialPlan,
  parseSheetAlcohol,
  parseSheetCategory,
  planToAltaRows,
  planToRpcRows,
  renderAltaReport,
} from '../scripts/import-commercial-catalog.mjs';

const migracion = fs.readFileSync(
  new URL('../supabase/migrations/20260828140000_alta_propuesta_comercial.sql', import.meta.url),
  'utf8',
);

/** Un catálogo chico con un producto vivo, para probar el apareo por SKU. */
const CATALOGO = new Map([
  ['coca-cola-original-1500ml', {
    sku: 'coca-cola-original-1500ml',
    name: 'Coca-Cola Original',
    category_id: 'gaseosas',
    price: '2500',
    stock: '10',
    publication_status: 'published',
    image_master: 'assets/products/coca.webp',
  }],
]);

const ENCABEZADO = `sku,precio,stock,publicar,${ALTA_COLUMNS.join(',')}`;
const planDe = (...filas) => buildCommercialPlan(
  [ENCABEZADO, ...filas].join('\n'),
  { catalog: CATALOGO, imageExists: () => true },
);

test('sin las cinco columnas de alta, un SKU desconocido sigue siendo un error', () => {
  // El comportamiento anterior se conserva entero: una planilla vieja no puede
  // empezar a crear productos por haberse actualizado el importador.
  const plan = buildCommercialPlan(
    ['sku,precio,stock,publicar', 'lavandina-ayudin-1000ml,1890,24,no'].join('\n'),
    { catalog: CATALOGO, imageExists: () => true },
  );
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /no existe en el catálogo/);
});

test('un encabezado de alta a medias se rechaza antes de mirar una fila', () => {
  // «nombre» sin «alcohol» es la forma más fácil de crear un producto con una
  // clasificación que nadie escribió.
  const plan = buildCommercialPlan(
    ['sku,precio,stock,publicar,nombre,categoria', 'x-y-z,100,1,no,Algo,Limpieza'].join('\n'),
    { catalog: CATALOGO, imageExists: () => true },
  );
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /hacen falta las cinco columnas/);
  assert.match(plan.errors[0], /faltan: subcategoria, alcohol, imagen/);
});

test('un alta completa produce la ficha exacta que se crearía', () => {
  const plan = planDe('lavandina-ayudin-1000ml,1890,24,no,Ayudín 1 L,Limpieza,lavandina,no,si');
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.altas.length, 1);
  assert.deepEqual(plan.altas[0], {
    line: 2,
    sku: 'lavandina-ayudin-1000ml',
    nombre: 'Ayudín 1 L',
    categoriaId: 'limpieza',
    categoria: 'Limpieza',
    subcategoria: 'lavandina',
    alcohol: false,
    edadMinima: null,
    precio: 1890,
    stock: 24,
    tieneImagen: true,
    publicar: false,
    notas: '',
  });
  // El dry-run escribe la ficha completa, campo por campo: en un alta no hay un
  // «antes» que diffear, así que lo único honesto es mostrar todo.
  const informe = renderAltaReport(plan).join('\n');
  assert.match(informe, /nombre \.+ Ayudín 1 L/);
  assert.match(informe, /categoria \.+ Limpieza \(limpieza\)/);
  assert.match(informe, /alcohol \.+ no/);
  assert.match(informe, /publicacion \.+ oculto/);
});

test('un alta nunca nace publicada, ni siquiera si la planilla lo pide', () => {
  const plan = planDe('lavandina-ayudin-1000ml,1890,24,si,Ayudín 1 L,Limpieza,lavandina,no,si');
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /no se publica en el mismo renglón/);
  assert.match(plan.errors[0], /segunda pasada/);
});

test('el alcohol se declara y no se infiere, y tiene que coincidir con la góndola', () => {
  // Vacío no es «no».
  const sinDeclarar = planDe('fernet-branca-750ml,9900,5,no,Fernet Branca,Fernet,original,,no');
  assert.match(sinDeclarar.errors[0], /le faltan alcohol/);

  // Un fernet declarado sin alcohol: la góndola dice una cosa y la fila otra.
  const contradice = planDe('fernet-branca-750ml,9900,5,no,Fernet Branca,Fernet,original,no,no');
  assert.match(contradice.errors[0], /lleva alcohol y la fila dice «no»/);

  // Una lavandina declarada CON alcohol: el mismo rechazo en la otra dirección.
  const alReves = planDe('lavandina-ayudin-1000ml,1890,24,no,Ayudín 1 L,Limpieza,lavandina,si,si');
  assert.match(alReves.errors[0], /no lleva alcohol y la fila dice «si»/);

  // Y cuando coinciden, el +18 lo pone el contrato y no la planilla.
  const coherente = planDe('fernet-branca-750ml,9900,5,no,Fernet Branca,Fernet,original,si,no');
  assert.deepEqual(coherente.errors, []);
  assert.equal(coherente.altas[0].alcohol, true);
  assert.equal(coherente.altas[0].edadMinima, 18);
  assert.equal(coherente.altas[0].publicar, false);
});

test('no se crea un SKU que ya existe ni dos veces el mismo', () => {
  // Un SKU conocido es una MODIFICACIÓN, nunca un alta: las columnas de alta se
  // ignoran a propósito, así que el importador no puede convertir una gaseosa
  // en un fernet ni cambiarle la clasificación a un producto vivo.
  const conocido = planDe('coca-cola-original-1500ml,2600,8,,Otro nombre,Fernet,x,si,si');
  assert.deepEqual(conocido.errors, []);
  assert.equal(conocido.altas.length, 0);
  assert.equal(conocido.rows.length, 1);
  // Sólo viajan precio y stock: el nombre, la categoría y la clasificación
  // alcohólica de la planilla NO entran al payload de una modificación.
  assert.deepEqual(planToRpcRows(conocido), [{ sku: 'coca-cola-original-1500ml', price: '2600', stock: 8 }]);

  const repetido = planDe(
    'lavandina-ayudin-1000ml,1890,24,no,Ayudín 1 L,Limpieza,lavandina,no,si',
    'lavandina-ayudin-1000ml,1900,20,no,Ayudín otro,Limpieza,lavandina,no,si',
  );
  assert.match(repetido.errors[0], /ya aparece en la línea 2/);
});

test('no se sobrescribe ni se duplica un producto por su nombre', () => {
  // El apareo es por SKU. Un alta con OTRO sku y el MISMO nombre en la misma
  // categoría es cómo nacen los catálogos con la misma lavandina tres veces, así
  // que se rechaza y se nombra el SKU que ya la tiene.
  const duplicado = planDe('coca-cola-15,2500,10,no,Coca-Cola Original,Gaseosas,cola,no,si');
  assert.equal(duplicado.errors.length, 1);
  assert.match(duplicado.errors[0], /ya hay un producto llamado «Coca-Cola Original» en Gaseosas/);
  assert.match(duplicado.errors[0], /coca-cola-original-1500ml/);

  // Dos altas con el mismo nombre en la misma planilla, lo mismo.
  const entreAltas = planDe(
    'lavandina-a,1890,24,no,Lavandina Común,Limpieza,lavandina,no,si',
    'lavandina-b,1990,24,no,Lavandina Común,Limpieza,lavandina,no,si',
  );
  assert.match(entreAltas.errors[0], /repite el nombre «Lavandina Común» de la línea 2/);
});

test('una fila nueva no se inserta sólo porque tiene un nombre', () => {
  const sinCategoria = planDe('algo-nuevo-123,1000,5,no,Algo,,,no,no');
  assert.match(sinCategoria.errors[0], /le faltan categoria/);

  const categoriaInventada = planDe('algo-nuevo-123,1000,5,no,Algo,Ferretería,,no,no');
  assert.match(categoriaInventada.errors[0], /no es una categoría de la tienda/);

  // Un identificador que no es estable no puede ser el SKU de nada.
  const skuInestable = planDe('Lavandina Ayudín!,1000,5,no,Ayudín,Limpieza,lavandina,no,no');
  assert.match(skuInestable.errors[0], /no es un SKU estable/);

  // Un fixture de QA nunca entra al catálogo comercial, tampoco por acá.
  const qa = planDe('qa-lavandina-test,1000,5,no,QA,Limpieza,lavandina,no,no');
  assert.match(qa.errors[0], /parece un producto de prueba/);

  // Y un pack de abastecimiento no es un producto de góndola.
  const pack = planDe('lavandina-ayudin-pack-6,1000,5,no,Pack,Limpieza,lavandina,no,no');
  assert.match(pack.errors[0], /pack de abastecimiento/);
});

test('un alta puede existir sin precio ni stock: nace y no se vende', () => {
  const plan = planDe('yerba-playadito-1000g,,,no,Playadito 1 kg,Almacén,yerba,no,no');
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.altas[0].precio, null);
  assert.equal(plan.altas[0].stock, null);
  assert.equal(plan.summary.altas, 1);
  assert.equal(plan.summary.altasConPrecio, 0);
  assert.deepEqual(planToAltaRows(plan), [{
    sku: 'yerba-playadito-1000g',
    name: 'Playadito 1 kg',
    category: 'Almacén',
    subcategory: 'yerba',
    is_alcoholic: false,
    minimum_age: null,
    price: null,
    stock: null,
    publish: false,
  }]);
});

test('una planilla con errores no aplica nada, ni siquiera las filas buenas', () => {
  // Falla cerrado, como el importador de siempre: una importación a medias deja
  // una góndola que alguien reconstruye a mano.
  const plan = planDe(
    'lavandina-ayudin-1000ml,1890,24,no,Ayudín 1 L,Limpieza,lavandina,no,si',
    'fernet-branca-750ml,9900,5,no,Fernet Branca,Fernet,original,no,no',
  );
  assert.equal(plan.errors.length, 1);
  assert.deepEqual(plan.rows, []);
  assert.deepEqual(plan.altas, []);
});

test('aplicar manda altas y modificaciones en UNA sola llamada', async () => {
  const plan = planDe(
    'coca-cola-original-1500ml,2600,8,no,x,Gaseosas,cola,no,si',
    'lavandina-ayudin-1000ml,1890,24,no,Ayudín 1 L,Limpieza,lavandina,no,si',
  );
  assert.deepEqual(plan.errors, []);

  const llamadas = [];
  const client = {
    rpc: async (name, payload) => {
      llamadas.push([name, payload]);
      return { data: { ok: true, created: payload.p_creates.length, updated: payload.p_updates.length } };
    },
  };
  const resultado = await applyCommercialImport(client, plan, '00000000-0000-4000-8000-000000000001');
  assert.equal(llamadas.length, 1, 'partir el plan en dos llamadas serían dos transacciones');
  assert.equal(llamadas[0][0], 'apply_commercial_catalog_plan');
  assert.equal(llamadas[0][1].p_creates.length, 1);
  assert.equal(llamadas[0][1].p_updates.length, 1);
  assert.deepEqual(resultado, { applied: 2, created: 1, updated: 1, rows: [] });
});

test('si el servidor aplica menos filas de las esperadas, el cliente lo denuncia', async () => {
  const plan = planDe('lavandina-ayudin-1000ml,1890,24,no,Ayudín 1 L,Limpieza,lavandina,no,si');
  const client = { rpc: async () => ({ data: { ok: true, created: 0, updated: 0 } }) };
  await assert.rejects(
    () => applyCommercialImport(client, plan, '00000000-0000-4000-8000-000000000001'),
    /aplicó 0 altas y 0 modificaciones/,
  );
});

test('la RPC repite el contrato del cliente y nunca publica lo que crea', () => {
  assert.match(migracion, /create or replace function public\.apply_commercial_catalog_plan/);
  // Sólo owner/admin autenticado.
  assert.match(migracion, /has_business_role\(p_business_id, array\['owner', 'admin'\]\)/);
  // El alta nace oculta y sin verificar: son los dos campos que deciden si algo
  // se puede comprar.
  assert.match(migracion, /true, false, false,/);
  assert.match(migracion, /always created hidden/);
  // La clasificación alcohólica es explícita y coherente con la góndola.
  assert.match(migracion, /must declare is_alcoholic explicitly as a boolean/);
  assert.match(migracion, /Category % and is_alcoholic=% disagree/);
  // No se crea sobre un SKU existente.
  assert.match(migracion, /already exists for this business/);
  // Y las modificaciones siguen pasando por la puerta de siempre, en la misma
  // transacción: es lo que hace que el lote sea todo o nada.
  assert.match(migracion, /from public\.apply_commercial_catalog_batch\(p_business_id, p_updates\)/);
  // No toca la compuerta de alcohol del comercio por ningún lado.
  assert.doesNotMatch(migracion, /alcohol_sales_enabled\s*=/);
});

test('los analizadores sueltos contestan lo que dicen que contestan', () => {
  assert.deepEqual(parseSheetAlcohol('SÍ'), { value: true });
  assert.deepEqual(parseSheetAlcohol('no'), { value: false });
  assert.deepEqual(parseSheetAlcohol(''), { empty: true });
  assert.match(parseSheetAlcohol('tal vez').error, /escribí «si» o «no»/);
  assert.equal(parseSheetCategory('limpieza').value.id, 'limpieza');
  assert.equal(parseSheetCategory('Higiene Personal').value.id, 'higiene-personal');
  // El vocabulario anterior no sirve para dar de alta: se conserva para leer
  // datos guardados, no para crear productos nuevos.
  assert.match(parseSheetCategory('Vinos y espumantes').error, /no es una categoría de la tienda/);
});
