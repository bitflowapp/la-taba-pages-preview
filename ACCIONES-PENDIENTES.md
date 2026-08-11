# Acciones pendientes · exactamente quién hace qué

Ordenadas por lo que desbloquea más. Nada de esto lo puedo hacer yo: cada una
necesita una credencial que no existe acá, una decisión comercial, un clic en un
panel ajeno, o dinero real.

---

## A · Vos, técnico — desbloquea casi todo (15 minutos)

### A1 · Apuntar las credenciales

```bash
export TABA_SECRETS=<carpeta de credenciales de esta máquina>
```

Tiene que contener al menos `rider-map-qa-login.txt` y
`la-taba-staging-business-login.txt`. Sin esta variable **todo se planta a
propósito**, no adivina.

### A2 · Instalar y loguear el CLI de Supabase

```bash
npm i -g supabase        # hoy: "supabase: command not found"
supabase login           # el PAT de management anterior fue borrado
supabase projects list   # tiene que listar ukxqbgswjlibmnjemrzd
```

### A3 · Con eso ya corriendo, el preflight completo

```bash
cd D:\1212\worktrees\taba2-commercial-production-hardening\scripts\primer-pedido-humano
node preflight-gate.mjs      # 12 chequeos duros + contexto; exit 0 = todo en su lugar
```

Eso cierra de un saque: catálogo comprable, negocio abierto, envío y mínimo
reales, MP en TEST, rider libre, LT-0030 intacto, ARCA en cero, alertas abiertas
y frescura del barrido.

---

## B · Vos — los dos relojes externos de vigilancia (2 minutos)

Ambos están escritos y listos; falta el clic.

**B1 · Cloudflare Worker** (detección ≤ 15 min)

Abrir una vez la landing de Workers en el panel de Cloudflare para que cree el
subdominio `workers.dev` (error 10063 sin eso). Después:

```bash
cd services/scheduler-watchdog && npx wrangler deploy
```

**B2 · GitHub Actions** (detección ≤ 20 min, y **avisa por correo**)

Cargar el secreto de repositorio `SUPABASE_ANON_KEY` y pushear
`.github/workflows/scheduler-watchdog.yml` (cron cada 10 min).

---

## C · Walter — datos comerciales que no se pueden inferir

Ninguno de estos se puede sacar del código ni inventar.

1. **El pin del local.** Hoy `human_verified=false`, precisión 20 m. Hay que
   pararse en la puerta de Mendoza 827 y confirmarlo.
2. **Horarios reales** de atención y de delivery.
3. **Zona/radio de entrega**: hasta dónde se reparte.
4. **Costo de envío y pedido mínimo definitivos.** Los que hay hoy en staging
   ($150 y $350) hay que confirmarlos o cambiarlos.
5. **Precios y stock inicial** de apertura.
6. **Las 9 unidades bloqueadas por precio unitario** (`catalog:prices:check`):
   o se les pone precio, o quedan fuera de la góndola.
7. **Productos habilitados** para el día uno.
8. **Teléfono de contacto** que ve el cliente.
9. **Política de retiro/envío.**
10. **Si el piloto factura, y cómo** — ver `FISCAL-PILOTO-MANUAL.md`.

---

## D · Mercado Pago — para cobrar de verdad

Checklist completo en `docs/payments/mercadopago/PRODUCTION_CHECKLIST.md`.
Lo imprescindible:

1. Cuenta vendedora argentina verificada.
2. Aplicación TABA2 sin duplicados, con collector y application ID verificados.
3. Access Token y webhook secret **productivos**, cargados **sólo** como secretos
   Edge de Supabase. Nunca en el repo ni en el navegador.
4. Webhook y back URLs HTTPS finales configuradas en Mercado Pago.
5. `MERCADOPAGO_ENVIRONMENT=production` **y**
   `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved`. Sin el segundo, el backend
   falla cerrado — está implementado, no es una promesa.
6. `business_payment_settings.production_review_status = 'approved'`.

Para un smoke con dinero real hace falta además, sólo durante esa ventana:

```
MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION=I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE
```

**Y tu autorización explícita justo antes.** Quitar la variable al terminar.

---

## E · La decisión de fondo — sólo tuya

**No existe un entorno de producción.** Hay que elegir:

- **(a) Promover el proyecto actual** (`ukxqbgswjlibmnjemrzd`) a producción:
  cambiar `deploymentEnvironment`, apuntar un dominio propio, credenciales de MP
  productivas. Barato y rápido; el historial de QA convive con los pedidos
  reales, aunque ya están separados por `origin`.
- **(b) Crear un proyecto de producción nuevo**: 73 migraciones a aplicar,
  secretos nuevos, catálogo a importar, y el Rider a recompilar con
  `TABA_PRODUCTION_*`. Más limpio, bastante más trabajo.

**No avanzo con ninguna de las dos sin tu autorización explícita.**

---

## F · Físico — cuando A, C y D estén cerrados

El pedido controlado de punta a punta, con una persona caminando y la Moto G15.
Runbook completo en `RUNBOOK-PRIMER-PEDIDO-REAL.md`.
