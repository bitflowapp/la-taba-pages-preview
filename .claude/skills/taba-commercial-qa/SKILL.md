---
name: taba-commercial-qa
description: Compuerta comercial de TABA2 antes de publicar, desplegar o mostrar algo a un cliente. Usar cuando se pida revisar si algo está listo para publicar, auditar la góndola, verificar una tarjeta de producto o un combo, cerrar un release comercial, o decidir si una campaña puede salir. Emite un veredicto con evidencia y sabe bloquear por datos comerciales faltantes.
allowed-tools: Read, Grep, Glob, Bash
---

# QA comercial de TABA2 · la compuerta

Esta skill **no crea nada**: verifica y firma. Es la única que emite veredicto de
publicación. Cuando una casilla no cierra, el veredicto es:

```
BLOCKED BY COMMERCIAL DATA
```

seguido de la casilla exacta, el SKU o la superficie afectada, y qué persona o
qué dato la cierra. Un bloqueo sin destinatario no desbloquea a nadie.

## Antes de mirar nada: contar

Contar las filas del universo a revisar **antes** de decidir cómo trabajar. Por
encima de unas pocas decenas de SKUs no se lee el catálogo y se describe lo que
se vio: se deriva con los comandos de estado
(`references/gate-y-veredicto.md`) y se trabaja sobre sus conteos.

Un modelo que lee un CSV largo resume las filas a las que prestó atención y
después presenta eso como cobertura del catálogo, con números seguros y
equivocados. Si no se puede correr la derivación, decirlo y auditar una **muestra
declarada**, con el tamaño de muestra al lado de cada porcentaje. **Una lectura
muestreada nunca se presenta como auditoría completa.**

## Los diez controles

| # | Control | Autoridad |
|---|---|---|
| 1 | Precio confirmado y > 0 | `taba-pricing-promotions` |
| 2 | Stock contado y > 0 | `taba-pricing-promotions` |
| 3 | Imagen aprobada, manifestada y de la presentación real | `taba-catalog-management` |
| 4 | Presentación completa (envase, volumen, unidades) | `taba-catalog-management` |
| 5 | Copy sin promesa no verificable | `taba-copy-ux` |
| 6 | +18 coherente: flag, edad, propagación a combos, confirmación en checkout | esta skill |
| 7 | Búsqueda: el producto se encuentra por su nombre real y sus aliases | `taba-catalog-management` |
| 8 | Semántica de pack: unidades declaradas = unidades mostradas = unidades entregadas | `taba-catalog-management` |
| 9 | Semántica de combo: componentes reales, ahorro derivado, `chargeable` | `taba-pricing-promotions` |
| 10 | Carrito: entra lo comprable, con el precio vigente y el total que se cobra | esta skill |

Los controles 1–9 se **verifican** acá y se **resuelven** en la skill dueña. Esta
skill no reescribe la regla ajena: la ejecuta y cita al dueño.

## Formato del veredicto

Cada hallazgo lleva evidencia, severidad, confianza, impacto y decisión de dueño.
El vocabulario cerrado está en
[references/gate-y-veredicto.md](references/gate-y-veredicto.md).

| Hallazgo | Evidencia | Severidad | Confianza | Impacto | Decisión |
|---|---|---|---|---|---|
| … | `catalogo` / `manifiesto` / `codigo` / `captura` / `hipotesis` / `falta_dato` | `baja`…`critica` | `baja`…`alta` | `ingreso` / `confianza` / `riesgo` / `conversion` | `publicar` / `corregir` / `investigar` / `necesita_aprobacion` |

Reglas del informe:

- Separar **evidencia** de **hipótesis**. Una hipótesis marcada como tal es útil;
  una hipótesis presentada como hallazgo envenena el informe entero.
- Nombrar los datos que faltan. Un atributo ausente del export **no** es un
  atributo ausente del catálogo, y confundirlos es el error más común.
- Ordenar por impacto comercial, no por cantidad de filas afectadas ni por orden
  alfabético.
- Nada de lift ni de ROI proyectado. No hay medición que lo respalde.

## Veredictos posibles

- `LISTO PARA PUBLICAR` — las diez casillas cerradas, con evidencia citada.
- `LISTO CON OBSERVACIONES` — sólo si lo observado no toca precio, stock,
  imagen, edad ni semántica de pack/combo.
- `BLOCKED BY COMMERCIAL DATA` — falta un dato comercial. Nombrar cuál.
- `BLOQUEADO POR CONFLICTO DE DATOS` — dos fuentes se contradicen sobre un hecho
  verificable. No se elige ganador: se deriva a una persona.

## Qué nunca hace esta skill

- Publicar, desplegar, tocar staging o producción. Verifica y firma; ejecutar es
  otra sesión con su propio permiso explícito.
- Bajar el umbral para que algo pase.
- Aprobar una muestra y reportar cobertura total.
- Convertir un bloqueo en observación porque "es menor". Precio, stock, imagen,
  edad y semántica de pack/combo no admiten observación: bloquean.
