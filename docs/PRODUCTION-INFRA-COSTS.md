# TABA2 · Costos de infraestructura de producción

Techo confirmado por Walter: **USD 25 / mes** para infraestructura nueva.

Precios verificados el **2026-08-14** contra la documentación pública del
proveedor. Lo que no pude verificar va marcado `TO VERIFY` y **no se estimó**.

---

## PLAN USD 25 — qué entra exactamente

| Componente | Plan | USD/mes | Verificado |
|---|---|---|---|
| **Supabase — organización NUEVA, 1 proyecto (producción)** | Pro | **25,00** | ✅ supabase.com/pricing |
| Compute del proyecto (Micro, ~USD 10) | cubierto por los USD 10/mes de crédito de compute que trae Pro | **0,00** | ✅ |
| **Cloudflare Pages** — sitio estático + dominio propio + HTTPS | Free | **0,00** | ✅ requests a activos estáticos «free and unlimited» |
| **Cloudflare Worker** — reloj de vigilancia, cron `*/5` | Free (100.000 req/día; el cron usa 288) | **0,00** | ⚠️ `TO VERIFY` — ver nota 1 |
| **GitHub Actions** — segundo reloj, cron `*/10`, avisa por correo | incluido | **0,00** | ✅ |
| **Supabase — organización actual con staging** | Free | **0,00** | ✅ Free = 2 proyectos por organización |
| **Backups diarios, 7 días de retención** | incluido en Pro | **0,00** | ✅ |
| **Volcado lógico nocturno fuera de Supabase** (`supabase db dump`) | corre en GitHub Actions | **0,00** | ✅ |
| **ARCA / puente fiscal** | no se despliega (flujo manual) | **0,00** | ✅ |
| | **TOTAL MENSUAL** | **USD 25,00** | |

### Lo que consume el presupuesto y lo que sobra

**Sobra USD 0,00.** Supabase Pro se lleva el techo entero. Todo lo demás está en
plan gratuito porque el sistema no necesita más (ver §1 de
`PRODUCTION-ARCHITECTURE.md`), no porque se haya recortado algo.

Fuera de ese total queda **una sola cosa que sí hay que pagar**: el dominio.

| Concepto | Costo | Verificado |
|---|---|---|
| Dominio (`.com`, `.com.ar` u otro) | **`TO VERIFY`** — anual, no mensual | ❌ no verificado |

Cloudflare Registrar vende al costo del registro mayorista, y `.com.ar` se
registra en NIC Argentina con su propio arancel en pesos. **No invento la cifra.**
Amortizado, un dominio típico suma alrededor de un dólar por mes, lo que deja el
total real apenas por encima del techo. Es una decisión de una línea:
o se acepta ese excedente, o el dominio se paga aparte como gasto anual.

### Nota 1 · el cron del Worker

La página de precios de Workers documenta los Cron Triggers dentro del plan
Paid (USD 5/mes) y **no afirma** que estén disponibles en Free. No pude
confirmarlo en la documentación pública, así que queda `TO VERIFY`.

**No es un riesgo para el presupuesto**, porque hay dos capas más de vigilancia
que no dependen de ese Worker: el cron de GitHub Actions (gratis, y además avisa
por correo) y la comprobación que dispara el tráfico real. Si el cron gratuito
de Workers no existiera, la decisión correcta es **quedarse sin esa capa**, no
pagar USD 5 que sacarían el total del techo.

---

## Lo que NO entra en los USD 25, y por qué

### Point-in-Time Recovery — descartado

| Concepto | USD/mes | Verificado |
|---|---|---|
| PITR, 7 días de retención | **100,00** | ✅ supabase.com/pricing |
| Compute mínimo que PITR exige (Small) | **15,00** | ✅ «must also use at least a Small compute add-on» |
| Supabase Pro | 25,00 | ✅ |
| **Total con PITR** | **≈ 140,00** | **5,6× el techo** |

**PITR queda fuera. Esto corrige un checklist anterior.**
`PRODUCCION-PREPARACION.md` (§6 y §8) exige «PITR encendido antes del primer
pedido real». Ese requisito es **incompatible con el presupuesto** y hay que
reemplazarlo, no arrastrarlo:

**Lo que se contrata en su lugar** — backups diarios con 7 días de retención,
incluidos en Pro, más un volcado lógico nocturno fuera de Supabase.

**Lo que eso cuesta en riesgo, dicho de frente:** el peor caso de restauración
pierde hasta **24 horas de pedidos** en lugar de los ~2 minutos que daría PITR.

**Por qué es tolerable en este piloto, y bajo qué condición deja de serlo:**

- El volumen del piloto es bajo: 24 h de pedidos es una cantidad que se puede
  reconstruir a mano.
- **El dinero no vive sólo en nuestra base.** Mercado Pago es el registro
  autoritativo de todo pago: si hay que restaurar, los cobros del día se
  reconstruyen desde la cuenta de Mercado Pago y desde los recibos de webhook.
  Un pedido perdido es un problema operativo, no un problema de plata perdida.
- El volcado nocturno reduce la ventana y, sobre todo, deja **una copia fuera de
  Supabase**, que es la única protección real contra perder la cuenta entera.

**Condición de revisión:** cuando el volumen haga que perder un día de pedidos
sea inaceptable, PITR pasa a ser obligatorio y el presupuesto tiene que subir a
~USD 140/mes. No hay un punto intermedio: Supabase no vende retención más corta
y más barata.

### Servidor / VPS — no se recomienda

**No hace falta un servidor, y no hay que contratar uno sólo porque hay
presupuesto.** El sistema entero corre sobre servicios gestionados y archivos
estáticos. El detalle componente por componente está en §1 de
`PRODUCTION-ARCHITECTURE.md`.

---

## COSTO EXTRA EVENTUAL — el puente fiscal ARCA

Éste es el **único** componente técnicamente obligatorio que no entra en los
USD 25 — y **no es DAY-1**.

**Veredicto: POST-LAUNCH.**

**Por qué no puede vivir donde vive todo lo demás:**

`services/arca-fiscal-bridge` es un servicio Node 22 de proceso largo, con un
worker de artefactos, `node-forge` para el certificado X.509 que ARCA exige y
`pdf-lib`/`qrcode` para generar el comprobante. Necesita **estado en disco**
(certificado y clave privada) y **un proceso vivo**. Ninguna de las dos cosas la
da una Edge Function, que es efímera y sin disco persistente.

**Por qué no es DAY-1:**

- Hoy hay **0 comprobantes emitidos** y la automatización no está desplegada.
- La puerta de activación exige **9 condiciones** más una frase escrita a mano.
  El sistema no puede facturar ni por accidente.
- El piloto opera con el flujo manual ya documentado: Walter emite el
  comprobante por su medio habitual, fuera del sistema. **Ninguna parte del
  circuito comercial** —precio, stock, reserva, pago, Panel, Rider— depende del
  módulo fiscal.

**Cuándo se convierte en obligatorio:** cuando el negocio decida facturar
electrónicamente desde TABA2. Eso es una decisión de Walter y de su contador, no
un requisito técnico del lanzamiento.

**Cuánto costaría entonces:** `TO VERIFY`. Un VPS pequeño alcanza de sobra para
la carga, pero no verifiqué precios de proveedores y no los invento. Antes de
contratar hay que medir además: renovación del certificado ARCA, dónde vive la
clave privada y quién la rota.

---

## Lo que este documento no cubre

- **Comisión de Mercado Pago por venta.** Existe y es real, pero es un costo
  **transaccional** que sale de cada venta, no infraestructura mensual. La tarifa
  vigente para Checkout Pro en Argentina queda `TO VERIFY` — hay que leerla en el
  panel de la propia cuenta de Walter, que es donde figura la que le aplican a él.
- **Egreso por encima de lo incluido.** Pro trae 250 GB de egreso y 100.000
  usuarios activos mensuales. Un piloto de un local de bebidas no se acerca. Si
  alguna vez se acercara, el excedente es USD 0,09/GB y USD 0,00325 por usuario.
- **Disco por encima de 8 GB.** Excedente USD 0,125/GB. Una base sin pedidos
  heredados arranca en unos pocos MB.

---

## Decisiones que hay que tomar antes de contratar

1. **Aceptar backups diarios en vez de PITR** (o subir el presupuesto a ~USD 140).
2. **Quién paga el dominio y con qué extensión** — es el único gasto que no cabe
   en el techo.
3. **Confirmar que staging se queda en el plan Free.** Si staging se mudara a la
   organización Pro, el compute del segundo proyecto agrega ~USD 10/mes y rompe
   el techo.

**No se contrató nada. No se activó facturación. No se registró ningún dominio.**
