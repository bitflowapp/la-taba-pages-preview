# GS1 Argentina: decisión (2026-09-28)

**Decisión: no se contrata ahora. No es un bloqueo para abrir.**

## Qué ofrecería

GS1 administra los códigos de barra (GTIN/EAN). Sus servicios de datos de producto (catálogos con fotos y fichas cargadas por las marcas) podrían dar:

- imágenes oficiales;
- descripciones normalizadas.

## Por qué no ahora

- **Las fotos ya tienen solución sin terceros.** La tienda publica con fotos propias sacadas en el local:
  - derecho `PROPIO`;
  - carga en lote desde el Panel;
  - aprobación del dueño.

  Es el camino que evita pedir permiso a cada marca. La investigación de derechos de 2026-09-27 mostró que las marcas prohíben reutilizar sus fotos sin permiso escrito (`docs/catalog/image-rights-research-2026-09-27.json`).
- **Los datos del catálogo ya existen.** Los 46 SKU de CP tienen:
  - nombre, marca, presentación y envase;
  - categoría y GTIN donde se relevó.

  Lo que falta es comercial (precio, stock, fotos), y GS1 no lo resuelve.
- **Costo y trámite.** Es una suscripción y un alta del comercio como usuario de datos. Para 46 productos no se justifica antes de validar la operación.

## Cuándo reconsiderarlo

- Si el catálogo crece a cientos de productos y sacar fotos propias deja de ser práctico.
- Si una marca exige usar su contenido oficial vía GS1 para vender con su imagen.
- Si se automatiza el alta por código de barra (el escáner del Panel ya lee GTIN) y conviene enriquecer la ficha desde una fuente oficial.

En ese momento:

1. Pedir a GS1 Argentina las condiciones de uso comercial de imágenes y datos en una tienda online.
2. Comparar el costo contra seguir con fotos propias.
3. Decidirlo como producto, no como bloqueo de apertura.

Relacionado:

- Issue #118 (Cepita): la presentación real se confirma con el comercio, no con GS1.
