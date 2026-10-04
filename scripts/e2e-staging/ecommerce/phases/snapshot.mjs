// FASE snapshot — el pedido guarda lo que el cliente compró, no lo que el catálogo dice hoy.
//
// Se crea un pedido, después el dueño cambia el precio y el nombre del producto por
// los caminos reales del Panel, y se comprueba que el pedido (filas y lecturas) no
// se movió un centavo ni una letra.
import { sqlUuid } from '../env.mjs';
import { brief } from '../http.mjs';
import { customerHistoryQuery } from '../orders.mjs';
import { normalizeFixtures } from '../tenant.mjs';

const P = 'snapshot';
const MASTER = { brand: 'Cert', category: 'Aguas', variant: 'Botella', capacity_value: 500, capacity_unit: 'ml', units_per_pack: 1 };
const frozenOf = (truth) => ({ subtotal: Number(truth.order_row.subtotal), delivery_fee: Number(truth.order_row.delivery_fee), total: Number(truth.order_row.total),
  revision: Number(truth.order_row.revision), items: (truth.items || []).map((i) => ({ name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price), subtotal: Number(i.subtotal) })) });
const sameItems = (rows, frozen) => Array.isArray(rows) && rows.length === frozen.items.length && frozen.items.every((f) => rows.some((r) => r.name === f.name
  && Number(r.quantity) === f.quantity && Number(r.unit_price) === f.unit_price && Number(r.subtotal) === f.subtotal));

export default {
  id: P,
  title: 'instantánea del pedido: precio y nombre congelados frente a un cambio de catálogo',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const { owner, staff } = ctx.actors;
    const customer = await ctx.identities.customer('snapshot');
    const fixture = ctx.orders.product('PRICE_CHANGE');
    const productRow = async () => (await ctx.env.observe(`select name, price, price_status, stock, available, merchant_available, is_verified from public.products where id = ${sqlUuid(fixture.id)}`))[0];

    const created = await ctx.orders.create(customer, { mode: 'delivery', role: 'PRICE_CHANGE', quantity: 2, label: 'snapshot' });
    C(P, 'ORDER_CREATED_BEFORE_THE_CATALOG_CHANGE', Boolean(created.order), brief(created.r));
    if (!created.order) return;
    const before = frozenOf(await ctx.orders.truth(created.order.id));
    C(P, 'ORDER_FROZEN_VALUES_MATCH_THE_CATALOG_AT_PURCHASE', before.items.length === 1 && before.items[0].name === fixture.name && before.items[0].unit_price === fixture.price
      && before.subtotal === fixture.price * 2, before);

    // 1. Precio: el camino comercial del Panel.
    const newPrice = fixture.price + 350;
    const newName = `${fixture.name} RENOMBRADA`;
    const priced = await ctx.http.call(owner, 'apply_commercial_catalog_batch', { p_business_id: id, p_rows: [{ sku: fixture.sku, price: String(newPrice) }] });
    const applied = Array.isArray(priced.data) ? priced.data[0] : null;
    C(P, 'PRICE_CHANGED_THROUGH_OWNER_COMMERCIAL_PATH', priced.ok && Number(applied?.applied_price) === newPrice, { ...brief(priced), applied });
    const afterPrice = await productRow();
    // Por diseño el cambio de precio despublica y desverifica; el mismo lote republica lo que ya estaba publicado.
    C(P, 'PRICE_CHANGE_REPUBLISHES_A_PUBLISHED_PRODUCT', applied?.applied_republished === true && afterPrice.available && afterPrice.is_verified && Number(afterPrice.price) === newPrice,
      { republished: applied?.applied_republished, product: afterPrice });

    // 2. Nombre: el camino del dueño para completar datos maestros. Desverifica (dato maestro) y hay que volver a publicar.
    // Sin `stock`: desde 20261001210000 ese campo es un conteo físico (disponible = conteo − apartado) y
    // sobre un producto ya contado es opcional. Reenviar el disponible leído como si fuera un conteo le
    // restaría lo apartado en cada llamada.
    const rename = async (name, price) => ctx.http.call(owner, 'complete_scanned_product', { p_product_id: fixture.id,
      p_details: { ...MASTER, name, price } });
    const renamed = await rename(newName, newPrice);
    let namePath = 'complete_scanned_product (owner)';
    if (!renamed.ok) {
      // No hay otro camino del dueño para el nombre de un producto comercial: se anota y se cambia como plataforma.
      namePath = `service_role update (owner path refused: ${renamed.code})`;
      ctx.guard.assertWrite(id);
      const forced = await ctx.serviceRole('provision', `update products (fixture PRICE_CHANGE name; owner path refused ${renamed.code})`,
        (admin) => admin.from('products').update({ name: newName }).eq('id', fixture.id).eq('business_id', id).select('id'));
      if (forced.error) throw Error(`NAME_CHANGE_FAILED:${forced.error.code}`);
    }
    C(P, 'NAME_CHANGED_THROUGH_OWNER_PATH', renamed.ok, { ...brief(renamed), path: namePath });
    const afterName = await productRow();
    C(P, 'MASTER_DATA_CHANGE_UNPUBLISHES_BY_DESIGN', afterName.name === newName && afterName.is_verified === false && afterName.available === false, afterName);
    const republished = await ctx.http.call(owner, 'apply_commercial_catalog_batch', { p_business_id: id, p_rows: [{ sku: fixture.sku, publish: true }] });
    const changed = await productRow();
    C(P, 'PRODUCT_NOW_SELLS_WITH_NEW_PRICE_AND_NAME', republished.ok && changed.name === newName && Number(changed.price) === newPrice && changed.available && changed.is_verified,
      { ...brief(republished), product: changed });

    // 3. El pedido no se movió.
    const truth = await ctx.orders.truth(created.order.id);
    const after = frozenOf(truth);
    C(P, 'ORDER_TOTALS_UNCHANGED', after.subtotal === before.subtotal && after.delivery_fee === before.delivery_fee && after.total === before.total,
      { subtotal: after.subtotal, delivery_fee: after.delivery_fee, total: after.total }, { subtotal: before.subtotal, delivery_fee: before.delivery_fee, total: before.total });
    C(P, 'ORDER_ITEMS_UNCHANGED', JSON.stringify(after.items) === JSON.stringify(before.items), after.items, before.items);
    C(P, 'ORDER_ROW_NOT_TOUCHED_BY_CATALOG_CHANGE', after.revision === before.revision, { revision: after.revision }, { revision: before.revision });

    // 4. Las lecturas que usan el cliente y el Panel muestran lo congelado.
    const tracked = await ctx.orders.tracking(created.order.public_code, created.token);
    C(P, 'PUBLIC_TRACKING_STILL_READS_THE_SAME_ORDER', tracked.ok && tracked.data?.public_code === created.order.public_code && Number(tracked.data?.revision) === before.revision,
      { ...brief(tracked), status: tracked.data?.status, revision: tracked.data?.revision });
    const history = await ctx.http.restGet(customer, `${customerHistoryQuery(id)}&id=eq.${created.order.id}`);
    const mine = history.rows?.[0];
    C(P, 'CUSTOMER_HISTORY_SHOWS_FROZEN_VALUES', Boolean(mine) && Number(mine.total) === before.total && Number(mine.subtotal) === before.subtotal && sameItems(mine.order_items, before),
      { ...brief(history), total: mine?.total, items: mine?.order_items?.map((i) => `${i.name}|${i.quantity}|${i.unit_price}`) });
    const panel = await ctx.orders.panelRepository(staff).fetchBusinessOrderSnapshot();
    const panelRow = panel.ok ? (panel.rows || []).find((row) => row.id === created.order.id) : null;
    C(P, 'PANEL_ORDER_QUERY_SHOWS_FROZEN_VALUES', Boolean(panelRow) && Number(panelRow.total) === before.total && Number(panelRow.subtotal) === before.subtotal
      && Number(panelRow.delivery_fee) === before.delivery_fee && sameItems(panelRow.order_items, before),
    { ok: panel.ok, code: panel.code || null, found: Boolean(panelRow), total: panelRow?.total, items: panelRow?.order_items?.map((i) => `${i.name}|${i.quantity}|${i.unit_price}`) });
    const pipeline = await ctx.http.call(staff, 'list_operational_pipeline', { p_business_id: id, p_include_qa: false });
    const pipelineRow = (pipeline.data || []).find((row) => row.reference_id === created.order.id);
    C(P, 'OPERATIONAL_PIPELINE_SHOWS_FROZEN_TOTAL', pipeline.ok && Boolean(pipelineRow) && Number(pipelineRow.total) === before.total,
      { ...brief(pipeline), total: pipelineRow?.total, state: pipelineRow?.pipeline_state });

    // 5. Un pedido NUEVO sí lleva el precio y el nombre nuevos.
    const second = await ctx.orders.create(customer, { mode: 'delivery', role: 'PRICE_CHANGE', quantity: 2, label: 'snapshot-after-change' });
    if (second.order) {
      const next = frozenOf(await ctx.orders.truth(second.order.id));
      C(P, 'NEW_ORDER_USES_THE_NEW_PRICE_AND_NAME', next.items[0]?.unit_price === newPrice && next.items[0]?.name === newName && next.subtotal === newPrice * 2, next.items);
    } else {
      C(P, 'NEW_ORDER_USES_THE_NEW_PRICE_AND_NAME', false, brief(second.r));
    }

    // 6. Restaurar el producto, por los mismos caminos del dueño.
    const priceBack = await ctx.http.call(owner, 'apply_commercial_catalog_batch', { p_business_id: id, p_rows: [{ sku: fixture.sku, price: String(fixture.price) }] });
    const nameBack = renamed.ok ? await rename(fixture.name, fixture.price) : { ok: false, code: 'not_attempted' };
    if (nameBack.ok) await ctx.http.call(owner, 'apply_commercial_catalog_batch', { p_business_id: id, p_rows: [{ sku: fixture.sku, publish: true }] });
    await normalizeFixtures(ctx, { reason: 'restaurar producto de la fase snapshot' });
    const restored = await productRow();
    C(P, 'PRODUCT_RESTORED_TO_DECLARED_PRICE_AND_NAME', restored.name === fixture.name && Number(restored.price) === fixture.price && restored.available && restored.is_verified,
      { product: restored, priceBack: brief(priceBack), nameBack: brief(nameBack) });
    const final = frozenOf(await ctx.orders.truth(created.order.id));
    C(P, 'ORDER_STILL_FROZEN_AFTER_RESTORE', JSON.stringify(final.items) === JSON.stringify(before.items) && final.total === before.total, final.items);
    ctx.evidence.write('phase-snapshot.json', { order: created.order.public_code, frozen: before, catalogChange: { from: { name: fixture.name, price: fixture.price }, to: { name: newName, price: newPrice }, namePath },
      afterChange: after, reads: { tracking: tracked.data, customerHistory: mine ? { total: mine.total, items: mine.order_items } : null,
        panel: panelRow ? { total: panelRow.total, items: panelRow.order_items } : null, pipeline: pipelineRow || null } });
  },
};
