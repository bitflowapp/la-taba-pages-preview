# Salud del Auth · día 1

Herramienta nueva: `npm run production:auth:health`
(`scripts/production-auth-health.mjs`). **Sólo lectura.** Datos crudos:
`DAY1-AUTH-HEALTH.json`.

No es una plataforma de analítica: son siete preguntas contra la base y contra
la configuración, en un comando.

## Última corrida — 2026-08-17, después de revertir el arranque del owner

```
servicio de Auth   : contesta
correo             : remitente integrado · 2/hora
site_url           : https://la-taba.pages.dev
identidades        : 0 (anonimas 0 · con correo 0)
altas ultima hora  : 0 · ultimo dia: 0
sin confirmar      : 0 (mas de un dia: 0)
solicitudes        : 0 esperando (rider 0) · aprobadas 0 · rechazadas 0
equipo activo      : 0 (owners 0) · sesiones vivas 0
pedidos            : cerrados
eventos de identidad: 72 (ultimo dia 72)

A MIRAR:
  · sin SMTP propio: el alta publica no puede entregar el correo de confirmacion
  · el comercio no tiene owner: nadie puede aprobar una solicitud
```

Los dos avisos son correctos y están en ese orden a propósito: **el owner llega
después del SMTP**, porque va a crear su cuenta por la pantalla pública y eso
necesita el correo de confirmación. Los 72 eventos de identidad siguen ahí: la
auditoría del arranque revertido no se borra.

## Qué vigila, y con qué umbral

| pregunta | umbral | por qué |
|---|---|---|
| ¿el servicio de Auth contesta? | HTTP 200 | si no, no entra nadie |
| ¿hay SMTP propio? | avisa si no | sin él el alta pública no se completa |
| ¿el `site_url` es local? | avisa si lo es | los enlaces del correo no llegarían a ningún lado |
| identidades **anónimas** en una hora | **> 40** | un pico sin pedidos es abuso de alta: cuesta cuota y ensucia la tabla |
| cuentas **con correo** en una hora | **> 10** | un local no da de alta diez empleados en una hora |
| solicitud esperando hace más de | **48 h** | alguien está esperando y nadie miró la bandeja |
| owners activos | avisa si es 0 | sin owner nadie puede aprobar nada |

Los umbrales son de comercio, no estadística: se ajustan en las tres constantes
del encabezado del guion.

## Cuándo correrlo

* **El día 1 del piloto**, a la mañana y a la tarde.
* Después de cualquier cambio de configuración de Auth.
* Cuando alguien diga «no me llega el correo» o «no puedo entrar».

Complemento, no reemplazo, de `npm run production:health`, que mira la base y el
scheduler.
