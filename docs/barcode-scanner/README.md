# Lector de códigos de barras

## Alcance

La integración soporta lectores USB/Bluetooth que operan como teclado HID. No instala drivers propietarios ni afirma compatibilidad con un modelo físico no probado. Admite EAN-8, UPC-A, EAN-13 y GTIN-14 como texto, preserva ceros iniciales y valida el dígito de control. Los códigos internos están deshabilitados por defecto y nunca se presentan como GTIN.

## Configuración recomendada

- Sufijo: Enter o Tab.
- Prefijo: vacío; si se configura uno, una lectura sin él falla cerrado.
- Intervalo máximo entre teclas: 55 ms (rango admitido 20–250 ms).
- Limpieza del buffer: 180 ms (rango 60–2000 ms).
- Ventana de duplicado: 650 ms (rango 0–5000 ms).
- Captura global: deshabilitada. Usar el input dedicado para no interceptar escritura humana.

El scanner tiene modos separados para búsqueda, alta asistida, recepción, ajuste, conteo, POS y packing. Cambiar de pantalla desmonta o cambia el modo; no se mezclan lecturas entre operaciones.

## Checklist de hardware

1. Conectar el lector y confirmar en Bloc de notas que entrega sólo dígitos más Enter/Tab.
2. Probar un EAN-8, UPC-A, EAN-13 y GTIN-14 conocidos, incluyendo uno con cero inicial.
3. Probar un código con dígito incorrecto: debe rechazarse.
4. Probar unidad y pack del mismo producto; verificar `unit_factor` y stock resultante.
5. Probar lectura rápida repetida; la segunda dentro de la ventana debe marcarse duplicada.
6. Escribir lentamente en otro formulario; no debe capturarse como scan.
7. Repetir en recepción, conteo, POS y packing con el dispositivo físico definitivo.
8. Registrar fabricante, modelo, interfaz, layout de teclado, sufijo y resultado, sin guardar número de serie del dispositivo.

## Productos desconocidos

Una lectura desconocida no inventa nombre, marca, categoría, presentación ni precio. Puede crear un borrador con el GTIN; owner/admin completa y confirma los datos. El producto queda inactivo/no verificado hasta atravesar la autoridad de catálogo.

## Troubleshooting

- `UNSUPPORTED_FORMAT`: revisar longitud y prefijo.
- `INVALID_CHECK_DIGIT`: comparar etiqueta y lectura; no corregir el número manualmente.
- `NON_NUMERIC_GTIN`: desactivar prefijos alfanuméricos del lector o declararlos de forma explícita.
- Lectura parcial: aumentar `bufferTimeoutMs` o revisar el sufijo, sin desactivar el check digit.
- Doble alta: revisar la unicidad `(business_id, gtin)` y la ventana de duplicados.

El rollback operativo consiste en volver al input manual dedicado; no se elimina el binding del código ni el ledger para “arreglar” una lectura.

