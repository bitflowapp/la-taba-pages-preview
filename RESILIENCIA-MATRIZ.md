# Resiliencia · cada escenario contra su evidencia

Qué pasa cuando algo se rompe, y con qué se demuestra. Donde no hay evidencia,
lo dice.

| Escenario | Comportamiento | Evidencia | Estado |
|---|---|---|---|
| **Backend temporalmente offline** | El cliente degrada sin perder lo suyo: el carrito sobrevive a un catálogo que no carga, en vez de vaciarse | e2e `production-cart-persistence`: «un catálogo que no carga conserva el carrito en vez de vaciarlo» · 4/4 verdes en chromium y mobile-webkit | **Cubierto (cliente)** · el corte real del backend no se simuló |
| **Webhook duplicado** | Idempotente: `unique(external_reference)` y `unique(idempotency_key)`; una segunda notificación no crea un segundo pedido | esquema + `test:webhook` 22 Deno + 12 node, 0 fallos | **Cubierto** |
| **Webhook perdido** | No depende del webhook: `mercadopago-checkout-status` lee el pago del proveedor y finaliza; el worker reconcilia por `external_reference` | Edge Functions + `test:payments` 27/27 | **Cubierto** |
| **Pago aprobado sin pedido** | Rearmado idempotente desde el Panel; la segunda vez no anuncia un pedido nuevo | migración `20260809210000_recover_paid_checkout_order` + e2e `panel-order-recovery` 2/2 | **Cubierto** |
| **Pago `pending` que no avanza** | `payment_outbox` con `pending → claimed → processing → retry_wait → failed → dead_letter`; reintento con backoff y cola muerta que no se borra sola | esquema `payment_outbox_status_check` | **Cubierto (diseño)** · no ejercitado vivo |
| **Panel cerrado cuando entra un pedido** | No se pierde: el Panel lee de la base al abrir, con realtime `postgres_changes` **y** poll incondicional de 5 s | `BUSINESS-PANEL-HARDENING.md` · `business-order-intake.js` | **Cubierto** |
| **Rider offline** | La app encola los puntos del recorrido y avisa cuántos faltan; ninguna acción se da por confirmada hasta llegar al servidor | app Rider: `offline_queue_state.dart`, `service.queueSize`, avisos «Sin conexión: falta enviar N puntos» | **Cubierto** |
| **Pedido sin Rider** | Queda en la cola manual; el negocio puede cancelarlo con motivo desde el Panel. **El auto-dispatch no está desplegado**: no asigna solo | `AUTO-DISPATCH-PLAN-INTEGRACION.md` | **Cubierto, con la limitación dicha** |
| **Stock agotado** | `check (stock is null or stock >= 0)` a nivel tabla; las reservas vencen solas. El riesgo es vender de menos, nunca de más | esquema | **Cubierto** |
| **Venta con precio pendiente** | `products_price_status_check in ('confirmed','pending')`; lo pendiente no se cobra. Hoy hay **9 unidades bloqueadas por precio unitario** | `catalog:prices:check` | **Cubierto** |
| **Refresh / reload** | Carrito y sesión sobreviven; lo guardado se reconcilia contra el catálogo verificado y vence solo | e2e `production-cart-persistence` 4/4 | **Cubierto** |
| **Service worker viejo** | Un cliente que venía con `v60` migra solo a `v61` al entrar | certificación contra el sitio público: `cachés antes=["…v60…"]` → `["…v61…"]`, `controlado por worker=true` | **Cubierto, medido en vivo** |
| **Cliente recurrente** | Entra a «Seguir» y ve el mapa, sin rider ni destino inventados | misma certificación: `recurrente en Seguir → mapa=1 visible=true negocio=0 rider=0` | **Cubierto, medido en vivo** |
| **Alertas operativas** | El barrido corre y la sonda anónima lo confirma | `scheduler_heartbeat()` → `healthy:true`, `age_seconds=28` | **Cubierto, medido en vivo** |
| **Muerte del planificador** | Tres capas: trigger sobre tráfico real ✅, sonda pública ✅, relojes externos ❌ | `OPERATIONAL-RESILIENCE-HANDOFF.md` | **Parcial** — faltan 2 clics humanos |
| **Deploy que pisa la configuración** | El repo guarda un `runtime-config` vacío que **falla cerrado**. Si un deploy lo publica, el sitio no arranca | `config:check` rechaza el template; el LIVE (`57d8a007…`) pasa | **Cubierto**, con el control en `RUNBOOK-INCIDENTE.md` §0 |

## Lo que no se pudo ejercitar, y por qué

Cortar el backend, matar el worker o dejar sin red al Rider en vivo requieren
mutar el entorno compartido y credenciales que no están en esta máquina. El
diseño está verificado por esquema y por prueba; **la degradación real bajo falla
inducida queda pendiente para la corrida con acceso**.

Ninguno de esos huecos bloquea aceptar un pedido: bloquean poder afirmar cómo se
comporta el sistema el día que algo se rompa de verdad.
