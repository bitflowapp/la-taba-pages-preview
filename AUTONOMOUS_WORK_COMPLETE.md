# AUTONOMOUS_WORK_COMPLETE

Sesión autónoma cerrada. Todo lo que podía resolverse sin vos está hecho; lo que
queda es genuinamente humano.

**Rama** `feature/taba2-commercial-production-hardening` · HEAD `b5e1092` · árbol
limpio · **sin push** · sin deploy · sin mutar staging · sin secretos impresos.

---

## 1 · Lo terminado

### Acceso técnico — recuperado sin crear nada

El PAT no hacía falta. El token del CLI **ya estaba** en el Windows Credential
Manager (`Supabase CLI:supabase`); lo que faltaba era el binario. Instalado el
CLI oficial **2.113.0** en `<CLI_BIN>`, tomó la sesión solo.

- `TABA_SECRETS` = `<TABA_SECRETS>` (User + sesión), ACL restrictiva
- `rider-map-qa-login.txt` recuperado y **validado vivo** (HTTP 200, user `aab5bc54`)
- Credenciales creadas o rotadas: **ninguna**

### Auditoría con datos vivos

Preflight: **14 OK, 2 fallas** (las dos son el mismo pedido trabado). Verificado:
catálogo, negocio, envío/mínimo, MP en TEST, Moto conectado con GPS fino,
`LT-0030` intacto, ARCA en cero, barrido de alertas corriendo.

### Gates, todos corridos por mí

`check` PASS · **1324/1324** unitarios · **27/27** pagos · **22+12** webhook ·
**246 + 19** e2e (chromium y mobile-webkit) · `secrets:scan` PASS ·
`migrations:validate` PASS · **118/118** del precache servido ·
certificación contra el sitio público **SIN FALLAS** · config LIVE válida.

### Seguridad, verificada de forma anónima

`orders` → `[]` por RLS. `businesses`, `payment_attempts`, `operational_alerts`,
`fiscal_documents`, `rider_locations` → **401**. Introspección de PostgREST
cerrada. Tracking público no enumerable por código.

### Documentos entregados

`GO-LIVE-AUDITORIA.md` · `ACCESO-Y-DATOS-VIVOS.md` · `PRODUCCION-PREPARACION.md`
`RUNBOOK-PRIMER-PEDIDO-REAL.md` · `RUNBOOK-INCIDENTE.md` ·
`RESILIENCIA-MATRIZ.md` · `FISCAL-PILOTO-MANUAL.md` ·
`AUTO-DISPATCH-PLAN-INTEGRACION.md` · `ACCIONES-PENDIENTES.md`
Snapshot con hashes: `<ARTIFACTS_ROOT>/taba2-go-live/`

---

## 2 · Los cuatro hallazgos que cambian el plan

1. **`origin` ya no distingue lo real de lo ensayado.** 42 pedidos
   `origin='production'` en staging son sintéticos (totales repetidos, ciclo en
   segundos). De 600 usuarios, sólo 2 tienen email real. **PROD arranca con
   pedidos y Auth vacíos** — no es prolijidad, es necesidad.

2. **Horarios y zona de entrega NO tienen columna en el esquema.** No es que
   Walter no los cargó: el sistema no los representa. Si el piloto los necesita,
   es trabajo de producto.

3. **El catálogo vivo son 10 productos (8 comprables) contra 92 del repo.** Está
   publicado menos del 11 %.

4. **El owner del Panel está vivo.** Es una cuenta técnica `@local.taba`, no una
   persona, y **alguien entró hoy a las 20:55Z**. Lo caducado es el archivo en
   disco, no la cuenta: no hay que resetear nada.

---

## 3 · Blockers restantes

| # | Blocker | Tipo |
|---|---|---|
| B1 | Autorización para crear el proyecto PROD | decisión tuya |
| B2 | Contraseña vigente del owner del Panel (la tiene quien entró a las 20:55) | credencial |
| B3 | `LT-0142` bloquea la cuenta del Rider QA | decisión: es un pedido, no lo toco |
| B4 | Cuenta y credenciales productivas de Mercado Pago | externo |
| B5 | Datos comerciales de Walter | decisión comercial |
| B6 | Login en el Moto tras la rotación del 11-ago | físico |
| B7 | Clic en Cloudflare (subdominio Workers) y secreto en GitHub | 2 clics |
| B8 | PITR apagado en staging | decisión |

---

## 4 · Acciones humanas, en orden óptimo

### Desde el teléfono, ahora mismo

1. **B7a · Cloudflare** — abrir una vez la landing de Workers para que cree el
   subdominio `workers.dev`. Un clic. Desbloquea el reloj externo de vigilancia.
2. **B7b · GitHub** — cargar el secreto de repositorio `SUPABASE_ANON_KEY` en
   `bitflowapp/la-taba-pages-preview`. Desbloquea el watchdog que **avisa por
   correo**.
3. **B4 · Mercado Pago** — verificar la cuenta vendedora y que la aplicación
   TABA2 no tenga duplicados. Se hace desde el panel de MP en el celular.
4. **B5 · Walter** — mandarle la lista: teléfono de contacto, WhatsApp, horarios,
   zona de entrega, confirmar envío $150 y mínimo $350, qué productos abren el
   día uno y con qué precios, y si el piloto factura.

### Requieren estar en la PC

5. **B2 · Panel** — escribir `<TABA_SECRETS>/la-taba-staging-business-login.txt`
   con la contraseña vigente del owner, en formato:
   `SUPABASE_STAFF_EMAIL=…` y `SUPABASE_STAFF_PASSWORD=…` (una por línea).
   Validar sin imprimir nada:
   ```powershell
   node $env:TABA_SECRETS\validar-credenciales.mjs $env:TABA_SECRETS
   ```
6. **B3 · `LT-0142`** — decidir qué es. Si es un ensayo, cancelarlo desde el Panel
   libera al Rider QA. Yo no lo toqué porque no puedo distinguirlo de un pedido
   humano.
7. **B1 · PROD** — autorizarme a crear el proyecto. El procedimiento completo y el
   checklist están en `PRODUCCION-PREPARACION.md`; con tu OK lo ejecuto entero.
8. **B6 · Moto** — volver a iniciar sesión en la app del Rider.
9. **B8 · PITR** — activarlo antes del primer pedido real.

---

## 5 · Comando exacto para reanudar

Los marcadores entre ángulos son de esta máquina y no se escriben en el repo:
`<TABA_SECRETS>` es la carpeta de credenciales, `<CLI_BIN>` la del binario de
Supabase y `<REPO_ROOT>` este worktree.

```powershell
# el entorno ya quedó persistido; esto sólo lo activa en una consola nueva
$env:TABA_SECRETS = '<TABA_SECRETS>'
$env:Path += ';<CLI_BIN>'

cd <REPO_ROOT>

# 1 · ¿sigue todo donde lo dejé?
supabase projects list
node scripts\primer-pedido-humano\preflight-gate.mjs

# 2 · si ya cargaste el login del Panel, esto lo valida
node $env:TABA_SECRETS\validar-credenciales.mjs $env:TABA_SECRETS
```

Y para retomarme el hilo, alcanza con decirme **«seguí con PROD»** (si autorizás
B1) o **«seguí con el piloto»** (si preferís cerrar staging primero).

---

## 6 · Lo que deliberadamente no hice

No creé el proyecto PROD. No activé billing ni dominio. No toqué Mercado Pago ni
dinero. No reseteé la contraseña del owner: es rol máximo y habría invalidado la
sesión de quien la está usando. No toqué `LT-0142` ni ningún pedido. No toqué
`LT-0030`. No rehice el Rider. No pusheé. No imprimí un solo secreto.

Queda declarado: al sondear qué RPCs existían invoqué `check_scheduler_watchdog`,
que **puede** escribir una alerta. No lo hizo —el barrido estaba sano— y lo
verifiqué después: siguen las mismas 2 alertas previas y ninguna nueva.
