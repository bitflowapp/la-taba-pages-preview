# -*- coding: utf-8 -*-
"""Edición que RESPETA los finales de línea del archivo.

Escribir con Python en modo texto convierte CRLF a LF y deja un diff de miles
de líneas donde hubo cinco: pasó el 2026-08-25 con js/ui.js (8597 líneas de
ruido). Acá se detecta el final de línea del archivo y se restituye al escribir.
"""
import io, sys

def reemplazar(ruta, pares):
    crudo = open(ruta, 'rb').read()
    crlf = crudo.count(b'\r\n') > 0
    s = crudo.decode('utf-8')
    if crlf:
        s = s.replace('\r\n', '\n')
    for viejo, nuevo in pares:
        n = s.count(viejo)
        if n != 1:
            raise SystemExit(f'{ruta}: el texto aparece {n} veces, no una:\n{viejo[:120]}')
        s = s.replace(viejo, nuevo)
    if crlf:
        s = s.replace('\n', '\r\n')
    open(ruta, 'wb').write(s.encode('utf-8'))
    return ruta
