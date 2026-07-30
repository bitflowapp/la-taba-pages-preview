# Revisión de tracking y seguridad

## Veredicto

La revisión de código y pruebas no encontró defectos P0, P1 ni P2 reproducibles
después de las correcciones. El tracking comercial muestra estados reales y
oculta mapa, ruta y ETA cuando no existen datos confiables.

## DTO público

`get_public_order_tracking` exige un token bearer cuyo hash SHA-256 se almacena
separado. El DTO retorna sólo código público, modalidad, estado, timestamps
operativos, ETA confiable opcional, ubicación minimizada opcional y código de
entrega durante la llegada.

No retorna:

- teléfono o email;
- UUID del cliente, rider o negocio;
- dirección o referencia;
- notas internas;
- token o hash;
- historial GPS;
- ciphertext del código;
- membresías o datos de Auth.

## GPS

El mapa público sólo se habilita si el fix:

- pertenece al pedido solicitado;
- pertenece al rider actualmente asignado;
- fue sellado por el servidor;
- contiene coordenadas válidas;
- declara fuente GPS;
- tiene precisión entre 0 y 250 m;
- tiene menos de tres minutos;
- corresponde a `picked_up`, `on_the_way` o `arrived`.

Las coordenadas públicas se redondean a tres decimales y la precisión nunca se
presenta mejor que 100 m. Los estados terminales purgan la ubicación exacta.

## ETA y ruta

La ETA sólo se publica si viene de negocio o routing, fue actualizada en los
últimos quince minutos y aún no venció. La UI no transforma un estado en
minutos. Sin ETA válida se omite el valor. La UI no dibuja rutas sintéticas:
muestra como máximo la posición actual del rider.

## Contacto autorizado

El número guardado por sí solo no habilita un CTA. La migración de autoridad de
contacto agrega sellos server-side y el RPC
`set_business_whatsapp_contact`, limitado a owner/admin activo. El RPC valida
8–15 dígitos, invalida cualquier sello anterior al rotar el número y registra
actor y timestamp. Los clientes no pueden actualizar número ni verificación
directamente, ni seleccionar esos campos crudos desde `businesses`. La RPC
`get_public_business_contact` normaliza y devuelve el número únicamente cuando
el negocio está activo y el sello está completo; en cualquier otro caso no
devuelve filas. La UI exige simultáneamente número válido y autoridad
verificada; de lo contrario oculta toda la tarjeta de ayuda.

## Asignación y entrega

- `claim_available_rider_order`: rider autenticado, membresía activa y CAS.
- `assign_order_rider`: owner/admin/staff, rider activo y CAS.
- Reasignación limitada a etapas previas al retiro.
- GPS escrito por RPC, ligado al rider asignado y limitado por frecuencia,
  precisión y saltos.
- Handoff creado junto con el pedido; el código no se guarda en texto plano.
- Confirmación idempotente, asignada al rider y con bloqueo exponencial.
- Al entregar se revocan acceso sensible, GPS y token cuando corresponde.

## Revisión independiente

El revisor independiente ejecutó 66 pruebas focales, el check estático, la
validación de doce migraciones que existían en ese snapshot histórico y
`git diff --check`; todo pasó. El candidato contiene actualmente 17 migraciones
versionadas, cuya situación por entorno se registra por separado en la matriz
de release. El revisor también verificó respuestas RPC nulas, carreras de
asignación, swap de assets y valores numéricos fuera de rango.

## Límite de la evidencia

Este host no dispone de `psql`, Docker ni Supabase CLI y no recibió credenciales
de staging. Las migraciones fueron revisadas estáticamente pero todavía deben
aplicarse y smoke-testearse en un Supabase local o staging autorizado antes de
promover a producción.
