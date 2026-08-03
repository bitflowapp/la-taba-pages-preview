# Rendimiento del release candidate

## Método local reproducible

`npm run performance:local` inicia el servidor estático sólo en loopback,
lanza Chromium headless y usa contextos nuevos. Ejecuta siete muestras en
1280×900 y siete en viewport móvil emulado 390×844. Mide carga inicial,
catálogo, búsqueda, actualización/render del carrito, tracking y desbloqueo con
render del panel. También genera diez notas fiscales A4 sintéticas con el bridge
compilado, verifica un único SHA-256 y mide tamaño/duración.

El JSON se escribe una sola vez en
`artifacts/performance/local-rc1.json`; incluye HEAD, host, navegador, muestras,
p50/p95, presupuesto y renglones `NOT_RUN`. El artefacto no se versiona.

## Resultado del host Windows

El JSON no versionado es la autoridad de cada corrida: registra CPU, memoria,
SO, Node, browser, HEAD, p50/p95, tamaño y SHA-256 determinista del PDF. Se debe
regenerar después del último commit y rechazar si su `gitHead` no coincide con
el manifest. Servidor y navegador corren en el mismo equipo, sin red real ni
backend remoto; esos números no se trasladan a otro dispositivo.

## Presupuesto de regresión local

Estos límites sólo comparan futuras corridas en el mismo host/loopback; no son
un SLA comercial ni un presupuesto de dispositivo físico.

| Métrica | p95 máximo local ms |
| --- | ---: |
| carga inicial | 1500 |
| catálogo | 750 |
| búsqueda | 150 |
| actualizar carrito | 650 |
| render carrito | 200 |
| tracking | 150 |
| panel y desbloqueo | 600 |
| PDF fiscal sintético | 200 |

El script falla si falta una métrica o excede el límite. Los márgenes absorben
variación observada entre corridas del mismo host; cualquier cambio de hardware
o browser exige nueva línea base identificada.

## Medición pendiente

Permanecen `NOT_RUN`: preference Mercado Pago, webhook, creación de pedido,
packing CAS y cierre PostgreSQL, Storage/descarga privada, spool e impresión
física, PC real del negocio identificado, Moto G15, iPhone, Wi-Fi, datos móviles
y red degradada. Se medirán en staging/piloto con correlación y condiciones
registradas. Un viewport emulado no certifica teléfono ni conectividad.
