# TABA - Validacion Cierre V2.1

## Corridas

Directorio de trabajo: `C:\1212\artifacts\taba-opus-design-review\2026-07-31-v2\closure`

```text
node closure/capture.mjs
capturas=11 errores=0 supabase=0

node closure/validate.mjs
escenarios=12 fallos=0 supabase=0 pageerror=0 consola=0
```

La evidencia de maquina queda en `capture-results.json` y `closure-validation.json`. Las 11 capturas solicitadas estan en este mismo directorio.

## Validacion automatica aprobada

- Negocio 1024x768: 1 primaria visible, sticky dentro del detalle.
- Negocio 1280x900: 1 primaria visible, sticky dentro del detalle.
- Negocio 1440x1000: 1 primaria visible, riel lateral.
- Negocio 1920x1080: 1 primaria visible, riel lateral.
- Negocio movil 320x700 y 360x800: detalle completo, sincronizacion visible sin truncar, sin cliente frecuente, distancia ni tiempo prometido inexistente.
- Código correcto ausente en negocio y rider; rider muestra campos de entrada vacios y negocio sólo estado de validacion.
- Rider login, pickup, código e incidencia: CTA primaria 60 px, slider 68 px, secundarias 48 px y zona inferior dentro de 160 px.
- Stack catalogo 320x568: cero contenido tapado por carrito o navegacion; safe area y targets operativos conservados.
- Busqueda: titulo `Resultados`; la consulta aparece una vez en el mensaje empty y permanece en el input; no se genera chip de consulta; existe `Limpiar busqueda`.
- Packshot: ratio medido del elemento visual `0.78`, dentro de 70-82%, con `object-fit: contain`.
- Targets tactiles focales: todos los elementos auditados tienen al menos 44 px por lado aplicable.
- Overflow horizontal: 0 px en todos los escenarios.
- `pageerror`: 0.
- Errores de consola de aplicacion: 0.
- Requests a Supabase: 0.
- PII real: 0; los datos visibles son sinteticos y locales.

## Estados y contrato

- `incident_pending` se muestra como pendiente de resolucion y tiene salida a `on_the_way` o `cancelled`.
- `failed` se documenta como terminal, no reabrible, autorizado por backend/operacion y auditado.
- El frontend operativo nunca recibe el codigo correcto; backend valida por RPC.
- Pinning queda diferido en v1 con TLS del sistema, auth, RLS, RPC, secure storage y sesiones revocables.

## Limites de esta evidencia

La corrida usa Chromium local y no sustituye una prueba en dispositivo fisico para safe area real, teclado, VoiceOver/TalkBack, zoom o rendimiento. No ejecuta suites del repositorio ni toca el repositorio de producto.
