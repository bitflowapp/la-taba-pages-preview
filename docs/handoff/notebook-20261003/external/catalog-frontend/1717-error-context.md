# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: demo-realtime-reliability.spec.mjs >> cliente, negocio y rider convergen por UI con revisión y ACK
- Location: tests\e2e\demo-realtime-reliability.spec.mjs:22:1

# Error details

```
Test timeout of 45000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - button "Ir al inicio del comercio" [ref=e4] [cursor=pointer]:
      - strong [ref=e6]: TABA2
    - button "ENVIAR A Elegí tu dirección" [ref=e8] [cursor=pointer]:
      - img [ref=e10]
      - generic [ref=e13]:
        - generic [ref=e14]: ENVIAR A
        - strong [ref=e15]: Elegí tu dirección
      - generic [ref=e16]: ›
    - button "Sincronizado. Reintentar sincronización" [ref=e17] [cursor=pointer]: Sincronizado · 05:57 p. m.
  - main [ref=e18]:
    - generic [ref=e22]:
      - button "Abrir menú" [ref=e23] [cursor=pointer]:
        - img [ref=e24]
      - generic [ref=e26]:
        - heading "Tu pedido está en camino" [level=1] [ref=e27]
        - paragraph [ref=e28]: Calculando llegada
        - paragraph [ref=e29]: Última actualización hace 0 s
      - list "Progreso del pedido" [ref=e30]:
        - listitem [ref=e31]:
          - generic [ref=e33]: Confirmado
        - listitem [ref=e34]:
          - generic [ref=e36]: Preparando
        - listitem [ref=e37]:
          - generic [ref=e39]: En camino
        - listitem [ref=e40]:
          - generic [ref=e42]: Entregado
      - generic [ref=e43]:
        - img [ref=e45]
        - generic [ref=e49]:
          - strong [ref=e50]: Ubicación no disponible
          - paragraph [ref=e51]: El rider está en camino. La ubicación aparecerá cuando esté disponible.
      - region "Estado del rider" [ref=e52]:
        - img [ref=e54]
        - generic [ref=e61]:
          - generic [ref=e62]: Rider TABA2
          - strong [ref=e63]: En camino
          - generic [ref=e64]: Tu pedido va con él
      - group [ref=e65]:
        - generic "Pedido LT-0002 1 producto · Total $19.090 Ver detalles Productos del pedido" [ref=e66] [cursor=pointer]:
          - generic [ref=e67]:
            - generic [ref=e68]:
              - strong [ref=e69]: Pedido LT-0002
              - generic [ref=e70]: 1 producto · Total $19.090
            - generic [ref=e71]:
              - text: Ver detalles
              - img [ref=e72]
          - generic "Productos del pedido" [ref=e74]:
            - img "Coca-Cola Original" [ref=e76]
    - text: ✓ ✓ ✓ ✓ ✓ ✓
```