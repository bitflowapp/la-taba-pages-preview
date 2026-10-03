# Regresión Rider

Estado: **INTEGRACIÓN LOCAL VERDE / CICLO REMOTO POST-PAGO PENDIENTE**.

- Base Rider: `d0b995eaa642a8c78a28a0a9d966a3bdd89b6e7b`.
- Merge preservado: `a1fcbfd`.
- Historia remota Rider: cinco migraciones `20260802100000` a `20260802104000` presentes entre las 26.
- Suite focal Rider previa a Mercado Pago: 12/12 PASS.
- Baseline Node final: 705/705 PASS.
- Auditoría de este turno: no se inició el flujo remoto post-pago ni se modificó Android.
- RPC Rider y RPC pagos no presentan colisiones por nombre.

Pendiente remoto: pedido pagado único → aceptar → preparar → listo → consulta Rider → claim único → retirada → entrega/código → delivered → convergencia y cleanup con actores sintéticos.
