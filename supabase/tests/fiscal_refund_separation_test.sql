-- UN REEMBOLSO NO ES UNA NOTA DE CRÉDITO
--
-- Devolver plata por Mercado Pago y anular fiscalmente una factura son dos actos
-- distintos: la nota de crédito se pide a mano (request_credit_note, con tope en
-- el saldo acreditable) y ningún código que toque reembolsos crea comprobantes.
-- Esta prueba fija esa separación en el esquema. Transaccional.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ~* '(payment_refunds|refunded_amount|refund)'
      and p.prosrc ~* '(insert\s+into\s+(public\.)?fiscal_documents|request_credit_note|request_full_credit_note|insert\s+into\s+(public\.)?fiscal_credit_allocations)'),
  0, 'ninguna función que toque reembolsos crea un comprobante o una nota de crédito');

select is(
  (select count(*)::integer from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and c.relname in ('payment_refunds', 'payment_intents', 'payment_cancellations')
      and p.prosrc ~* '(insert\s+into\s+(public\.)?fiscal_documents|request_credit_note|fiscal_credit_allocations)'),
  0, 'ningún disparador de pagos emite comprobantes fiscales');

select * from finish();
rollback;
