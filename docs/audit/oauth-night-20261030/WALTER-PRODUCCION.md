# Paso productivo para Walter — preparado, sin ejecutar

30/10/2026. **No implica GO productivo.** El registro sigue sin proyecto productivo; el OAuth de B y R-MKT-1 siguen pendientes. No se contrató infraestructura, se desplegó, se conectó a Walter ni se emitió un enlace para él.

## Infraestructura y presupuesto

| Componente | Plan preparado | Costo de referencia y decisión |
|---|---|---|
| Backend Supabase | Proyecto nuevo `la-taba-production`, `sa-east-1`, separado del QA Free; compute Micro inicial | Organización Pro nueva: desde **USD 25/mes**, con crédito que cubre una Micro. En una Pro existente, una Micro adicional puede agregar **USD 10/mes** si el crédito ya está usado. No se inspeccionó la factura de Luna Systems ni se creó un recurso. |
| Frontend y HTTPS | Proyecto/sitio aprobado de Cloudflare Pages, inicialmente `https://la-taba.pages.dev`; publicar primero en mantenimiento | Solicitudes estáticas gratuitas; si se usan Pages Functions se aplica el régimen Workers. Mantenerse en la cuota del plan aprobado; no cambiar el plan. |
| Dominio propio | Opcional; no hace falta comprarlo para disponer de HTTPS con `pages.dev` | No se eligió ni cotizó un dominio; requiere aprobación si se compra. |
| Respaldos | Backups diarios incluidos en Pro, más la copia cifrada y restauración del procedimiento existente | Pro incluye 7 días de backups. PITR es una opción separada desde **USD 100/mes**; no activada ni autorizada. |
| Avisos operativos / SMTP | Operador presente durante el piloto y canal de alertas decidido antes de apertura | No se eligió ni contrató SMTP de pago. No prometer monitoreo por correo/push si sólo hay Panel. |

Precios oficiales consultados el 30/10: [Supabase](https://supabase.com/pricing), [Cloudflare Pages/Functions](https://developers.cloudflare.com/pages/functions/pricing/), [límites de Pages](https://developers.cloudflare.com/pages/platform/limits/). Son referencias en USD, no una cotización final de la organización: confirmar facturación, consumo y presupuesto antes de crear. No se aceptó ningún gasto.

## Secuencia, con evidencia y autorización separadas

1. **Cerrar QA.** Reproducir la autorización como B, obtener consentimiento, APRO manual y todo el verificador de R-MKT-1. Aclarar con Mercado Pago cualquier restricción de TestApp/Marketplace que siga abierta. No usar la cuenta real de Marco para sustituir al vendedor de prueba.
2. **Autorizar infraestructura y despliegue.** Marco/Luna Systems aprueba presupuesto, organización y dominio. Crear el proyecto sólo entonces. Completar `deploy/environments.json` y el binding mediante `scripts/production/bind-production.mjs`, con un PR revisado y CI del SHA del binding. No usar QA ni un ref retirado como producción.
3. **Base y funciones.** Aplicar las 179 migraciones actuales en el orden certificado, desplegar las nueve funciones de Mercado Pago y las demás requeridas por el sitio. Comparar versiones/hashes, RLS, permisos de RPC y jobs; conservar backup y restauración verificada. Cualquier cambio desde la evidencia vigente requiere sus pruebas afectadas.
4. **Aplicación productiva.** El dueño revisa **La Taba Delivery `7677852968049976`**, distinta de TestApp. Confirma capacidad OAuth de terceros y permisos de cobro/devolución; registra el callback y webhook del proyecto nuevo. Ninguna credencial se regenera ni ningún permiso sensible cambia sin aprobación explícita. No repetir en producción un ajuste de QA suponiendo que tendrá el mismo efecto.
5. **Secretos por canal seguro.** Client ID/Secret de la integradora, firma webhook, clave AES-GCM, worker HMAC y claves técnicas de Supabase custodiadas por separado del cliente y del repo. Cargar los valores sólo en el entorno correspondiente. Mantener **ausente la llave final de cobro real** durante la vinculación. No se necesita contraseña, token ni código personal de Walter.
6. **Red y candados.** Verificar HTTPS, dominio, runtime apuntando al ref aprobado, CORS, callback y firma webhook; las comprobaciones omitidas no son PASS. Mantener sitio en mantenimiento y alcance de pagos `pilot`; sin autorizaciones anteriores ni checkout activo. Confirmar worker/ledger/expiración saludables, conciliación limpia y pausa/reversión accesibles.
7. **Walter vincula personalmente.** Con el backend ya aprobado, Walter entra con su sesión al Panel → Configuración → Mercado Pago → Conectar. El servidor genera un state de un uso y PKCE nuevos para ese comercio y callback. Walter revisa la app y la cuenta receptora y pulsa Autorizar en Mercado Pago. El backend verifica la identidad y el Panel muestra la cuenta vinculada, **con cobros todavía apagados**. No se entrega un enlace antes de tener ese destino real verificado.
8. **Compra y devolución controladas.** Walter decide y autoriza por escrito vendedor, comprador distinto, producto/cantidad, importe ARS, comisiones, devolución y condiciones de aborto. Ejecutar el preflight completo, incluidas sus comprobaciones manuales. Recién con esa autorización se carga la llave final y habilita la única compra exacta del piloto. La compra la paga una persona; el operador verifica los doce criterios y Walter confirma el ingreso en su cuenta.
9. **Devolución con evidencia.** Usar el camino autorizado e idempotencia. No declarar éxito si el proveedor rechaza o queda ambiguo. Si se devuelve desde la cuenta del vendedor, conciliar como externa y conservar ese origen: no certifica la API. El refund API sigue sin una prueba satisfactoria productiva.
10. **Apertura comercial aparte.** Sólo con compra/devolución verificadas, cero bloqueos críticos y la aprobación comercial separada de Walter. Nunca abrir como consecuencia automática de OAuth, de una CI verde o del primer cobro.

URLs que se registrarán **cuando exista el ref aprobado**; hoy son plantillas, no enlaces utilizables:

```text
Callback: https://<ref-productivo-aprobado>.supabase.co/functions/v1/mercadopago-oauth-callback
Webhook:  https://<ref-productivo-aprobado>.supabase.co/functions/v1/mercadopago-webhook
Sitio:    https://la-taba.pages.dev (o dominio expresamente aprobado)
```

Webhook: eventos Pagos y Vinculación de aplicaciones, clave legítima en servidor y firma HMAC validada. El dinero y la referencia se confirman leyendo al proveedor, no desde el retorno del navegador. El token del vendedor se cifra y se vincula al proyecto/entorno/app/comercio; no se exporta a la página.

## Reversión preparada

Ante cobrador incorrecto, duplicados, una firma inválida aceptada, dinero sin pedido o credencial expuesta:

1. Pausar cobros del comercio; no repetir operaciones inciertas.
2. Abortar/cerrar la autorización del piloto y retirar la llave final si corresponde.
3. Retirar la revisión productiva para cerrar globalmente el cobro si hace falta.
4. Conservar el acceso al proveedor mientras haya pagos/devoluciones pendientes; usar desconexión comprobada, nunca borrar a ciegas el grant necesario para conciliar.
5. Volver a funciones/sitio anteriores con evidencia de compatibilidad; no deshacer una migración financiera consumida sin revisar sus restricciones.
6. Usar restauración sólo con autorización y el procedimiento probado; preservar trazabilidad de operaciones posteriores al backup.

Comandos y verificación detallados: [PREFLIGHT de #161](../mp-closure-20261030/PREFLIGHT.md), [procedimiento de compra](../pilot-real-payments-20261026/PROCEDIMIENTO-COMPRA-REAL.md), [devolución](../pilot-real-payments-20261026/PROCEDIMIENTO-DEVOLUCION.md) y [entrega a Walter](../mp-closure-20261030/WALTER.md). No se ejecutó ninguno de los pasos de escritura productiva.
