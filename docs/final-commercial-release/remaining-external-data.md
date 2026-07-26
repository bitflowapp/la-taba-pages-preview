# Datos externos todavía necesarios

Todo lo resoluble sin información externa quedó implementado. Para convertir el
preview privado en staging con pedidos reales faltan exclusivamente insumos del
negocio y acceso autorizado:

## Catálogo aprobado

- identificadores externos y SKU definitivos;
- marca, nombre, variante, categoría y presentación exactas;
- precios vigentes aprobados;
- stock inicial y política de disponibilidad;
- alcohol, edad mínima y refrigeración;
- packs, orden, destacados y tags.

La plantilla lista para importar es `data/catalog-template.csv`. El release
productivo falla cerrado mientras no se indique un catálogo real mediante
`TABA_CATALOG_FILE` o argumento explícito.

## Imágenes oficiales

Por cada SKU visible se requiere master 1000×1000 y thumbnail 400×400, ambos
WebP, con fuente HTTPS, dominio, derechos de uso, identidad exacta de
producto/variante/capacidad y SHA-256. Sin una imagen exacta se conserva el
placeholder neutro y el producto no se publica como verificado.

## Datos operativos del negocio

- razón/nombre comercial definitivo;
- dirección de retiro;
- zonas y horarios;
- costo de envío y pedido mínimo;
- teléfono o WhatsApp autorizado, registrado por un owner/admin mediante el
  RPC server-side `set_business_whatsapp_contact`;
- medios de pago;
- riders y membresías reales.

## Runtime autorizado

- proyecto Supabase local o staging;
- URL y publishable key apta para navegador;
- usuarios de prueba por rol;
- `business_id` de staging;
- autorización para aplicar las doce migraciones y ejecutar smoke tests.

No se requieren cambios de arquitectura para cargar estos datos. Hasta que se
entreguen, el estado correcto es `listo para preview privada`; no `staging` ni
producción.
