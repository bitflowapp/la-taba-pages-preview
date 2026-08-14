# Sistema operativo comercial de TABA2 · las skills

Ocho skills chicas y especializadas que viven en `.claude/skills/`. Cada una se
carga sola cuando el pedido matchea su `description`, o se invoca por nombre.
Este documento explica cuál usar, quién manda sobre cada regla y cómo agregar la
próxima.

**Estas skills no modifican el producto.** Preparan, verifican y explican.
Publicar, desplegar o migrar sigue necesitando una sesión con permiso explícito.

## Las diez reglas de oro

Valen para las ocho skills. Están acá una sola vez, a propósito.

1. No inventar productos.
2. No inventar precios.
3. No inventar stock.
4. No inventar promociones.
5. Pack ≠ combo.
6. La imagen representa la presentación real.
7. El cliente nunca es autoridad de pagos ni de recompensas.
8. La información comercial mutable exige fuente actual.
9. La UX reduce fricción sin ocultar información relevante.
10. No se modifica producción sin compuerta explícita.

## Las ocho skills

| Skill | Para qué | Se activa con |
|---|---|---|
| `taba-catalog-management` | alta y auditoría de productos: identidad, presentación, imagen, clasificación, aliases | "agregá X", "revisá esta ficha", "no aparece en la búsqueda" |
| `taba-merchandising` | qué pieza va en cada superficie: hero, puertas, orden, cross-sell, campañas | "destacá X", "armá una campaña", "por qué muestra esto" |
| `taba-pricing-promotions` | precio, stock, descuentos, combos, promociones | "cargá el precio", "hacé un combo con 20% off", "por qué no se puede comprar" |
| `taba-commercial-qa` | la compuerta antes de publicar; veredicto con evidencia | "¿está listo para publicar?", "auditá la góndola" |
| `taba-reorder-retention` | recompra, dirección recordada, favoritos, checkout corto | "volver a pedir", "guardá los datos", "pedí lo de siempre" |
| `taba-loyalty` | diseño de Taba Puntos; hoy, cómo rechazar bien | "dale puntos", "programa de fidelidad", "premiá al cliente" |
| `taba-commercial-analytics` | eventos, métricas, embudos, privacidad de la medición | "medí la conversión", "agregá un evento", "armá un reporte" |
| `taba-copy-ux` | microcopy comercial rioplatense | "escribí el texto", "este copy suena a IA" |

## Quién es dueño de cada regla

Una regla tiene **un** dueño. Las demás skills la citan y derivan; no la
reescriben. Cuando dos skills explican la misma regla con palabras distintas, la
que se lee primero gana y la otra queda como trampa.

| Regla | Dueña |
|---|---|
| `identidad-producto` | `taba-catalog-management` |
| `clasificacion-pack-combo` | `taba-catalog-management` |
| `imagen-y-procedencia` | `taba-catalog-management` |
| `aliases-de-busqueda` | `taba-catalog-management` |
| `taxonomia-categorias` | `taba-catalog-management` |
| `edad-flags-producto` | `taba-catalog-management` |
| `estado-precio` | `taba-pricing-promotions` |
| `estado-stock` | `taba-pricing-promotions` |
| `derivacion-de-ahorro` | `taba-pricing-promotions` |
| `validez-de-promocion` | `taba-pricing-promotions` |
| `precio-de-combo` | `taba-pricing-promotions` |
| `superficies-y-slots` | `taba-merchandising` |
| `intencion-y-ranking` | `taba-merchandising` |
| `cross-sell-y-complementos` | `taba-merchandising` |
| `elegibilidad-de-campana` | `taba-merchandising` |
| `gate-de-publicacion` | `taba-commercial-qa` |
| `vocabulario-de-veredicto` | `taba-commercial-qa` |
| `edad-gate-checkout` | `taba-commercial-qa` |
| `cobro-del-carrito` | `taba-commercial-qa` |
| `revalidacion-de-recompra` | `taba-reorder-retention` |
| `datos-guardados-del-cliente` | `taba-reorder-retention` |
| `favoritos-y-compra-rapida` | `taba-reorder-retention` |
| `ledger-de-puntos` | `taba-loyalty` |
| `vocabulario-de-eventos` | `taba-commercial-analytics` |
| `definicion-de-metricas` | `taba-commercial-analytics` |
| `privacidad-de-la-medicion` | `taba-commercial-analytics` |
| `voz-y-microcopy` | `taba-copy-ux` |
| `verbos-de-cta` | `taba-copy-ux` |

El +18 aparece en cuatro skills y son cuatro reglas distintas: los **campos** del
producto, la **compuerta** del checkout, la prohibición de **recomendar** alcohol
sobre alcohol y el **aviso** que lee el cliente. Separarlas es lo que evita que
las cuatro se contradigan.

## Cómo se combinan

Un pedido real activa varias. El orden importa: **primero el dato, después la
plata, después el lugar, después las palabras, y la compuerta al final.**

```
"Agregá Fernet"
  taba-catalog-management  → identidad, presentación, imagen, clasificación
  taba-pricing-promotions  → ¿hay precio autorizado? (casi siempre: no)
  taba-commercial-qa       → veredicto: BLOCKED BY COMMERCIAL DATA
  taba-merchandising       → recién si queda comprable: dónde se muestra
```

```
"Creá Fernet + Coca con 20% de descuento"
  taba-pricing-promotions  → sin autoridad comercial no hay descuento. Corta acá.
```

```
"Volver a pedir"
  taba-reorder-retention   → revalida ítems, precio, stock, zona y horario
  taba-pricing-promotions  → los precios vigentes salen de acá
  taba-copy-ux             → cómo se cuenta lo que cambió
```

```
"Medí si el combo nocturno funciona"
  taba-commercial-analytics → embudo por campaña, con su alcance declarado
  taba-merchandising        → qué se mostró y por qué
```

Regla de corte: **si una skill necesita un dato que no existe, se detiene y lo
nombra.** No pasa el pedido a la siguiente con el hueco tapado.

## Fuentes de autoridad

El mapa único de "dónde se pregunta cada cosa" —archivos, comandos y qué
contesta cada uno— está en
[`.claude/skills/taba-catalog-management/references/fuentes-de-autoridad.md`](../.claude/skills/taba-catalog-management/references/fuentes-de-autoridad.md).

Las skills **no guardan** precios, stock, promociones vigentes, conteos ni reglas
legales. Enseñan dónde leerlos hoy. Un número copiado en una skill sobrevive al
día en que dejó de ser cierto, y nadie lo audita porque parece documentación.

## Reglas de seguridad del paquete

- Ninguna skill ejecuta scripts externos, instala paquetes ni descarga código.
- Ninguna skill contiene credenciales, tokens, claves de Supabase ni de Mercado
  Pago, ni datos personales. Tampoco enseña a obtenerlos: para eso está la
  documentación de operaciones, con su propio control.
- Las skills de análisis declaran herramientas de sólo lectura
  (`Read`, `Grep`, `Glob`). `taba-commercial-qa` suma `Bash` porque su trabajo es
  **correr las validaciones del repo**; no despliega ni muta datos remotos.
- Ninguna skill toca staging ni producción. Verificar no es publicar.
- Ninguna skill escribe rutas absolutas de una máquina ni datos de una entrega
  real.

## Cómo agregar una skill nueva

1. **Buscar el dueño primero.** Si la regla ya tiene dueño, la skill nueva no
   existe: se amplía la existente.
2. Carpeta propia en `.claude/skills/<nombre>/` con `SKILL.md`.
3. Frontmatter con `name`, `description` y, si corresponde, `allowed-tools`.
   Sólo esos campos: son los que aceptan todas las vías de distribución. Un campo
   extra rompe el empaquetado con un error duro.
4. `description` que diga **qué hace y cuándo usarla**, con las frases con las
   que alguien la pediría. Es lo único que decide si la skill se activa.
5. Cuerpo corto: hasta unas 120 líneas. Lo largo va a `references/` y se enlaza
   con una frase que diga cuándo leerlo.
6. Explicar el **porqué** de cada regla. Una regla sin motivo se aplica mal en el
   primer caso que no estaba previsto.
7. Agregar su fila a la tabla de dueños de este documento.
8. Agregar su caso a `tests/commercial-skills-pack.test.mjs` y, si tiene una
   decisión que se pueda equivocar, a `docs/COMMERCIAL-SKILLS-EVALS.md`.

## Verificación

```sh
node --import ./tests/test-bootstrap.mjs --test tests/commercial-skills-pack.test.mjs
```

Chequea estructura, frontmatter, tamaño, enlaces que resuelven, unicidad de
dueños, ausencia de datos volátiles congelados y ausencia de rutas locales. El
`npm test` del repo lo incluye.

Los resultados de las evaluaciones de comportamiento están en
[COMMERCIAL-SKILLS-EVALS.md](COMMERCIAL-SKILLS-EVALS.md), y la auditoría de las
skills externas revisadas en
[COMMERCIAL-SKILLS-AUDIT.md](COMMERCIAL-SKILLS-AUDIT.md).
