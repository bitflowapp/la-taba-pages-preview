# Prompt: Delivery Proof Photo v1

Actuá como Staff Engineer frontend/producto. Implementá un PR chico y verificable para agregar prueba visual de entrega local-first, sin backend y sin Supabase Storage.

Repo:
`C:\1212\la-taba-pages`

Branch base:
`origin/main`

Crear branch:
`feature/delivery-proof-photo-v1`

## Objetivo

Permitir que el rider adjunte una foto de entrega antes o al marcar entregado. La foto debe quedar guardada dentro del pedido en el storage actual, visible para el negocio como miniatura/modal, y claramente documentada como evidencia local/demo hasta que exista backend/storage real.

## Alcance permitido

- Rider adjunta foto con `input type="file"` compatible con cámara mobile.
- Comprimir por canvas antes de guardar.
- Guardar proof en el pedido como metadata local:
  - `deliveryProof.photoDataUrl` o shape equivalente.
  - `deliveryProof.createdAt`.
  - `deliveryProof.source = "local-demo"`.
  - `deliveryProof.fileName` opcional saneado.
- Negocio ve miniatura y puede abrir modal simple.
- Cliente no necesita ver la foto en v1.
- Sin Supabase Storage.
- Sin backend real.
- Sin dependencias nuevas.
- Sin cambiar contratos públicos de repositorios salvo campo opcional tolerado.

## Reglas críticas

1. No inventar GPS.
2. No cambiar lógica de tracking honesto.
3. Supabase sigue opt-in.
4. No meter secrets.
5. No tocar `.idea/`.
6. No activar backend real.
7. No agregar dependencias.
8. No bloquear entrega si el comercio decide operar sin foto, salvo que el producto defina explícitamente lo contrario.
9. No guardar archivos enormes sin compresión.
10. No prometer evidencia legal productiva.

## UX esperada

- En rider, mostrar sección "Foto de entrega" cuando el pedido esté listo para reparto, en camino o arribando.
- Botón secundario claro: "Adjuntar foto".
- Preview local luego de seleccionar.
- Mensaje de privacidad: "Se guarda como evidencia local de esta demo. No se sube a un backend todavía."
- Al marcar entregado con foto, conservar la prueba.
- Si falla lectura/compresión, mostrar error claro y permitir seguir operando.
- En negocio, mostrar badge o miniatura "Foto cargada" en el pedido.
- Modal de negocio con imagen, fecha/hora y texto "Evidencia local/demo".

## Implementación técnica sugerida

- Crear helper en `js/core/delivery-proof.js`:
  - `validateProofFile(file)`.
  - `compressProofImage(file, { maxWidth, maxHeight, quality })`.
  - `buildDeliveryProof(photoDataUrl, metadata)`.
  - `attachDeliveryProofToOrder(order, proof)`.
- Actualizar estado/pedido con un campo opcional, preservando compatibilidad con pedidos viejos.
- Si el repo demo/http/supabase serializa pedidos, asegurar que el campo opcional no rompa normalización.
- Mantener storage local como límite explícito.

## Tests unitarios

- Rechaza archivos no imagen.
- Rechaza tamaños excesivos antes de comprimir si aplica.
- `buildDeliveryProof` normaliza metadata y timestamp.
- `attachDeliveryProofToOrder` no muta el pedido original.
- Pedidos viejos sin `deliveryProof` siguen hidratando.
- Marcar entregado conserva `deliveryProof`.
- Supabase opt-in no se modifica.

## Tests e2e

- Rider puede adjuntar foto mock y ver preview.
- Rider marca entregado y el negocio ve miniatura.
- Modal de negocio abre y muestra evidencia local/demo.
- Sin foto, el flujo de entrega actual sigue funcionando.
- Mobile 390x844 sin overflow ni CTAs tapados.

## Comandos obligatorios

- `npm run check`
- `npm test`
- `npm run test:e2e`
- `npm run release:folder`
- `git diff --check`

## Reporte final

- Branch.
- Base usada.
- Commit SHA.
- URL del PR draft.
- Archivos tocados.
- Resumen de implementación.
- Tests exactos.
- Riesgos restantes.
- Confirmar Supabase opt-in intacto.
- Confirmar tracking honesto intacto.
- Confirmar `.idea/` intacto.

## Fuera de scope

- Backend real.
- Supabase Storage.
- Firma legal.
- Reconocimiento facial.
- Geocoding.
- Push notifications.
- Offline queue.
- Multi-comercio.
