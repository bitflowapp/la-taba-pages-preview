# El vigía del planificador

Qué mira, qué necesita y cómo se lee cuando avisa. Para operar esto no hace
falta conocer ninguna conversación previa.

## Qué vigila, y por qué existe

Dentro del servidor hay un **barrido de alertas operativas**
(`taba-operational-alerts-sweep`) que corre cada 60 segundos por `pg_cron`. Ese
barrido detecta todo lo demás: pedidos trabados, pagos sin conciliar, stock
inconsistente.

Lo único que no puede detectar es **su propia ausencia**. Si `pg_cron` deja de
ejecutarlo, no queda nadie adentro para decirlo, y el sistema pasa a estar sin
supervisión mientras todos los tableros siguen en verde.

El vigía es un reloj de afuera. Le pregunta al servidor por su propio reloj:

```
POST <SUPABASE_URL>/rest/v1/rpc/check_scheduler_watchdog   {"p_source":"github_actions"}
```

El servidor mide la condición contra su base y contesta. **Esta sonda no puede
inventar una alerta ni silenciarla**: sólo pide que se mire el reloj y reporta
lo que le contestan.

| campo | qué dice |
|---|---|
| `healthy` | si el barrido corre al día |
| `last_run_at` | cuándo corrió por última vez |
| `age_seconds` | hace cuánto |
| `stale_after_seconds` | a partir de cuántos segundos se considera muerto (600) |
| `action` | qué hacer |

`healthy` ausente **no** es sano: un campo que falta significa que la respuesta
no es la que este informe sabe leer, y eso se trata como incidente.

## Dónde corre, y cada cuánto

| capa | dónde | cada cuánto | avisa por |
|---|---|---|---|
| GitHub Actions | `.github/workflows/scheduler-watchdog.yml` | 10 min | correo de GitHub al dueño del repositorio cuando el job falla |
| Cloudflare Worker | `services/scheduler-watchdog/wrangler.toml` | 5 min | (desplegable aparte, un entorno por proyecto) |

Con el umbral de 600 s del servidor, por la vía de GitHub la muerte del
planificador se descubre en **20 minutos como máximo**.

**Límites, dichos de frente.** GitHub no garantiza el minuto exacto de una tarea
programada y desactiva las tareas programadas de un repositorio sin actividad
durante 60 días. Por eso esta capa acompaña a las otras, no las reemplaza.

## Qué necesita configurado

**Nada.** Esa es la reparación del 2026-08-24.

Antes hacían falta dos cosas cargadas a mano —la variable `SUPABASE_URL` y el
secreto `SUPABASE_ANON_KEY`— y como no estaban, el flujo llevaba **133 corridas
fallando**, una cada diez minutos, durante días. Un vigía que no arranca es peor
que no tener vigía: ocupa el lugar y nadie busca otro.

La sonda resuelve la configuración por orden, y **siempre dice en el log cuál
usó**:

1. `SUPABASE_URL` (variable de repositorio) y `SUPABASE_ANON_KEY` (secreto de
   repositorio). Fuente explícita: gana siempre.
2. El `runtime-config.js` del sitio publicado, que es de donde **cualquier
   navegador** saca esos mismos dos datos.

### Por qué el segundo camino no afloja nada

La clave es **publicable por diseño**: viaja en el JavaScript de la tienda y la
autoridad real es RLS, no la clave. Leerla de ahí tiene además dos propiedades
que el secreto no tiene:

- no puede quedar desincronizada de la que producción usa de verdad;
- no hay nada que provisionar para que el vigía empiece a existir.

Comprobado contra el servidor real: la RPC contesta **200** con esa clave.

### Privilegios

La sonda **no usa ni necesita `service_role`**. Sólo lee un reloj. Un monitor
que se lleva la llave del administrador para mirar la hora es una superficie de
ataque a cambio de nada. Si algún día alguien propone ampliarlo, ese cambio
tiene que justificarse solo: hoy no hace falta.

### Si igual se prefiere la fuente explícita

| dato | dónde va | por qué |
|---|---|---|
| `SUPABASE_URL` | **Variable** de repositorio | es pública; marcarla secreta sólo le esconde información a quien opera |
| `SUPABASE_ANON_KEY` | **Secreto** de repositorio | publicable no es «da igual dónde quede»: un log de Actions no es lugar para una clave, aunque no sea secreta |

Settings → Secrets and variables → Actions.

## Cómo se lee la salida

Sana:

```
configuración   runtime-config.js del sitio publicado
servicio        taba-operational-alerts-sweep
ultima corrida  2026-08-24T03:32:00.033791+00:00
antiguedad      35
atrasado desde  600
accion          ninguna
El barrido corre al dia.
```

Incidente — el job falla y GitHub manda correo:

| lo que dice | qué pasó | qué hacer |
|---|---|---|
| `El barrido de alertas dejo de correr` | `healthy: false`: el servidor mismo declara el reloj muerto | revisar `pg_cron` en el proyecto de producción |
| `La sonda no pudo preguntar: el servidor contestó <código>` | Supabase respondió con error | mirar el estado del proyecto; si es 401/403, la clave cambió |
| `La sonda no pudo preguntar: no contestó en 20 s` | plazo vencido | red o proyecto caído |
| `La sonda no devolvio JSON` | llegó un cuerpo que no se entiende (típicamente un HTML de error de un proxy) | mirar el cuerpo en el log |
| `WATCHDOG CONFIGURATION MISSING: <nombre>` | no hubo fuente explícita **y** tampoco se pudo leer el sitio publicado | cargar el dato que nombra, o revisar por qué el sitio no sirve `runtime-config.js` |

El último caso nombra las variables **una por una**. El mensaje anterior decía
«falta `SUPABASE_URL` (variable) o `SUPABASE_ANON_KEY` (secreto)» y esa «o»
obligaba a adivinar entre dos pantallas distintas de GitHub.

## Correrlo a mano

```
node scripts/scheduler-watchdog-probe.mjs
```

Salida 0 = el barrido corre al día. 1 = incidente, o no se pudo saber.

Contra otro origen publicado:

```
TABA_PUBLIC_ORIGIN=https://otra.pages.dev node scripts/scheduler-watchdog-probe.mjs
```

Desde GitHub: Actions → *Scheduler watchdog* → *Run workflow*.

## Qué está probado

`tests/scheduler-watchdog-probe.test.mjs`, 12 casos, **ninguno sale a la red**:
configuración completa, falta la URL, falta la clave, faltan las dos, el
servidor no responde, plazo vencido, respuesta que no es JSON, condición sana,
condición que debe alertar, y que **la clave no aparezca en la salida ni cuando
algo falla**.

Ninguna prueba dispara la RPC real: hacerlo dejaría rastro en el registro de un
sistema de alertas por el sólo hecho de correr la suite.
