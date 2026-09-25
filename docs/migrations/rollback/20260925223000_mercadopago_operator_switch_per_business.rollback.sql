-- Rollback de 20260925223000: retira el interruptor de operador de Mercado Pago.
-- El estado de business_payment_settings NO se toca: lo que quedó encendido o
-- apagado sigue así. Las filas de auditoría con scope 'payments' se conservan,
-- por eso el alcance ampliado de business_config_audit también se conserva (es
-- un superconjunto del anterior y no habilita nada por sí mismo).
drop function if exists public.operator_set_mercadopago_for_business(uuid, text, boolean, text, boolean);
