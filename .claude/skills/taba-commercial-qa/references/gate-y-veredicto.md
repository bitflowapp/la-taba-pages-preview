# Compuerta comercial: procedimiento y vocabulario

## Vocabulario cerrado del informe

Usar exactamente estos valores. Un vocabulario abierto vuelve incomparables dos
auditorías del mismo catálogo.

| Campo | Valores |
|---|---|
| Evidencia | `catalogo`, `manifiesto`, `codigo`, `captura`, `medicion`, `hipotesis`, `falta_dato` |
| Severidad | `baja`, `media`, `alta`, `critica` |
| Confianza | `baja`, `media`, `alta` |
| Impacto | `ingreso`, `margen`, `conversion`, `confianza`, `riesgo`, `carga_operativa` |
| Esfuerzo | `XS`, `S`, `M`, `L` |
| Decisión de dueño | `publicar`, `corregir`, `investigar`, `monitorear`, `necesita_aprobacion` |

`hipotesis` y `falta_dato` **no son severidades bajas**: son evidencias distintas.
Un hallazgo con evidencia `hipotesis` no puede tener confianza `alta`.

*(El esquema de evidencia/severidad/decisión está adaptado del estándar de salida
de un paquete público de skills de e-commerce; la procedencia está registrada en
`docs/COMMERCIAL-SKILLS-AUDIT.md`.)*

## Derivar el estado antes de opinar

```sh
npm run catalog:readiness          # estado de publicación por SKU
npm run catalog:readiness:check    # falla si difiere de lo versionado
npm run catalog:sheet:check        # planilla comercial
npm run catalog:prices:check       # pendientes de precio
npm run catalog:images:verify      # imágenes contra manifiesto
npm run catalog:release:validate   # compuerta de release del catálogo
npm test                           # incluye los contratos comerciales
```

Los tests que cubren esta compuerta, por si hay que leer la regla exacta:
`tests/commercial-price-contract.test.mjs`, `tests/catalog-release-gates.test.mjs`,
`tests/catalog-publication-authority.test.mjs`, `tests/combos.test.mjs`,
`tests/combo-backend-contract.test.mjs`, `tests/cart-recommendations.test.mjs`,
`tests/catalog-commercial-language.test.mjs`,
`tests/alcohol-category-inference.test.mjs`.

Cuando un test protege la regla, **el test es la cita**: vale más que cualquier
párrafo, porque falla si la regla cambia.

## Control 6 en detalle: +18

- `alcoholic` y `minimum_age` presentes y coherentes con la categoría.
- Falta cualquiera de los dos → la venta de alcohol **falla cerrada**.
- La restricción de un componente se propaga al combo entero.
- El checkout exige confirmación explícita cuando el carrito tiene alcohol, y
  guarda **sólo** timestamp y versión/edad de política.
- La entrega muestra "verificar edad" al repartidor.
- **No se almacena número, foto ni escaneo de documento.** Si una propuesta lo
  requiere, se rechaza en esta compuerta.
- La habilitación por comercio (habilitado, edad mínima, días, horarios, zona
  horaria) es una decisión humana con asesoramiento legal. Hasta que esté
  cerrada, la venta de alcohol permanece deshabilitada y los productos
  alcohólicos no disponibles.

## Control 10 en detalle: carrito

- Sólo entra lo comprable según la compuerta de precio y stock.
- El precio que se cobra es el vigente al momento de cobrar, no el que estaba en
  pantalla cuando la persona agregó.
- Un combo se cobra a precio de combo **sólo** si es `chargeable`.
- El total mostrado y el total cobrado son el mismo número, con el mismo
  redondeo.

## Cómo se cierra un bloqueo

Un bloqueo se cierra con un **hecho nuevo**, no con una relectura:

| Bloqueo | Lo cierra |
|---|---|
| Falta precio | el dueño del comercio carga el precio por la puerta comercial |
| Falta stock | alguien cuenta |
| Falta imagen | se produce el activo con procedencia y se manifiesta |
| Falta autoridad/derechos | decisión comercial documentada |
| Conflicto de datos | una persona con el producto en la mano |
| Falta política de alcohol | asesoramiento legal + decisión del dueño |

Escribir "revisado, sigue igual" no cierra nada. Si una compuerta se reabre sin
hecho nuevo, el informe anterior no era una compuerta: era una opinión.
