# La Taba: recuperación con infraestructura adicional de USD 0

**Estado: organización Free creada; proyecto bloqueado por el cupo gratuito de
la cuenta.** No se creó una base alojada de La Taba y no se ejecutaron compras,
cancelaciones o reembolsos con dinero real. No hay autorización de producción.

## Resultado verificable

| Recurso | Estado |
|---|---|
| Organización exclusiva La Taba | Creada, ID `tpdpuvnasszkcpdanxpk`, plan confirmado `free` |
| Proyecto `la-taba-recovery-test` | Rechazado por Supabase; no creado |
| Cupo Free disponible de la cuenta | **0 de 2** |
| Costo adicional solicitado/generado por esta intervención | **USD 0** |
| Luna Systems Pro / bitflow-production | Sin modificaciones; proyecto observado ACTIVE_HEALTHY |
| APEX y Estela | Sin pausa, eliminación, traslado ni cambio de plan; ambos ACTIVE_HEALTHY |

La creación de la organización se hizo con la API oficial, que sólo acepta
el nombre para esta operación. Después se consultó su plan antes de intentar
crear un proyecto. La solicitud del proyecto apuntó exclusivamente a la nueva
organización Free, sin addons ni cambio de instancia, suscripción o plan.
El conector MCP no tiene acceso a esa nueva organización; se usó la credencial
del CLI ya autorizada y la API oficial. No se ampliaron permisos del conector.

Evidencia: `deploy/recovery-free-organization.json`,
`2026-10-20-free-provisioning-attempt.json` y `2026-10-20-free-quota-evidence.json`.
Son metadatos sin tokens, contraseñas, correos de miembros ni claves API.

## Bloqueo comprobado: cuenta, no número de organizaciones

El Management API identifica a la cuenta actual como **Owner** de:

| Organización | Plan | Proyecto Free activo |
|---|---|---|
| APEX Agent Sintetico | free | apex-agent-demo-sintetico |
| Estela | free | estela-pilot |

Se cruzó el perfil autenticado con el user_id de los miembros, sin guardar
esos identificadores personales. El límite incluye los proyectos de todas las
organizaciones donde la cuenta es Owner o Administrator; crear otra organización
no concede otros dos proyectos. Los proyectos de Luna Systems Pro no se contaron
como Free. [Regla oficial](https://supabase.com/docs/guides/platform/billing-on-supabase#free-plan).

El intento real de crear `la-taba-recovery-test` recibió **HTTP 400**. Supabase
indicó que `bitflowapp` alcanzó el máximo de dos proyectos Free activos en
organizaciones donde es administrador o propietario. Esa respuesta confirma
el bloqueo; no se dedujo únicamente del conteo. El texto íntegro del error está
en la evidencia del intento.

El servidor menciona posibles cambios sobre proyectos existentes. No se
ejecutó ninguna de esas acciones: las instrucciones del usuario los protegen.
Tampoco se solicitó una suscripción paga, se reintentó en Pro ni se cambió el
propietario de otros proyectos. La organización nueva quedó vacía, disponible
para cuando exista un cupo válido.

## Preparación y controles de costo cero

- El target ahora apunta a **La Taba Free**, declara presupuesto USD 0 y marca
  `blocked_free_project_quota`. El ref y createdAt del proyecto permanecen null.
- El bootstrap rechaza Luna Systems Pro, otras organizaciones, un presupuesto
  distinto de cero y un plan diferente de Free. También vuelve a consultar
  la identidad y el plan de la organización antes de cualquier SQL.
- El provisionador es idempotente: verifica si el proyecto ya existe antes de
  solicitarlo. Frente al rechazo por cupo termina sin pause/delete/upgrade,
  transferencias, reintentos o fallback pago. Su modo predeterminado no escribe.
- El manifiesto conserva las **159 migraciones** y los grafos de las **13 Edge
  Functions**, con los hashes actualizados y destino Free. Las migraciones
  históricas no se reescribieron.
- Las tres correcciones financieras de Mercado Pago permanecen. El binding
  de recuperación sólo admite la app TABA2 Staging y credenciales de prueba;
  rechaza la aplicación productiva y autorizaciones de cobro real.
- Se preparó un límite de **un trabajo y una renovación de vendedor por
  invocación** del worker de recuperación. El handler real está probado con
  transporte sintético; esto reduce el riesgo de exceder la duración Free de
  150 segundos. Los entornos históricos conservan sus límites anteriores.
  No se afirma un tiempo de ejecución alojado medido.

## Datos conservados

El respaldo privado sigue con su hash original y conserva los **72 productos**
y sus valores de precio/stock históricos. No se publicó ningún producto ni se
cambió el catálogo. Sigue preparado el paso de cuarentena privada de 76
proyecciones: un negocio, 72 productos y tres agregados de pedidos. Los tres
agregados no son pedidos completos y no se convierten en transacciones.

No se inventaron usuarios, pedidos ni pagos históricos. No se cargaron datos
en APEX, Estela o bitflow-production para utilizar su infraestructura. Los
archivos de Storage originales y las identidades siguen sin respaldo completo.

## Límites concretos del plan Free para La Taba

Se consultaron los entitlements de **la nueva organización La Taba**, además
de la documentación vigente. No se probó carga ni rendimiento alojado, porque
el proyecto no llegó a crearse.

| Límite o diferencia | Dato verificado | Consecuencia concreta |
|---|---|---|
| Proyectos activos de la cuenta | 2, ya ocupados | Bloquea actualmente la creación |
| Edge Functions | 100 por proyecto; se necesitan 13 | El número de funciones no obliga a pagar |
| Duración Edge | 150 s en Free | Worker de recuperación preparado con lotes de uno; falta medirlo alojado |
| Bundle vía Management API | 5 MB por función | Verificar bundle final al desplegar; no se afirma despliegue completado |
| Base | 500 MB por proyecto | Medir tamaño tras aplicar migraciones; aún no medido |
| Realtime | 200 conexiones y 100 eventos/s | Medir flujo de catálogo/pedidos/stock dentro de estos límites |
| Archivo de Storage | 50 MiB máximo | Mantener validaciones de tamaño y MIME; no usar transformaciones pagas |
| Transformación de imágenes | No incluida | Usar originales/miniaturas ya aprobados, sin contratar el servicio |
| Backups automáticos / PITR | No incluidos | Necesita backup externo y ensayo de restauración; no activar addons |
| Logs | Un día de retención | Conservar evidencia saneada fuera de la retención corta |
| Protección HIBP de contraseñas | No incluida | No activar el toggle de Pro; conservar reglas de contraseña y roles/RLS |
| Pausa por inactividad | Posible tras baja actividad durante siete días | Documentar reanudación; no certificar continuidad comercial con esa posibilidad |

Fuentes: [facturación](https://supabase.com/docs/guides/platform/billing-on-supabase),
[límites Edge](https://supabase.com/docs/guides/functions/limits),
[pausa Free](https://supabase.com/docs/guides/platform/free-project-pausing),
y el snapshot de entitlements incluido en `2026-10-20-free-quota-evidence.json`.
No se propone una solución paga: el bloqueo actual es de cupo de la cuenta,
y no prueba una incompatibilidad funcional de La Taba con Free.

## Pruebas y evidencia de esta etapa

| Ejecución | Resultado | Alcance |
|---|---|---|
| Crear organización y consultar plan | PASS real | Organización La Taba Free confirmada |
| Crear proyecto gratuito | BLOCKED real, HTTP 400 | Cupo agotado; sin VM/proyecto creado |
| Node pagos + recuperación | **228 PASS, 0 fallas** | Incluye guardas Free y preservación de correcciones |
| Deno/Edge | **252 PASS, 0 fallas** | Red denegada; incluye handler real del worker con lote uno |
| Node del runner de webhooks | 12 PASS | Subconjunto repetido, no sumar a Node |
| Controles de check | 9 PASS | Sintaxis, configuración, assets, precache, higiene, identidad, ubicación, encoding y scanner de secretos |
| Auth/RLS/Storage/Realtime alojados | NO EJECUTADO | No hay proyecto de La Taba donde aplicarlos |
| OAuth/checkout/webhook/reembolso/cancelación de prueba alojados | NO EJECUTADO | Falta callback/backend; no se cambiaron URLs en MP |

La identidad de la credencial de prueba de MP fue comprobada en la etapa
anterior (HTTP 200, MLA, test_user). Ese hito no es una prueba de checkout.
Los logs pequeños de esta etapa se guardaron en el directorio de evidencias
de recuperación de D. No hubo descargas pesadas ni borrados para liberar espacio.

## Intervención manual necesaria, conservando los otros proyectos

Crear otra organización desde el dashboard con esta misma cuenta no resuelve
el cupo: ya se hizo y el servidor rechazó el proyecto. Las vías a costo cero
que requieren intervención son:

1. **Pedir a Supabase revisión del cupo gratuito o una excepción**, aportando
   el ID de La Taba, HTTP 400 y el mensaje guardado. No se garantiza que aprueben
   una ampliación gratuita. Se dejó un borrador local en
   `2026-10-20-free-quota-support-draft.md`; no se envió ningún mensaje.
2. Si existe **un propietario legítimo de La Taba con un cupo Free disponible**,
   puede crear su proyecto con su cuenta y otorgar la colaboración adecuada.
   No crear identidades ficticias ni compartir contraseñas. El límite de todos
   los Owner/Admin de la organización debe permitir la creación. Esa titularidad
   y sus permisos requieren una decisión humana y un recibo de destino revisado.

Para la segunda vía, el propietario legítimo debe iniciar sesión con su propia
cuenta y confirmar que le queda cupo. Si se usa la organización La Taba ya
creada, esa persona debe ser su titular y `bitflowapp` no puede permanecer como
Owner/Admin durante la creación, porque seguiría bloqueándola. Los cambios de
titularidad/colaboración serían **sólo en esta nueva organización vacía**, por
decisión manual de ambos propietarios, sin alterar APEX, Estela o Luna Systems.
Un rol de colaboración tiene que respetar sus permisos reales: si no permite
configurar Auth, secretos o desplegar, esas operaciones las hará el propietario.
No se enviaron invitaciones ni se cambiaron roles en esta sesión.

Cuando exista cupo válido para esta organización:

1. Abrir [La Taba en Supabase](https://supabase.com/dashboard/org/tpdpuvnasszkcpdanxpk),
   confirmar Free, seleccionar **New project**, nombre `la-taba-recovery-test`,
   región São Paulo y la instancia predeterminada gratuita, sin addons.
2. Si muestra nuevamente el límite o un importe no cero, detenerse. No tocar
   Luna Systems Pro ni cambiar otros proyectos.
3. Si el proyecto se crea, conservar la contraseña en el gestor seguro del
   propietario. Proveer sólo el ref y el recibo público del proyecto; no pegar
   claves ni contraseñas en el chat.
4. Completar el recibo de destino y verificar plan/costo antes de aplicar el
   paquete de 159 migraciones, Auth, RLS, buckets, Realtime y las 13 funciones.
5. Cargar la cuarentena privada y ejecutar el circuito real con cuentas de
   prueba, incluidos eventos repetidos, abandono, pendientes, rechazo,
   cancelación y reembolso. Registrar efectos únicos sobre pedido y stock.

**La Taba aún no está técnicamente operativa en Supabase alojado y no está
preparada para habilitar pagos reales.** La organización gratuita y el paquete
están preparados; el siguiente paso depende de resolver el cupo sin alterar
los otros proyectos ni generar cargos.
