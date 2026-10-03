# TABA2_RIDER_STAGING_LOGIN_3_OF_3_SUCCEEDED

Gate alcanzado. 2026-08-05, Moto G15 `ZY32LHS6PS` (motorola moto g15, Android 15 / SDK 35).
Agente RIDER_LOGIN_3_OF_3, PID 7116.

---

## 1. Hash androidTest completo

```
dba68a9af31ff957d94ed5b0b72ba9161f215ad75e0d9b055a02732f03468d79
```

436.826 bytes. El instalado en el dispositivo era el build viejo
`510ba3c66c12602af8e8e9dafbc5cb3c191c2f892d9edfdf30b558096351ce3b`, así que se
actualizó con `adb install -r -t`, se volvió a extraer del dispositivo y se
verificó igual al local. **No hizo falta recompilar**: no se tomó
`heavy-compute.lock`.

## 2. Hash target local y extraído

| | |
|---|---|
| esperado | `d64d688985f2a998694ac9e0851fab272db26e7905fbfa2344985a62ed781299` |
| local | idéntico |
| extraído del Moto | idéntico |

170.799.270 bytes. No se recompiló ni se reinstaló: el driver aborta si
`Assert-TabaDevice` detecta reinstalación.

## 3. Lock

Ruta canónica `D:\1212_claude-locks` **sigue sin poder crearse**: la raíz de
`D:\` concede sólo `ReadAndExecute` al usuario y la sesión no está elevada. Se
usó el fallback ya autorizado `D:\1212\_claude-locks`, que es además donde
convergió el agente storefront.

- Adquirido atómicamente (`New-Item -ItemType Directory`, sin `-Force`) a las
  **15:43:23Z**, con `owner.txt` completo.
- Liberado tras verificar que contenía `OWNER=RIDER_LOGIN_3_OF_3` y `PID=7116`.
- `storefront-pending.txt` no se tocó.

## 4. QaLoginTraceTest

`OK (5 tests)`, 0,126 s. Corrida antes de gastar ninguna rotación de
credencial. Los cinco casos: traza escrita y completa, corrida cortada que
igual deja traza, ausencia de secretos, cada valor dentro de un vocabulario
cerrado, y run-id inválido que nunca se vuelve una ruta.

Log: `../20260805-154323/qaloginTracetest.log`

## 5. Tabla 3/3

| Iter | runId | Clasificación | Email | Password | Envío | Sesión | Auth observable | Cola | Duración |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `eb206679…d683` | LOGIN_SUCCEEDED | ACTION_SET_TEXT, 29/29, exacto | ACTION_SET_TEXT, 48/48, con foco | ACTION_CLICK | sí | sí | sí | 14.946 ms |
| 2 | `5acb3e1b…6322` | LOGIN_SUCCEEDED | ACTION_SET_TEXT, 29/29, exacto | ACTION_SET_TEXT, 48/48, con foco | ACTION_CLICK | sí | sí | sí | 14.648 ms |
| 3 | `3254f2a1…72dc` | LOGIN_SUCCEEDED | ACTION_SET_TEXT, 29/29, exacto | ACTION_SET_TEXT, 48/48, con foco | ACTION_CLICK | sí | sí | sí | 14.896 ms |

Las tres con `emailIdentityMatch=true`, `formularioSinErrores=true`,
`botonHabilitado=true`, `formSubmitted=true`. Cada una relanzó la app en frío y
confirmó sesión persistida y cola visible antes de seguir.

Trazas: `iter-N/login-traza-sanitizada-N.txt`, 21 campos cada una.

## 6. PASSWORDS_ALL_DISTINCT

`True`.

Por iteración: longitud 48, formato válido (`^[A-Za-z0-9]{48}$`),
`controles=false`, `bordes=false`. Generadas con
`RandomNumberGenerator` y rechazo de sesgo. Comparadas en memoria por digest;
ni el contenido ni el digest se imprimieron ni se persistieron. Los digests se
descartaron en el `finally`.

## 7. Método de logout

Cierre normal de la aplicación, el mismo que usa una persona: menú
**Cuenta y sesión** → ítem **Cerrar sesión** → `SessionManager.signOut()`.

Se resolvió por el árbol de accesibilidad (`adb exec-out uiautomator dump
/dev/stdout`) y `input tap` sobre el centro del nodo. El éxito exige las dos
cosas a la vez: que `rider_session.enc` desaparezca y que la app vuelva al
formulario.

Se usó tres veces: para cerrar la sesión preexistente antes de empezar, entre
la iteración 1 y la 2, y entre la 2 y la 3.
`SESSION_RESET_FOR_NEXT_LOGIN=true` en ambos cortes.

**`rider_session.enc` nunca se borró con `run-as`.**

## 8. Capturas

Todas tomadas con la app realmente visible, después de relanzar, y verificadas
con firma PNG:

- `iter-1/cola-autenticada-1.png`
- `iter-2/cola-autenticada-2.png`
- `iter-3/cola-autenticada-3.png`
- `tercera-sesion-preservada.png`
- `verificacion-final-sesion3.png`

Muestran la barra "TABA2 Rider", el banner **Lista sincronizada** con hora de
última confirmación —prueba de una llamada autenticada exitosa tras arranque en
frío—, y la cola vacía. Sin email, sin user id, sin business id, sin tokens,
sin direcciones, sin nombres de clientes, sin pedidos humanos.

Las `login-fin-instrumentacion.png` se conservan como rastro del final de cada
corrida, no como evidencia de app visible: en ese instante el proceso de la app
ya murió.

## 9. Tercera sesión

Preservada. Verificada dos veces con arranque en frío (`force-stop` + relanzar):

- `rider_session.enc` presente, 1125 bytes, 12:58 local — de la iteración 3;
- cola visible, formulario de login ausente;
- banner de sincronización autenticada al día.

**No se rotó la contraseña final, deliberadamente.** Se comprobó en esta misma
jornada que la rotación invalida el refresh token y la app borra
`rider_session.enc` en el siguiente arranque: así arrancó hoy el dispositivo,
con la sesión del login único anterior ya destruida por la rotación final de
esa corrida. Rotar ahora habría destruido justo lo que el gate debe dejar en
pie. La contraseña murió con el proceso: no quedó en claro en disco, ni en el
dispositivo, ni en la evidencia, así que nadie la conoce.

## 10. Secret scan

Sobre todos los artefactos de texto: sin `service_role`, sin `sb_secret`, sin
`apikey`, sin `Bearer`, sin JWT, sin claves privadas, sin hex de 40+ fuera de
los run-id.

Única coincidencia: el reporte de la sesión anterior, que nombra esos patrones
como los que buscó y menciona el centinela ficticio
`qa-centinela@ejemplo.invalido` de la prueba focal.

En Git: el diff commiteado no lleva secretos. En argv: la contraseña nunca
viajó como argumento; entró por stdin de `adb exec-in`. En `-e` de
`am instrument` sólo viajaron `qaRunId` y `qaIteration`, que no son secretos.

## 11. Cleanup

| | |
|---|---|
| `cache/qa-smoke` | 0 entradas |
| `cache/qa-trace` | 0 entradas |
| DPAPI `C:\1212\taba-device-test-runtime\private` | 0 archivos |
| `no_backup` | sólo `rider_session.enc` |
| `files` | sólo `profileInstalled` (artefacto normal de Android) |
| Instrumentación colgada | ninguna |
| APK extraídos | borrados tras registrar hash |

Espacio: C: 13,35 GB · D: 80,02 GB · E: 2,25 GB libres.

## 12. Pedidos y claims, antes y después

| | Antes | Después |
|---|---|---|
| Pedidos del Rider QA (históricos) | 2 | 2 |
| Pedidos del Rider QA en vuelo | 0 | 0 |
| Claims del Rider QA | 0 | 0 |
| Pedidos en estado activo (cualquier rider) | 1 | 1 |
| — de ellos, del Rider QA | 0 | 0 |
| Pedidos `ready` | 0 | 0 |
| Membership | rider, activa, 1 total, 0 otros negocios | idéntica |

**No se creó ningún pedido QA** y no se ejecutó el smoke de 25 pasos. El pedido
`arrived` de otro rider es dato humano y no se tocó. Stock sin modificar,
LT-0030 intacto.

## 13. HEAD y Git

| Repo | Rama | HEAD | Estado |
|---|---|---|---|
| app | `codex/rider-map-staging` | `95294d9d36a6429a21a562ea6a48b8c9ecbf8523` | limpio, sin cambios |
| automatización | `test/taba2-rider-staging-smoke-automation` | `9c80f98` (era `610ad72`) | limpio |

Commit nuevo `9c80f98`: driver de 3 iteraciones y helpers de dispositivo, 2
archivos, +454/−2. Sin `git add .`, sin amend, **sin push**.

## 14. Bloqueos

Ninguno pendiente. Se resolvieron en el camino:

1. Ruta canónica de locks inaccesible sin elevación → fallback autorizado.
2. androidTest instalado desactualizado → reinstalado y verificado.
3. Sesión preservada de la corrida anterior → cerrada por UI normal.
4. **Defecto propio del driver**: leía la clasificación del stdout de
   `am instrument`, que en éxito son 74 bytes con `OK (1 test)` y nada más. La
   clasificación sólo llega a stdout dentro del mensaje de fallo de JUnit, así
   que daba vacío en toda corrida exitosa — justo el caso que el gate tiene que
   reconocer. Costó una corrida completa (evidencia en `../gate-3of3/`, con la
   traza que prueba que ese login sí había alcanzado LOGIN_SUCCEEDED).
   Corregido: la clasificación sale de la traza, y el stdout queda de respaldo
   para fallos que mueran antes de escribirla.

## 15. Ruta de artefactos

`D:\1212\artifacts\taba2-rider-login-3of3\gate-3of3-final\`

- `reporte.md` — este archivo
- `hashes.txt` — verificación de binarios
- `matriz.json` — 40 etapas con timestamp
- `iteraciones.json` — resumen por iteración
- `iter-{1,2,3}/login-traza-sanitizada-{1,2,3}.txt` — las tres trazas
- `iter-{1,2,3}/cola-autenticada-{1,2,3}.png` — capturas con la app visible
- `tercera-sesion-preservada.png`, `verificacion-final-sesion3.png`

Corrida fallida previa, conservada como evidencia del defecto y su diagnóstico:
`D:\1212\artifacts\taba2-rider-login-3of3\gate-3of3\`

---

## Declaración

**TABA2_RIDER_STAGING_LOGIN_3_OF_3_SUCCEEDED**

- 3/3 terminaron en LOGIN_SUCCEEDED;
- las tres contraseñas fueron distintas;
- las tres trazas existen y están completas;
- las tres sesiones fueron observables (`estadoAutenticadoObservable=true`);
- la tercera quedó preservada y sincronizando;
- no hay residuos ni secretos.

Detenido acá. No se creó pedido QA ni se ejecutó el smoke de 25 pasos.
