# Runbook · el primer pedido real

Para la persona que opera. No hace falta consola ni SQL para **operar**; sí para
los chequeos previos, que los hace quien tiene las credenciales.

Estado al escribir esto: el entorno es **staging con Mercado Pago en TEST**. Este
runbook sirve igual para el ensayo con dinero de prueba; los dos puntos donde
cambia con dinero real están marcados **[DINERO REAL]**.

---

## Antes de empezar (quien tiene credenciales, 10 minutos)

```bash
# 1 · variables de la máquina que opera
export TABA_SECRETS=<carpeta de credenciales>      # sin esto todo se planta, a propósito

# 2 · tomar el lock del entorno compartido
#     D:\1212\_claude-locks\taba2-staging-mutation.lock  → STATUS=HOLDING
#     y, si se usa la Moto,  moto-g15.lock

# 3 · los 16 chequeos previos (sólo lectura, no toca nada)
cd D:\1212\worktrees\taba2-commercial-production-hardening\scripts\primer-pedido-humano
node preflight-gate.mjs

# 4 · foto del estado antes de mutar
node snapshot.mjs
```

`preflight-gate.mjs` sale con código 0 sólo si están las 12 condiciones duras.
**Si falla una, no se sigue.** Las que más caen: rider ocupado con otra entrega,
GPS del teléfono fuera de alta precisión, y el barrido operativo atrasado.

Chequeo de un solo comando que **no necesita credenciales** y dice si el motor de
alertas está vivo:

```bash
curl -s -X POST https://ukxqbgswjlibmnjemrzd.supabase.co/rest/v1/rpc/scheduler_heartbeat \
  -H "apikey: $(curl -s https://taba2-staging.pages.dev/runtime-config.js | sed -n "s/.*publishableKey: '\([^']*\)'.*/\1/p")" \
  -H 'Content-Type: application/json' -d '{}'
```

Tiene que responder `"healthy": true` y un `age_seconds` menor a 600.

---

## La corrida

### 1 · El cliente compra (una persona, en el teléfono)

En el sitio publicado: **Perfil → nombre y teléfono** → **dirección con el punto
confirmado en el mapa** → carrito → forma de pago → confirmar.

El pedido entra con `origin='production'`. Los sembrados de QA son `origin='qa'`:
por eso se distinguen sin ambigüedad.

**[DINERO REAL]** Antes de este paso, Mercado Pago tiene que estar en producción
*y* aprobado. El backend falla cerrado si no lo está — ver
`docs/payments/mercadopago/PRODUCTION_CHECKLIST.md`.

```bash
node esperar-pedido.mjs        # engancha el pedido y canta su código LT-XXXX
```

### 2 · El negocio lo recibe y lo prepara (Walter, desde el Panel)

El Panel se abre en el sitio con `?panel=1`. Walter ve el pedido entrante y lo
lleva por sus estados: **preparando → listo**. No necesita nada más.

```bash
node panel-abierto.mjs                  # deja el Panel abierto con sesión
# o, para operarlo desde afuera:
node panel-operar.mjs LT-XXXX --hasta-listo
```

### 3 · Vigilancia durante toda la entrega

```bash
node monitor.mjs LT-XXXX
```

### 4 · El Rider lo toma y retira

Hoy el reparto es **manual (cola/claim)**: el auto-dispatch NO está desplegado.

```bash
node cola-rider.mjs                     # qué ve el rider, con SU sesión
node verificar-presencia.mjs LT-XXXX    # con el rider parado en el local
```

### 5 · El recorrido

Caminando. Detenerse para tocar el teléfono, **nunca conduciendo**.

```bash
node medir-movimiento.mjs LT-XXXX       # ventana de 4 min (MINUTOS=6 para más)
node gps-vivo.mjs LT-XXXX               # ¿está publicando GPS real, ahora?
node timeline-fixes.mjs LT-XXXX         # captura contra llegada, y desorden
```

### 6 · Cierre en la puerta

```powershell
pwsh llegada-y-codigo.ps1
pwsh entregar.ps1
```

---

## Qué mirar en el cliente, en cada transición

- `idle → preparing → on_the_way → delivered`: **el mapa en los cuatro**, y el
  mismo lienzo, no una pantalla distinta;
- sin rider dibujado hasta que haya una ubicación real autorizada;
- en `on_the_way`: el marcador **no salta hacia atrás** ni reproduce fixes viejos
  (defecto histórico, cerrado en `7cb20e0`);
- en `delivered`: mapa + resumen, **sin** «ubicación no disponible» y **sin**
  botón de recentrar.

## Después: verificar que no quedó basura

- stock descontado exactamente una vez;
- pago en el estado correcto y conciliado;
- el pedido en el Panel con su historia completa;
- ningún pedido `origin='qa'` nuevo;
- ninguna alerta operativa abierta que no estuviera antes (comparar contra
  `snapshot.mjs`);
- `LT-0030` intacto: `arrived`, revisión 11, total 550. **No se toca nunca.**

## Al terminar

Pasar los locks a `CERRADO` con el resultado y el HEAD. Si se usó
`MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION`, **quitarla**.
