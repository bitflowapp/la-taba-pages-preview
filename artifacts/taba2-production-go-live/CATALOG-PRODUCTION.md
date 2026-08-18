# Catálogo de producción · propuesta para el primer go-live

**Nada de esto está aplicado.** Marco pidió reportar antes de escribir.

## De dónde salen los precios

`catalog/products.json` — la autoridad comercial del repositorio: **92 productos**,
**20 con precio explícito** y sin alcohol. **No se inventa ningún precio**: se
reutiliza el que ya está escrito ahí, exacto.

Los precios son de **pack**, no de unidad suelta. Eso explica el número:

## Los cuatro propuestos

| producto | presentación | precio | stock inicial |
|---|---|---|---|
| Coca-Cola Original | Botella PET · 500 ml · **Pack x12** | **$17.100** | 8 |
| Coca-Cola Zero | Botella PET · 500 ml · **Pack x12** | **$17.100** | 8 |
| Sprite | Botella PET · 500 ml · **Pack x12** | **$17.100** | 8 |
| Fanta Naranja | Botella PET · 1500 ml · **Pack x6** | **$19.999** | 8 |

Cuatro bebidas reconocibles, **ninguna alcohólica** —`alcohol_sales_enabled` está
en `false` y no se toca—, todas con precio explícito en la autoridad del repo.

Stock **8** por producto: dentro del 5–10 que pidió Marco, suficiente para el
piloto y lejos de un stock infinito.

## Cómo se aplicarían

Con `scripts/import-product-catalog.mjs`, la herramienta que ya existe, sobre un
subconjunto de la autoridad. No se escribe `products` a mano.

## Lo que hay que confirmar antes

1. **Que estos cuatro productos y estos precios son los que La Taba quiere
   publicar.** Son plata de verdad de un comercio real: la decisión es de Marco,
   no del repositorio.
2. Que el stock 8 sirve para el piloto.

Si querés otros productos, otros precios u otro stock, se cambia acá y se aplica.
