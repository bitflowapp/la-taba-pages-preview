# TABA - Cierre V2.1 focal

## Alcance

Este cierre trabaja solo sobre copias de los prototipos aprobados. No modifica V1/V2 ni el repositorio de producto. La direccion visual sigue siendo "Mostrador Patagonico".

## Decisiones

1. Busqueda: cuando hay consulta el titulo es `Resultados`; la consulta queda en el input y, solo si no hay coincidencias, en `No encontramos «consulta»`. No se usa chip de consulta. La accion visible es `Limpiar busqueda`.
2. Packshots: CSS inmediato con `object-fit: contain`, sin recorte ni deformacion, y una caja visual de 78% del alto util cuando el asset lo permite. La normalizacion futura debe recortar margenes blancos del asset en pipeline, conservar etiqueta completa, centrar el objeto y publicar dimensiones/alpha verificables.
3. Popularidad: el copy unico es `Seleccion del local`. No implica metrica. Solo se podra usar un nombre como `Mas pedidos` cuando exista una metrica agregada de pedidos completados, ventana temporal explicita, volumen minimo y proteccion de privacidad.
4. Stack 320: carrito y navegacion conservan safe area, reserva derivada y targets tactiles. La barra de carrito queda separada de la navegacion; no se usan offsets absolutos para tapar contenido.
5. Negocio movil: los estados se mantienen completos; la fecha y sincronizacion no se recortan. Se omiten cliente frecuente, distancia y tiempos prometidos no disponibles. Cuatro columnas pasan a una composicion apilada cuando el ancho no alcanza.
6. Negocio desktop: 1024-1439 usa una accion sticky dentro del detalle; 1440+ usa el riel lateral. El override final de `.d-rail` queda despues de su definicion base. Hay exactamente una accion primaria operativa y la accion destructiva esta separada.
7. Codigo de entrega: negocio solo recibe estados de validacion (`Esperando validacion`, error o aprobado). Rider solo captura el codigo que informa el cliente. El frontend operativo nunca recibe el codigo correcto; backend lo valida por RPC.
8. Rider: CTA primaria de 60 px, slider de 68 px, secundarias de 48 px y zona inferior dentro de 160 px en las pantallas focales. `incident_pending` es resoluble y vuelve a `on_the_way` o termina en `cancelled`; `failed` es terminal, no reabrible, autorizado por backend/operacion y auditado.
9. Pinning: diferido en v1. Se priorizan TLS del sistema, auth, RLS, RPC, secure storage y sesiones revocables. Pinning solo se reconsidera con dominio controlado, rotacion, backup pins, telemetria y rollback.
10. Rider MVP: login, disponibilidad, pedido, pickup, estados, GPS, codigo, offline basico, recuperacion y logout/revocacion. Incidencias avanzadas, cambio de dispositivo, historial, metricas, antifraude y telemetria avanzada quedan posteriores.

## Aislamiento

Los datos visibles son sinteticos. Los prototipos cargan solo archivos locales del artefacto. La validacion registra y falla ante cualquier request a Supabase, `pageerror`, error de consola o desborde horizontal.
