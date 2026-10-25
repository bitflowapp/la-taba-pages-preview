# La Taba · evaluación comercial honesta (v167, 2026-10-25)

No modifica ningún dato comercial. Separa lo que **se puede mostrar hoy** de lo que **necesita una autorización
o una decisión del negocio** antes de vender. Detalle técnico y mediciones: [`INFORME.md`](./INFORME.md); bloqueos
de infraestructura y operación: [`../commercial-readiness-20261023/MATRIZ-GO-NO-GO.md`](../commercial-readiness-20261023/MATRIZ-GO-NO-GO.md).

> **Una compra demostrativa no es una compra real validada.** El checkout que se recorrió es el de la demostración:
> confirma un pedido en el propio dispositivo (sandbox local), sin cobrar, sin stock real y sin que nadie lo prepare.
> Ningún pedido real, pago real ni reembolso real se hizo ni se validó en esta etapa. El flujo de cobro con dinero
> ficticio del proveedor se certificó en QA en ramas anteriores; el primer cobro y el primer reembolso reales siguen
> pendientes (A7 de la matriz).

## 1. Lista para demostración

Comprobado en un Moto G15 físico (Android 15, Chrome 155) y en las suites automáticas (ver `INFORME.md` §8).

| Superficie | Estado | Qué se vio |
|---|---|---|
| Navegación | **Lista** | Home, Catálogo, Seguir, Carrito y Perfil; chips de categoría de 44 px; sin desborde horizontal de 320 a 699 px |
| Catálogo | **Listo** | Vitrina de 52 productos en grilla (foto grande) o **lista** (4 productos completos por pantalla, antes 2) con un botón junto al buscador |
| Fotografías | **Listas para mostrar** | 42 productos con foto verificada a ojo (sabor, tamaño, envase, pack/suelto) y 10 con placeholder honesto «Foto próximamente» |
| Búsqueda | **Lista** | Con aviso «Mostrando resultados de Cervezas · Buscar en todo» cuando un rubro acota la búsqueda |
| Carrito | **Listo** | Agregar y quitar con stepper, carrito flotante con total, mínimo de delivery |
| Checkout demostrativo | **Listo como demostración** | Entrega o retiro, total siempre visible, «Confirmar pedido» → «Pedido confirmado» **simulado** |
| Experiencia móvil | **Lista** | 60 fps de mediana al desplazar; actualización automática del PWA; recarga y compra sin conexión |

**Cómo mostrarlo a Walter hoy:** abrir `?demo=1&vitrina=neuquen20261024` (el aviso «Modo demostración: nada de esto es real»
queda visible a propósito). Aclararle dos cosas: (1) los precios que ve son los **vigentes de la góndola** (costo × margen),
no precios aprobados por él; (2) las fotos editoriales de banners e historias se ven en demostración porque son material de
muestra, **pero no se publican en producción** hasta tener autorización.

## 2. Pendiente de autorización comercial (no depende de ingeniería)

| Tema | Estado real | Qué falta y de quién |
|---|---|---|
| **Precios y márgenes** | Los 52 precios vigentes no tienen aprobación por producto: la propuesta está «pendiente_aprobacion_comercial». 14 en **conflicto de margen** y 6 **pendientes de comparación** (no se tocaron, ninguna rebaja automática). El costo mayorista se midió el 18/08 (68 días al medirlo) y 2 productos tienen costo **derivado**, no medido (`sprite-zero-2250ml`, `villavicencio-con-gas-500ml`) | Walter: aprobar o corregir cada precio y decidir los 14 + 6 |
| **Stock real** | Los 52 están en `BUSINESS_CONFIRMATION_REQUIRED` (stock sin confirmar por el comercio) | Walter: cargar el stock real |
| **Derechos de imágenes** | Fotos de producto: la autorización `TABA-AUT-2026-08-001` y sus ampliaciones están **declaradas** por el titular, con la evidencia documental **pendiente** (falta el acuerdo o el paquete de packshots de cada marca). 10 productos sin foto. **18 fotos editoriales** (banners, hero, historias) vienen de portfolios y sitios de terceros y **no están cubiertas**: en producción no se publican | Walter: documentar el acuerdo de fotos; aportar o aprobar las 10 que faltan; autorizar o reemplazar las 18 editoriales |
| **Cuenta de Mercado Pago de Walter** | App «La Taba Delivery» sin verificar y Client Secret expuesto el 6/10 (A3); vendedor distinto del dueño de la app sin demostrar (A4); primer cobro y primer reembolso reales de control (A7) | Walter y el operador, con la cuenta real; este trabajo no usó ninguna credencial comercial |
| **Infraestructura de producción** | **No existe el proyecto de producción** (A1); `la-taba.pages.dev` sirve una tienda contra una base borrada (A9); recuperación ante desastres parcial (A5) | Luna Systems (alta de un proyecto de pago) y Marco |
| **SMTP y operaciones reales** | Sin proveedor de correo propio (C4); facturación electrónica apagada por decisión de Walter y su contador (C2); horarios, envío y catálogo real por completar (A6) | Walter y su contador; alta del proveedor de correo |

## 3. Veredicto

| | |
|---|---|
| **Para mostrar La Taba a Walter (demostración)** | **Sí.** Se recorre de punta a punta en el teléfono, con todo lo de la sección 1 |
| **Para vender a clientes reales** | **No.** Faltan las seis decisiones de la sección 2; la v167 no autoriza ningún lanzamiento |
| **Respaldo estable** | v165 (#152, `b070b4ae`) no se tocó y sigue siendo la candidata estable |
