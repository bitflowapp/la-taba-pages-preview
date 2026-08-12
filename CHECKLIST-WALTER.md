# Lo que necesitamos de Walter

Un solo documento. Nada de esto se puede deducir del código ni del catálogo: son
decisiones del negocio. Está escrito en el formato en que después se carga, así
que sirve para completarlo tal cual.

Cuando esté completo, se cierra: horarios, zona, envío, mínimo y catálogo.

---

## 1 · El local

| Dato | Valor hoy | Qué necesitamos |
|---|---|---|
| Dirección | `Mendoza 827` | ¿está bien? |
| **Punto en el mapa** | cargado, **sin confirmar contra la puerta** | **Pararse en la puerta y confirmar el pin.** Hoy dice `human_verified=false` con 20 m de margen |
| **Teléfono de contacto** | **vacío** | el número que ve el cliente |
| **WhatsApp** | **vacío** | ¿el mismo? ¿otro? ¿ninguno? |

---

## 2 · Horarios

Hoy **el sistema no tiene dónde guardarlos**: acepta pedidos a cualquier hora.
Necesitamos la grilla completa, por canal.

Se pueden poner **varios tramos por día** (ej. corte del mediodía) y tramos que
cruzan la medianoche (ej. `20:00 → 02:00`).

**Delivery**

| Día | Abre | Cierra | Segundo tramo (si hay) |
|---|---|---|---|
| Lunes | | | |
| Martes | | | |
| Miércoles | | | |
| Jueves | | | |
| Viernes | | | |
| Sábado | | | |
| Domingo | | | |

**Retiro en el local** — ¿el mismo horario que delivery? Si no, la misma grilla.

| Día | Abre | Cierra | Segundo tramo |
|---|---|---|---|
| … | | | |

**Feriados y excepciones:** ¿cierra los feriados? ¿Hay días especiales?

---

## 3 · Zona de entrega

Tampoco existe hoy en el sistema. Hacen falta **dos cosas**:

**a) Hasta dónde se reparte.** La forma más simple y la que menos se equivoca es
por **barrio**. Listar los barrios a los que sí se llega:

```
Barrio                          Envío       Mínimo
──────────────────────────────  ──────────  ──────────
                                            
                                            
```

Si el envío y el mínimo son iguales en todos, se deja en blanco y se usa el
general del punto 4.

**b) ¿Hay un límite duro de distancia?** Ej. «nada a más de 5 km». Opcional, pero
evita que un barrio mal escrito habilite un reparto imposible.

> Un radio a secas no sirve acá: desde Mendoza 827 un círculo cruza el río y mete
> Cipolletti adentro. Por eso preguntamos por barrios.

---

## 4 · Envío y mínimo

| Dato | Valor cargado hoy | ¿Se confirma? |
|---|---|---|
| Costo de envío | **$150** | |
| Pedido mínimo | **$350** | |

Están cargados y el backend ya los aplica. Sólo hay que confirmarlos o
corregirlos.

---

## 5 · Catálogo — lo urgente

### 5.1 · Los 4 packs en la góndola *(esto es lo más importante)*

Estos cuatro están a la venta con **precio de pack**:

| Producto | Precio | Contiene |
|---|---|---|
| Coca-Cola Original 1500 ml | $19.999 | **6 botellas** |
| Sprite 1500 ml | $19.999 | **6 botellas** |
| Fanta Naranja 1500 ml | $19.999 | **6 botellas** |
| Coca-Cola Original 500 ml | $17.100 | **12 botellas** |

**Decisión:** ¿se sacan de la góndola, o se venden como pack diciéndolo claro? Tal
como están, un cliente puede pagar $19.999 creyendo que compra una botella.

### 5.2 · Duplicado

«Coca-Cola Original» aparece **dos veces** ($19.999 y $17.100). ¿Cuál queda?

### 5.3 · Un precio a confirmar

**Red Bull, lata de 250 ml: $3.576.** Es precio de unidad. ¿Es correcto?

### 5.4 · Stock real

Los stocks cargados (69 a 99) son de prueba. **Ningún producto tiene stock
confirmado.** Necesitamos el real de lo que se abre:

```
Producto                        Stock real
──────────────────────────────  ──────────
Coca-Cola Original                        
Sprite                                    
Fanta Naranja                             
Heineken                                  
Red Bull                                  
Imperial APA                              
Speed Unlimited                           
```

### 5.5 · Los 10 que sólo esperan stock

Tienen **precio ya confirmado** y no están cargados. Con decir el stock entran:

Coca-Cola Zero · Schweppes Tónica · Schweppes Citrus · Monster Mango Loco ·
Imperial Golden · Imperial Extra Lager · Imperial Cream Stout · Schneider Rubia ·
Corona Extra

**¿Cuáles se abren, y con cuánto stock?**

### 5.6 · Los 61 sin precio

Hay 61 productos en la planilla **sin precio**. ¿Entran al lanzamiento o quedan
para después? Si entran, necesitamos precio y stock de cada uno.

### 5.7 · Los 11 que están frenados

10 tienen la **imagen rechazada** y 1 está rechazado entero. ¿Se consiguen fotos o
quedan afuera?

---

## 6 · Alcohol

Ya está configurado: **mayores de 18, de 20:00 a 06:00**, hora de Buenos Aires.
¿Se confirma ese horario o cambia?

---

## 7 · Facturación

El sistema **no puede emitir comprobantes** hoy, y está bien que sea así hasta
homologar ARCA.

**Pregunta:** durante el piloto, ¿Walter factura por su medio habitual, fuera del
sistema? ¿Emite por cada pedido o de otra forma?

Detalle en `FISCAL-PILOTO-MANUAL.md`.

---

## 8 · Modalidad

| Dato | Hoy | ¿Se confirma? |
|---|---|---|
| Delivery | habilitado | |
| Retiro en el local | habilitado | |

---

## Resumen: 9 decisiones que bloquean

1. Confirmar el pin del local **parado en la puerta**
2. Teléfono y WhatsApp de contacto
3. Horarios de delivery y de retiro
4. Barrios a los que se reparte
5. Confirmar envío $150 y mínimo $350
6. **Qué hacer con los 4 packs**
7. Resolver el duplicado de Coca-Cola y el precio del Red Bull
8. Stock real de lo que se abre
9. Si el piloto factura, y cómo

Los puntos 3 y 4 además necesitan que se despliegue el modelo nuevo
(`DISENO-HORARIOS-ZONA-ENVIO.md`), que está diseñado y sin aplicar.
