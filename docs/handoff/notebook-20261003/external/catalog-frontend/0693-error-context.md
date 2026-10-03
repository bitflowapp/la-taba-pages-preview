# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: taba2-brand-home.spec.mjs >> el seguimiento con pedido activo se lee sobre el shell oscuro
- Location: tests\e2e\taba2-brand-home.spec.mjs:558:1

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for locator('.mobile-nav [data-nav-view="cart"]')

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - button "Ir al inicio del comercio" [ref=e4] [cursor=pointer]:
      - strong [ref=e6]: La Taba
    - button "ENVIAR A Avenida Argentina 450" [ref=e8] [cursor=pointer]:
      - img [ref=e10]
      - generic [ref=e13]:
        - generic [ref=e14]: ENVIAR A
        - strong [ref=e15]: Avenida Argentina 450
      - generic [ref=e16]: ›
    - button "Ver mi pedido" [ref=e18] [cursor=pointer]:
      - generic [ref=e19]:
        - img [ref=e20]
        - generic [ref=e23]: "2"
  - main [ref=e24]:
    - text: Agregado ✓ Agregado ✓
    - generic [ref=e26]:
      - generic [ref=e27]:
        - img [ref=e29]
        - searchbox "Buscar productos o marcas" [ref=e32]
      - generic [ref=e33]:
        - button "Todas" [pressed] [ref=e34] [cursor=pointer]:
          - img [ref=e36]
          - generic [ref=e41]: Todas
        - button "Favoritos" [ref=e42] [cursor=pointer]:
          - img [ref=e44]
          - generic [ref=e46]: Favoritos
        - button "Cervezas" [ref=e47] [cursor=pointer]:
          - img [ref=e49]
          - generic [ref=e52]: Cervezas
        - button "Energizantes" [ref=e53] [cursor=pointer]:
          - img [ref=e55]
          - generic [ref=e57]: Energizantes
        - button "Gaseosas" [ref=e58] [cursor=pointer]:
          - img [ref=e60]
          - generic [ref=e62]: Gaseosas
        - button "Aguas" [ref=e63] [cursor=pointer]:
          - img [ref=e65]
          - generic [ref=e67]: Aguas
        - button "Ver más categorías" [ref=e68] [cursor=pointer]:
          - img [ref=e70]
          - generic [ref=e74]: Más
        - button "Aguas saborizadas" [ref=e75] [cursor=pointer]:
          - img [ref=e77]
          - generic [ref=e79]: Aguas saborizadas
        - button "Isotónicas" [ref=e80] [cursor=pointer]:
          - img [ref=e82]
          - generic [ref=e85]: Isotónicas
        - button "Fernet y amargos" [ref=e86] [cursor=pointer]:
          - img [ref=e88]
          - generic [ref=e90]: Fernet y amargos
        - button "Aperitivos" [ref=e91] [cursor=pointer]:
          - img [ref=e93]
          - generic [ref=e96]: Aperitivos
        - button "Vinos" [ref=e97] [cursor=pointer]:
          - img [ref=e99]
          - generic [ref=e101]: Vinos
        - button "Espumantes y sidras" [ref=e102] [cursor=pointer]:
          - img [ref=e104]
          - generic [ref=e106]: Espumantes y sidras
        - button "Destilados" [ref=e107] [cursor=pointer]:
          - img [ref=e109]
          - generic [ref=e112]: Destilados
        - button "Mixers" [ref=e113] [cursor=pointer]:
          - img [ref=e115]
          - generic [ref=e117]: Mixers
        - button "Hielo" [ref=e118] [cursor=pointer]:
          - img [ref=e120]
          - generic [ref=e123]: Hielo
      - generic [ref=e124]:
        - heading "Todas" [level=1] [ref=e125]
        - paragraph [ref=e126]: 80 productos
      - generic [ref=e127]:
        - group [ref=e128]:
          - generic "Filtros" [ref=e129] [cursor=pointer]:
            - generic [ref=e130]: Filtros
            - generic [ref=e131]: ⌄
          - option "Todas las marcas" [selected]
          - option "7UP"
          - option "Alamos"
          - option "Amstel"
          - option "Aperol"
          - option "Bombay Sapphire"
          - option "Bonaqua"
          - option "Bosque"
          - option "Brahma"
          - option "Britvic"
          - option "Budweiser"
          - option "Buhero"
          - option "Campari"
          - option "Chandon"
          - option "Cinzano"
          - option "Coca-Cola"
          - option "Corona"
          - option "Cristal"
          - option "Eco de los Andes"
          - option "Fanta"
          - option "Fernet Branca"
          - option "Fin del Mundo"
          - option "Gancia"
          - option "Gatorade"
          - option "Glaciar"
          - option "H2OH!"
          - option "Heineken"
          - option "Imperial"
          - option "Ivess"
          - option "Johnnie Walker"
          - option "Levité"
          - option "Manaos"
          - option "Martini"
          - option "Monster"
          - option "Norton"
          - option "Paso de los Toros"
          - option "Patagonia"
          - option "Pepsi"
          - option "Powerade"
          - option "Quilmes"
          - option "Red Bull"
          - option "Rutini"
          - option "Schneider"
          - option "Schweppes"
          - option "Speed"
          - option "Sprite"
          - option "Stella Artois"
          - option "Tanqueray"
          - option "Trapiche"
          - option "Trumpeter"
          - option "Villavicencio"
          - option "Vittone"
          - option "Todas las capacidades" [selected]
          - option "200 ml"
          - option "250 ml"
          - option "310 ml"
          - option "330 ml"
          - option "354 ml"
          - option "355 ml"
          - option "400 ml"
          - option "450 ml"
          - option "473 ml"
          - option "500 ml"
          - option "600 ml"
          - option "700 ml"
          - option "710 ml"
          - option "730 ml"
          - option "750 ml"
          - option "950 ml"
          - option "995 ml"
          - option "1 L"
          - option "1,5 L"
          - option "2 L"
          - option "2,25 L"
          - option "4000 g"
          - option "Todas las presentaciones" [selected]
          - option "Botella"
          - option "Botella PET"
          - option "Lata"
          - option "Unidad"
          - option "Con y sin alcohol" [selected]
          - option "Con alcohol"
          - option "Sin alcohol"
          - option "Toda disponibilidad" [selected]
          - option "Disponible"
          - option "No disponible"
          - option "Todos los precios" [selected]
          - option "Con precio"
          - option "Precio próximamente"
        - generic [ref=e132]:
          - generic [ref=e133]:
            - img [ref=e134]
            - generic [ref=e136]: Recomendados
          - combobox "Ordenar productos" [ref=e138]:
            - option "Recomendados" [selected]
            - option "Menor precio"
            - option "Destacados"
      - generic [ref=e140]:
        - article [ref=e141]:
          - generic [ref=e142]:
            - button "Ver Red Bull Energy Drink" [ref=e143] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Red Bull Energy Drink" [ref=e144]'
            - button "Guardar Red Bull Energy Drink 250 ml · Lata de favoritos" [ref=e145] [cursor=pointer]:
              - img [ref=e146]
          - generic [ref=e148]:
            - heading "Red Bull Energy Drink" [level=3] [ref=e149]
            - paragraph [ref=e150]: 250 ml · Lata
            - generic [ref=e151]:
              - strong [ref=e154]: $ 3.576
              - generic "Cantidad de Red Bull Energy Drink 250 ml · Lata en el pedido" [ref=e156]:
                - button "Restar uno de Red Bull Energy Drink 250 ml · Lata" [ref=e157] [cursor=pointer]:
                  - generic [ref=e158]: −
                - strong [ref=e159]: "2"
                - button "Sumar uno de Red Bull Energy Drink 250 ml · Lata" [ref=e160] [cursor=pointer]:
                  - generic [ref=e161]: +
                - text: Agregado ✓
        - article [ref=e162]:
          - generic [ref=e163]:
            - button "Ver Speed Unlimited Original" [ref=e164] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Speed Unlimited Original" [ref=e165]'
            - button "Guardar Speed Unlimited 473 ml · Lata de favoritos" [ref=e166] [cursor=pointer]:
              - img [ref=e167]
          - generic [ref=e169]:
            - heading "Speed Unlimited" [level=3] [ref=e170]
            - paragraph [ref=e171]: 473 ml · Lata
            - generic [ref=e172]:
              - strong [ref=e175]: $ 2.925
              - button "Agregar Speed Unlimited 473 ml · Lata al pedido" [ref=e177] [cursor=pointer]:
                - generic [ref=e178]: +
        - article [ref=e179]:
          - generic [ref=e180]:
            - button "Ver Speed Unlimited Zero Sugar" [ref=e181] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Speed Unlimited Zero Sugar" [ref=e182]'
            - button "Guardar Speed Unlimited Zero Sugar 473 ml · Lata de favoritos" [ref=e183] [cursor=pointer]:
              - img [ref=e184]
          - generic [ref=e186]:
            - heading "Speed Unlimited Zero Sugar" [level=3] [ref=e187]
            - paragraph [ref=e188]: 473 ml · Lata
            - generic [ref=e189]:
              - strong [ref=e192]: $ 2.925
              - button "Agregar Speed Unlimited Zero Sugar 473 ml · Lata al pedido" [ref=e194] [cursor=pointer]:
                - generic [ref=e195]: +
        - article [ref=e196]:
          - generic [ref=e197]:
            - button "Ver Monster Mango Loco" [ref=e198] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Monster Mango Loco" [ref=e199]'
            - button "Guardar Monster Mango Loco 473 ml · Lata de favoritos" [ref=e200] [cursor=pointer]:
              - img [ref=e201]
          - generic [ref=e203]:
            - heading "Monster Mango Loco" [level=3] [ref=e204]
            - paragraph [ref=e205]: 473 ml · Lata
            - generic [ref=e206]:
              - strong [ref=e209]: $ 3.390
              - button "Agregar Monster Mango Loco 473 ml · Lata al pedido" [ref=e211] [cursor=pointer]:
                - generic [ref=e212]: +
        - article [ref=e213]:
          - generic [ref=e214]:
            - button "Ver Heineken" [ref=e215] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Heineken" [ref=e216]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Heineken 473 ml · Lata de favoritos" [ref=e217] [cursor=pointer]:
              - img [ref=e218]
          - generic [ref=e220]:
            - heading "Heineken" [level=3] [ref=e221]
            - paragraph [ref=e222]: 473 ml · Lata
            - generic [ref=e223]:
              - strong [ref=e226]: $ 3.900
              - button "Agregar Heineken 473 ml · Lata al pedido" [ref=e228] [cursor=pointer]:
                - generic [ref=e229]: +
        - article [ref=e230]:
          - generic [ref=e231]:
            - button "Ver Imperial Golden" [ref=e232] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Imperial Golden" [ref=e233]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Imperial Golden 473 ml · Lata de favoritos" [ref=e234] [cursor=pointer]:
              - img [ref=e235]
          - generic [ref=e237]:
            - heading "Imperial Golden" [level=3] [ref=e238]
            - paragraph [ref=e239]: 473 ml · Lata
            - generic [ref=e240]:
              - strong [ref=e243]: $ 3.000
              - button "Agregar Imperial Golden 473 ml · Lata al pedido" [ref=e245] [cursor=pointer]:
                - generic [ref=e246]: +
        - article [ref=e247]:
          - generic [ref=e248]:
            - button "Ver Imperial Extra Lager" [ref=e249] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Imperial Extra Lager" [ref=e250]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Imperial Extra Lager 473 ml · Lata de favoritos" [ref=e251] [cursor=pointer]:
              - img [ref=e252]
          - generic [ref=e254]:
            - heading "Imperial Extra Lager" [level=3] [ref=e255]
            - paragraph [ref=e256]: 473 ml · Lata
            - generic [ref=e257]:
              - strong [ref=e260]: $ 3.000
              - button "Agregar Imperial Extra Lager 473 ml · Lata al pedido" [ref=e262] [cursor=pointer]:
                - generic [ref=e263]: +
        - article [ref=e264]:
          - generic [ref=e265]:
            - button "Ver Imperial APA" [ref=e266] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Imperial APA" [ref=e267]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Imperial APA 473 ml · Lata de favoritos" [ref=e268] [cursor=pointer]:
              - img [ref=e269]
          - generic [ref=e271]:
            - heading "Imperial APA" [level=3] [ref=e272]
            - paragraph [ref=e273]: 473 ml · Lata
            - generic [ref=e274]:
              - strong [ref=e277]: $ 3.000
              - button "Agregar Imperial APA 473 ml · Lata al pedido" [ref=e279] [cursor=pointer]:
                - generic [ref=e280]: +
        - article [ref=e281]:
          - generic [ref=e282]:
            - button "Ver Imperial Cream Stout" [ref=e283] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Imperial Cream Stout" [ref=e284]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Imperial Cream Stout 473 ml · Lata de favoritos" [ref=e285] [cursor=pointer]:
              - img [ref=e286]
          - generic [ref=e288]:
            - heading "Imperial Cream Stout" [level=3] [ref=e289]
            - paragraph [ref=e290]: 473 ml · Lata
            - generic [ref=e291]:
              - strong [ref=e294]: $ 3.000
              - button "Agregar Imperial Cream Stout 473 ml · Lata al pedido" [ref=e296] [cursor=pointer]:
                - generic [ref=e297]: +
        - article [ref=e298]:
          - generic [ref=e299]:
            - button "Ver Schneider Rubia" [ref=e300] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schneider Rubia" [ref=e301]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Schneider Rubia 710 ml · Lata de favoritos" [ref=e302] [cursor=pointer]:
              - img [ref=e303]
          - generic [ref=e305]:
            - heading "Schneider Rubia" [level=3] [ref=e306]
            - paragraph [ref=e307]: 710 ml · Lata
            - generic [ref=e308]:
              - strong [ref=e311]: $ 3.500
              - button "Agregar Schneider Rubia 710 ml · Lata al pedido" [ref=e313] [cursor=pointer]:
                - generic [ref=e314]: +
        - article [ref=e315]:
          - generic [ref=e316]:
            - button "Ver Corona Extra" [ref=e317] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Corona Extra" [ref=e318]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Corona Extra 330 ml de favoritos" [ref=e319] [cursor=pointer]:
              - img [ref=e320]
          - generic [ref=e322]:
            - heading "Corona Extra" [level=3] [ref=e323]
            - paragraph [ref=e324]: 330 ml
            - generic [ref=e325]:
              - strong [ref=e328]: $ 3.600
              - button "Agregar Corona Extra 330 ml al pedido" [ref=e330] [cursor=pointer]:
                - generic [ref=e331]: +
        - article [ref=e332]:
          - generic [ref=e333]:
            - button "Ver Sprite Sin azúcar" [ref=e334] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Sprite Sin azúcar" [ref=e335]'
            - button "Guardar Sprite Sin azúcar 600 ml de favoritos" [ref=e336] [cursor=pointer]:
              - img [ref=e337]
          - generic [ref=e339]:
            - heading "Sprite Sin azúcar" [level=3] [ref=e340]
            - paragraph [ref=e341]: 600 ml
            - generic [ref=e342]:
              - generic [ref=e343]:
                - strong [ref=e345]: Precio próximamente
                - generic [ref=e346]: Este producto todavía no está disponible para compra.
              - 'button "Sprite Sin azúcar 600 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e348]':
                - generic [ref=e349]: Precio pendiente
        - article [ref=e350]:
          - generic [ref=e351]:
            - button "Ver Fanta Naranja" [ref=e352] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Fanta Naranja" [ref=e353]'
            - button "Guardar Fanta Naranja 2,25 L de favoritos" [ref=e354] [cursor=pointer]:
              - img [ref=e355]
          - generic [ref=e357]:
            - heading "Fanta Naranja" [level=3] [ref=e358]
            - paragraph [ref=e359]: 2,25 L
            - generic [ref=e360]:
              - generic [ref=e361]:
                - strong [ref=e363]: Precio próximamente
                - generic [ref=e364]: Este producto todavía no está disponible para compra.
              - 'button "Fanta Naranja 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e366]':
                - generic [ref=e367]: Precio pendiente
        - article [ref=e368]:
          - generic [ref=e369]:
            - button "Ver Pepsi Black" [ref=e370] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Pepsi Black" [ref=e371]'
            - button "Guardar Pepsi Black 1,5 L de favoritos" [ref=e372] [cursor=pointer]:
              - img [ref=e373]
          - generic [ref=e375]:
            - heading "Pepsi Black" [level=3] [ref=e376]
            - paragraph [ref=e377]: 1,5 L
            - generic [ref=e378]:
              - generic [ref=e379]:
                - strong [ref=e381]: Precio próximamente
                - generic [ref=e382]: Este producto todavía no está disponible para compra.
              - 'button "Pepsi Black 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e384]':
                - generic [ref=e385]: Precio pendiente
        - article [ref=e386]:
          - generic [ref=e387]:
            - button "Ver Schweppes Pomelo" [ref=e388] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schweppes Pomelo" [ref=e389]'
            - button "Guardar Schweppes Pomelo 2,25 L de favoritos" [ref=e390] [cursor=pointer]:
              - img [ref=e391]
          - generic [ref=e393]:
            - heading "Schweppes Pomelo" [level=3] [ref=e394]
            - paragraph [ref=e395]: 2,25 L
            - generic [ref=e396]:
              - generic [ref=e397]:
                - strong [ref=e399]: Precio próximamente
                - generic [ref=e400]: Este producto todavía no está disponible para compra.
              - 'button "Schweppes Pomelo 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e402]':
                - generic [ref=e403]: Precio pendiente
        - article [ref=e404]:
          - generic [ref=e405]:
            - button "Ver Schweppes Ginger Ale" [ref=e406] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schweppes Ginger Ale" [ref=e407]'
            - button "Guardar Schweppes Ginger Ale 310 ml de favoritos" [ref=e408] [cursor=pointer]:
              - img [ref=e409]
          - generic [ref=e411]:
            - heading "Schweppes Ginger Ale" [level=3] [ref=e412]
            - paragraph [ref=e413]: 310 ml
            - generic [ref=e414]:
              - generic [ref=e415]:
                - strong [ref=e417]: Precio próximamente
                - generic [ref=e418]: Este producto todavía no está disponible para compra.
              - 'button "Schweppes Ginger Ale 310 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e420]':
                - generic [ref=e421]: Precio pendiente
        - article [ref=e422]:
          - generic [ref=e423]:
            - button "Ver Paso de los Toros Pomelo" [ref=e424] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Paso de los Toros Pomelo" [ref=e425]'
            - button "Guardar Paso de los Toros Pomelo 1,5 L de favoritos" [ref=e426] [cursor=pointer]:
              - img [ref=e427]
          - generic [ref=e429]:
            - heading "Paso de los Toros Pomelo" [level=3] [ref=e430]
            - paragraph [ref=e431]: 1,5 L
            - generic [ref=e432]:
              - generic [ref=e433]:
                - strong [ref=e435]: Precio próximamente
                - generic [ref=e436]: Este producto todavía no está disponible para compra.
              - 'button "Paso de los Toros Pomelo 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e438]':
                - generic [ref=e439]: Precio pendiente
        - article [ref=e440]:
          - generic [ref=e441]:
            - button "Ver Paso de los Toros Tónica" [ref=e442] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Paso de los Toros Tónica" [ref=e443]'
            - button "Guardar Paso de los Toros Tónica 1,5 L de favoritos" [ref=e444] [cursor=pointer]:
              - img [ref=e445]
          - generic [ref=e447]:
            - heading "Paso de los Toros Tónica" [level=3] [ref=e448]
            - paragraph [ref=e449]: 1,5 L
            - generic [ref=e450]:
              - generic [ref=e451]:
                - strong [ref=e453]: Precio próximamente
                - generic [ref=e454]: Este producto todavía no está disponible para compra.
              - 'button "Paso de los Toros Tónica 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e456]':
                - generic [ref=e457]: Precio pendiente
        - article [ref=e458]:
          - generic [ref=e459]:
            - button "Ver Soda Ivess" [ref=e460] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Soda Ivess" [ref=e461]'
            - button "Guardar Soda Ivess 1,5 L de favoritos" [ref=e462] [cursor=pointer]:
              - img [ref=e463]
          - generic [ref=e465]:
            - generic [ref=e466]: Ivess
            - heading "Soda Ivess" [level=3] [ref=e467]
            - paragraph [ref=e468]: 1,5 L
            - generic [ref=e469]:
              - generic [ref=e470]:
                - strong [ref=e472]: Precio próximamente
                - generic [ref=e473]: Este producto todavía no está disponible para compra.
              - 'button "Soda Ivess 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e475]':
                - generic [ref=e476]: Precio pendiente
        - article [ref=e477]:
          - generic [ref=e478]:
            - button "Ver Britvic Ginger Beer" [ref=e479] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Britvic Ginger Beer" [ref=e480]'
            - button "Guardar Britvic Ginger Beer 200 ml de favoritos" [ref=e481] [cursor=pointer]:
              - img [ref=e482]
          - generic [ref=e484]:
            - heading "Britvic Ginger Beer" [level=3] [ref=e485]
            - paragraph [ref=e486]: 200 ml
            - generic [ref=e487]:
              - generic [ref=e488]:
                - strong [ref=e490]: Precio próximamente
                - generic [ref=e491]: Este producto todavía no está disponible para compra.
              - 'button "Britvic Ginger Beer 200 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e493]':
                - generic [ref=e494]: Precio pendiente
        - article [ref=e495]:
          - generic [ref=e496]:
            - button "Ver Villavicencio" [ref=e497] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Villavicencio" [ref=e498]'
            - button "Guardar Villavicencio 500 ml de favoritos" [ref=e499] [cursor=pointer]:
              - img [ref=e500]
          - generic [ref=e502]:
            - heading "Villavicencio" [level=3] [ref=e503]
            - paragraph [ref=e504]: 500 ml
            - generic [ref=e505]:
              - generic [ref=e506]:
                - strong [ref=e508]: Precio próximamente
                - generic [ref=e509]: Este producto todavía no está disponible para compra.
              - 'button "Villavicencio 500 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e511]':
                - generic [ref=e512]: Precio pendiente
        - article [ref=e513]:
          - generic [ref=e514]:
            - button "Ver Eco de los Andes" [ref=e515] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Eco de los Andes" [ref=e516]'
            - button "Guardar Eco de los Andes 2 L de favoritos" [ref=e517] [cursor=pointer]:
              - img [ref=e518]
          - generic [ref=e520]:
            - heading "Eco de los Andes" [level=3] [ref=e521]
            - paragraph [ref=e522]: 2 L
            - generic [ref=e523]:
              - generic [ref=e524]:
                - strong [ref=e526]: Precio próximamente
                - generic [ref=e527]: Este producto todavía no está disponible para compra.
              - 'button "Eco de los Andes 2 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e529]':
                - generic [ref=e530]: Precio pendiente
        - article [ref=e531]:
          - generic [ref=e532]:
            - button "Ver Glaciar Sin gas, baja en sodio" [ref=e533] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Glaciar Sin gas, baja en sodio" [ref=e534]'
            - button "Guardar Glaciar Sin gas, baja en sodio 1,5 L de favoritos" [ref=e535] [cursor=pointer]:
              - img [ref=e536]
          - generic [ref=e538]:
            - heading "Glaciar Sin gas, baja en sodio" [level=3] [ref=e539]
            - paragraph [ref=e540]: 1,5 L
            - generic [ref=e541]:
              - generic [ref=e542]:
                - strong [ref=e544]: Precio próximamente
                - generic [ref=e545]: Este producto todavía no está disponible para compra.
              - 'button "Glaciar Sin gas, baja en sodio 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e547]':
                - generic [ref=e548]: Precio pendiente
        - article [ref=e549]:
          - generic [ref=e550]:
            - button "Ver Glaciar Con gas, baja en sodio" [ref=e551] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Glaciar Con gas, baja en sodio" [ref=e552]'
            - button "Guardar Glaciar Con gas, baja en sodio 1,5 L de favoritos" [ref=e553] [cursor=pointer]:
              - img [ref=e554]
          - generic [ref=e556]:
            - heading "Glaciar Con gas, baja en sodio" [level=3] [ref=e557]
            - paragraph [ref=e558]: 1,5 L
            - generic [ref=e559]:
              - generic [ref=e560]:
                - strong [ref=e562]: Precio próximamente
                - generic [ref=e563]: Este producto todavía no está disponible para compra.
              - 'button "Glaciar Con gas, baja en sodio 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e565]':
                - generic [ref=e566]: Precio pendiente
        - article [ref=e567]:
          - generic [ref=e568]:
            - button "Ver H2OH!" [ref=e569] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: H2OH!" [ref=e570]'
            - button "Guardar H2OH! 1,5 L de favoritos" [ref=e571] [cursor=pointer]:
              - img [ref=e572]
          - generic [ref=e574]:
            - heading "H2OH!" [level=3] [ref=e575]
            - paragraph [ref=e576]: 1,5 L
            - generic [ref=e577]:
              - generic [ref=e578]:
                - strong [ref=e580]: Precio próximamente
                - generic [ref=e581]: Este producto todavía no está disponible para compra.
              - 'button "H2OH! 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e583]':
                - generic [ref=e584]: Precio pendiente
        - article [ref=e585]:
          - generic [ref=e586]:
            - button "Ver Red Bull Energy Drink" [ref=e587] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Red Bull Energy Drink" [ref=e588]'
            - button "Guardar Red Bull Energy Drink 355 ml de favoritos" [ref=e589] [cursor=pointer]:
              - img [ref=e590]
          - generic [ref=e592]:
            - heading "Red Bull Energy Drink" [level=3] [ref=e593]
            - paragraph [ref=e594]: 355 ml
            - generic [ref=e595]:
              - generic [ref=e596]:
                - strong [ref=e598]: Precio próximamente
                - generic [ref=e599]: Este producto todavía no está disponible para compra.
              - 'button "Red Bull Energy Drink 355 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e601]':
                - generic [ref=e602]: Precio pendiente
        - article [ref=e603]:
          - generic [ref=e604]:
            - button "Ver Monster Mango Loco" [ref=e605] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Monster Mango Loco" [ref=e606]'
            - button "Guardar Monster Mango Loco 473 ml de favoritos" [ref=e607] [cursor=pointer]:
              - img [ref=e608]
          - generic [ref=e610]:
            - heading "Monster Mango Loco" [level=3] [ref=e611]
            - paragraph [ref=e612]: 473 ml
            - generic [ref=e613]:
              - generic [ref=e614]:
                - strong [ref=e616]: Precio próximamente
                - generic [ref=e617]: Este producto todavía no está disponible para compra.
              - 'button "Monster Mango Loco 473 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e619]':
                - generic [ref=e620]: Precio pendiente
        - article [ref=e621]:
          - generic [ref=e622]:
            - button "Ver Speed Zero" [ref=e623] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Speed Zero" [ref=e624]'
            - button "Guardar Speed Zero 473 ml de favoritos" [ref=e625] [cursor=pointer]:
              - img [ref=e626]
          - generic [ref=e628]:
            - heading "Speed Zero" [level=3] [ref=e629]
            - paragraph [ref=e630]: 473 ml
            - generic [ref=e631]:
              - generic [ref=e632]:
                - strong [ref=e634]: Precio próximamente
                - generic [ref=e635]: Este producto todavía no está disponible para compra.
              - 'button "Speed Zero 473 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e637]':
                - generic [ref=e638]: Precio pendiente
        - article [ref=e639]:
          - generic [ref=e640]:
            - button "Ver Gatorade Zero" [ref=e641] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Gatorade Zero" [ref=e642]'
            - button "Guardar Gatorade Zero 400 ml de favoritos" [ref=e643] [cursor=pointer]:
              - img [ref=e644]
          - generic [ref=e646]:
            - heading "Gatorade Zero" [level=3] [ref=e647]
            - paragraph [ref=e648]: 400 ml
            - generic [ref=e649]:
              - generic [ref=e650]:
                - strong [ref=e652]: Precio próximamente
                - generic [ref=e653]: Este producto todavía no está disponible para compra.
              - 'button "Gatorade Zero 400 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e655]':
                - generic [ref=e656]: Precio pendiente
        - article [ref=e657]:
          - generic [ref=e658]:
            - button "Ver Powerade" [ref=e659] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Powerade" [ref=e660]'
            - button "Guardar Powerade 995 ml de favoritos" [ref=e661] [cursor=pointer]:
              - img [ref=e662]
          - generic [ref=e664]:
            - heading "Powerade" [level=3] [ref=e665]
            - paragraph [ref=e666]: 995 ml
            - generic [ref=e667]:
              - generic [ref=e668]:
                - strong [ref=e670]: Precio próximamente
                - generic [ref=e671]: Este producto todavía no está disponible para compra.
              - 'button "Powerade 995 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e673]':
                - generic [ref=e674]: Precio pendiente
        - article [ref=e675]:
          - generic [ref=e676]:
            - button "Ver Buhero Negro" [ref=e677] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Buhero Negro" [ref=e678]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Buhero Negro 450 ml de favoritos" [ref=e679] [cursor=pointer]:
              - img [ref=e680]
          - generic [ref=e682]:
            - heading "Buhero Negro" [level=3] [ref=e683]
            - paragraph [ref=e684]: 450 ml
            - generic [ref=e685]:
              - generic [ref=e686]:
                - strong [ref=e688]: Precio próximamente
                - generic [ref=e689]: Este producto todavía no está disponible para compra.
              - 'button "Buhero Negro 450 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e691]':
                - generic [ref=e692]: Precio pendiente
        - article [ref=e693]:
          - generic [ref=e694]:
            - button "Ver Cinzano Rosso" [ref=e695] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Cinzano Rosso" [ref=e696]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Cinzano Rosso 950 ml de favoritos" [ref=e697] [cursor=pointer]:
              - img [ref=e698]
          - generic [ref=e700]:
            - heading "Cinzano Rosso" [level=3] [ref=e701]
            - paragraph [ref=e702]: 950 ml
            - generic [ref=e703]:
              - generic [ref=e704]:
                - strong [ref=e706]: Precio próximamente
                - generic [ref=e707]: Este producto todavía no está disponible para compra.
              - 'button "Cinzano Rosso 950 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e709]':
                - generic [ref=e710]: Precio pendiente
        - article [ref=e711]:
          - generic [ref=e712]:
            - button "Ver Campari Bitter" [ref=e713] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Campari Bitter" [ref=e714]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Campari Bitter 750 ml de favoritos" [ref=e715] [cursor=pointer]:
              - img [ref=e716]
          - generic [ref=e718]:
            - heading "Campari Bitter" [level=3] [ref=e719]
            - paragraph [ref=e720]: 750 ml
            - generic [ref=e721]:
              - generic [ref=e722]:
                - strong [ref=e724]: Precio próximamente
                - generic [ref=e725]: Este producto todavía no está disponible para compra.
              - 'button "Campari Bitter 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e727]':
                - generic [ref=e728]: Precio pendiente
        - article [ref=e729]:
          - generic [ref=e730]:
            - button "Ver Aperol" [ref=e731] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Aperol" [ref=e732]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Aperol 750 ml de favoritos" [ref=e733] [cursor=pointer]:
              - img [ref=e734]
          - generic [ref=e736]:
            - heading "Aperol" [level=3] [ref=e737]
            - paragraph [ref=e738]: 750 ml
            - generic [ref=e739]:
              - generic [ref=e740]:
                - strong [ref=e742]: Precio próximamente
                - generic [ref=e743]: Este producto todavía no está disponible para compra.
              - 'button "Aperol 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e745]':
                - generic [ref=e746]: Precio pendiente
        - article [ref=e747]:
          - generic [ref=e748]:
            - button "Ver Quilmes Clásica" [ref=e749] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Quilmes Clásica" [ref=e750]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Quilmes Clásica 710 ml de favoritos" [ref=e751] [cursor=pointer]:
              - img [ref=e752]
          - generic [ref=e754]:
            - heading "Quilmes Clásica" [level=3] [ref=e755]
            - paragraph [ref=e756]: 710 ml
            - generic [ref=e757]:
              - generic [ref=e758]:
                - strong [ref=e760]: Precio próximamente
                - generic [ref=e761]: Este producto todavía no está disponible para compra.
              - 'button "Quilmes Clásica 710 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e763]':
                - generic [ref=e764]: Precio pendiente
        - article [ref=e765]:
          - generic [ref=e766]:
            - button "Ver Patagonia Lager del Sur" [ref=e767] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Patagonia Lager del Sur" [ref=e768]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Patagonia Lager del Sur 730 ml de favoritos" [ref=e769] [cursor=pointer]:
              - img [ref=e770]
          - generic [ref=e772]:
            - heading "Patagonia Lager del Sur" [level=3] [ref=e773]
            - paragraph [ref=e774]: 730 ml
            - generic [ref=e775]:
              - generic [ref=e776]:
                - strong [ref=e778]: Precio próximamente
                - generic [ref=e779]: Este producto todavía no está disponible para compra.
              - 'button "Patagonia Lager del Sur 730 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e781]':
                - generic [ref=e782]: Precio pendiente
        - article [ref=e783]:
          - generic [ref=e784]:
            - button "Ver Heineken" [ref=e785] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Heineken" [ref=e786]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Heineken 710 ml de favoritos" [ref=e787] [cursor=pointer]:
              - img [ref=e788]
          - generic [ref=e790]:
            - heading "Heineken" [level=3] [ref=e791]
            - paragraph [ref=e792]: 710 ml
            - generic [ref=e793]:
              - generic [ref=e794]:
                - strong [ref=e796]: Precio próximamente
                - generic [ref=e797]: Este producto todavía no está disponible para compra.
              - 'button "Heineken 710 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e799]':
                - generic [ref=e800]: Precio pendiente
        - article [ref=e801]:
          - generic [ref=e802]:
            - button "Ver Stella Artois" [ref=e803] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Stella Artois" [ref=e804]'
            - button "Guardar Stella Artois 330 ml de favoritos" [ref=e805] [cursor=pointer]:
              - img [ref=e806]
          - generic [ref=e808]:
            - heading "Stella Artois" [level=3] [ref=e809]
            - paragraph [ref=e810]: 330 ml
            - generic [ref=e811]:
              - generic [ref=e812]:
                - strong [ref=e814]: Precio próximamente
                - generic [ref=e815]: Este producto todavía no está disponible para compra.
              - 'button "Stella Artois 330 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e817]':
                - generic [ref=e818]: Precio pendiente
        - article [ref=e819]:
          - generic [ref=e820]:
            - button "Ver Corona Extra" [ref=e821] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Corona Extra" [ref=e822]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Corona Extra 330 ml de favoritos" [ref=e823] [cursor=pointer]:
              - img [ref=e824]
          - generic [ref=e826]:
            - heading "Corona Extra" [level=3] [ref=e827]
            - paragraph [ref=e828]: 330 ml
            - generic [ref=e829]:
              - generic [ref=e830]:
                - strong [ref=e832]: Precio próximamente
                - generic [ref=e833]: Este producto todavía no está disponible para compra.
              - 'button "Corona Extra 330 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e835]':
                - generic [ref=e836]: Precio pendiente
        - article [ref=e837]:
          - generic [ref=e838]:
            - button "Ver Imperial Golden" [ref=e839] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Imperial Golden" [ref=e840]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Imperial Golden 473 ml de favoritos" [ref=e841] [cursor=pointer]:
              - img [ref=e842]
          - generic [ref=e844]:
            - heading "Imperial Golden" [level=3] [ref=e845]
            - paragraph [ref=e846]: 473 ml
            - generic [ref=e847]:
              - generic [ref=e848]:
                - strong [ref=e850]: Precio próximamente
                - generic [ref=e851]: Este producto todavía no está disponible para compra.
              - 'button "Imperial Golden 473 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e853]':
                - generic [ref=e854]: Precio pendiente
        - article [ref=e855]:
          - generic [ref=e856]:
            - button "Ver Brahma Chopp" [ref=e857] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Brahma Chopp" [ref=e858]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Brahma Chopp 1 L de favoritos" [ref=e859] [cursor=pointer]:
              - img [ref=e860]
          - generic [ref=e862]:
            - heading "Brahma Chopp" [level=3] [ref=e863]
            - paragraph [ref=e864]: 1 L
            - generic [ref=e865]:
              - generic [ref=e866]:
                - strong [ref=e868]: Precio próximamente
                - generic [ref=e869]: Este producto todavía no está disponible para compra.
              - 'button "Brahma Chopp 1 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e871]':
                - generic [ref=e872]: Precio pendiente
        - article [ref=e873]:
          - generic [ref=e874]:
            - button "Ver Amstel Lager" [ref=e875] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Amstel Lager" [ref=e876]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Amstel Lager 473 ml de favoritos" [ref=e877] [cursor=pointer]:
              - img [ref=e878]
          - generic [ref=e880]:
            - heading "Amstel Lager" [level=3] [ref=e881]
            - paragraph [ref=e882]: 473 ml
            - generic [ref=e883]:
              - generic [ref=e884]:
                - strong [ref=e886]: Precio próximamente
                - generic [ref=e887]: Este producto todavía no está disponible para compra.
              - 'button "Amstel Lager 473 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e889]':
                - generic [ref=e890]: Precio pendiente
        - article [ref=e891]:
          - generic [ref=e892]:
            - button "Ver Rutini Malbec" [ref=e893] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Rutini Malbec" [ref=e894]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Rutini Malbec 750 ml de favoritos" [ref=e895] [cursor=pointer]:
              - img [ref=e896]
          - generic [ref=e898]:
            - heading "Rutini Malbec" [level=3] [ref=e899]
            - paragraph [ref=e900]: 750 ml
            - generic [ref=e901]:
              - generic [ref=e902]:
                - strong [ref=e904]: Precio próximamente
                - generic [ref=e905]: Este producto todavía no está disponible para compra.
              - 'button "Rutini Malbec 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e907]':
                - generic [ref=e908]: Precio pendiente
        - article [ref=e909]:
          - generic [ref=e910]:
            - button "Ver Trapiche Reserva Malbec" [ref=e911] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Trapiche Reserva Malbec" [ref=e912]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Trapiche Reserva Malbec 750 ml de favoritos" [ref=e913] [cursor=pointer]:
              - img [ref=e914]
          - generic [ref=e916]:
            - heading "Trapiche Reserva Malbec" [level=3] [ref=e917]
            - paragraph [ref=e918]: 750 ml
            - generic [ref=e919]:
              - generic [ref=e920]:
                - strong [ref=e922]: Precio próximamente
                - generic [ref=e923]: Este producto todavía no está disponible para compra.
              - 'button "Trapiche Reserva Malbec 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e925]':
                - generic [ref=e926]: Precio pendiente
        - article [ref=e927]:
          - generic [ref=e928]:
            - button "Ver Fin del Mundo" [ref=e929] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Fin del Mundo" [ref=e930]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Fin del Mundo 750 ml de favoritos" [ref=e931] [cursor=pointer]:
              - img [ref=e932]
          - generic [ref=e934]:
            - heading "Fin del Mundo" [level=3] [ref=e935]
            - paragraph [ref=e936]: 750 ml
            - generic [ref=e937]:
              - generic [ref=e938]:
                - strong [ref=e940]: Precio próximamente
                - generic [ref=e941]: Este producto todavía no está disponible para compra.
              - 'button "Fin del Mundo 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e943]':
                - generic [ref=e944]: Precio pendiente
        - article [ref=e945]:
          - generic [ref=e946]:
            - button "Ver Chandon Délice" [ref=e947] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Chandon Délice" [ref=e948]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Chandon Délice 750 ml de favoritos" [ref=e949] [cursor=pointer]:
              - img [ref=e950]
          - generic [ref=e952]:
            - heading "Chandon Délice" [level=3] [ref=e953]
            - paragraph [ref=e954]: 750 ml
            - generic [ref=e955]:
              - generic [ref=e956]:
                - strong [ref=e958]: Precio próximamente
                - generic [ref=e959]: Este producto todavía no está disponible para compra.
              - 'button "Chandon Délice 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e961]':
                - generic [ref=e962]: Precio pendiente
        - article [ref=e963]:
          - generic [ref=e964]:
            - button "Ver Tanqueray Dry" [ref=e965] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Tanqueray Dry" [ref=e966]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Tanqueray Dry 700 ml de favoritos" [ref=e967] [cursor=pointer]:
              - img [ref=e968]
          - generic [ref=e970]:
            - heading "Tanqueray Dry" [level=3] [ref=e971]
            - paragraph [ref=e972]: 700 ml
            - generic [ref=e973]:
              - generic [ref=e974]:
                - strong [ref=e976]: Precio próximamente
                - generic [ref=e977]: Este producto todavía no está disponible para compra.
              - 'button "Tanqueray Dry 700 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e979]':
                - generic [ref=e980]: Precio pendiente
        - article [ref=e981]:
          - generic [ref=e982]:
            - button "Ver Bombay Sapphire" [ref=e983] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Bombay Sapphire" [ref=e984]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Bombay Sapphire 750 ml de favoritos" [ref=e985] [cursor=pointer]:
              - img [ref=e986]
          - generic [ref=e988]:
            - heading "Bombay Sapphire" [level=3] [ref=e989]
            - paragraph [ref=e990]: 750 ml
            - generic [ref=e991]:
              - generic [ref=e992]:
                - strong [ref=e994]: Precio próximamente
                - generic [ref=e995]: Este producto todavía no está disponible para compra.
              - 'button "Bombay Sapphire 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e997]':
                - generic [ref=e998]: Precio pendiente
        - article [ref=e999]:
          - generic [ref=e1000]:
            - button "Ver Bosque Nativo" [ref=e1001] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Bosque Nativo" [ref=e1002]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Bosque Nativo 500 ml de favoritos" [ref=e1003] [cursor=pointer]:
              - img [ref=e1004]
          - generic [ref=e1006]:
            - heading "Bosque Nativo" [level=3] [ref=e1007]
            - paragraph [ref=e1008]: 500 ml
            - generic [ref=e1009]:
              - generic [ref=e1010]:
                - strong [ref=e1012]: Precio próximamente
                - generic [ref=e1013]: Este producto todavía no está disponible para compra.
              - 'button "Bosque Nativo 500 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1015]':
                - generic [ref=e1016]: Precio pendiente
        - article [ref=e1017]:
          - generic [ref=e1018]:
            - button "Ver Johnnie Walker Red Label" [ref=e1019] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Johnnie Walker Red Label" [ref=e1020]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Johnnie Walker Red Label 750 ml de favoritos" [ref=e1021] [cursor=pointer]:
              - img [ref=e1022]
          - generic [ref=e1024]:
            - heading "Johnnie Walker Red Label" [level=3] [ref=e1025]
            - paragraph [ref=e1026]: 750 ml
            - generic [ref=e1027]:
              - generic [ref=e1028]:
                - strong [ref=e1030]: Precio próximamente
                - generic [ref=e1031]: Este producto todavía no está disponible para compra.
              - 'button "Johnnie Walker Red Label 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1033]':
                - generic [ref=e1034]: Precio pendiente
        - article [ref=e1035]:
          - generic [ref=e1036]:
            - button "Ver Hielo Cristal" [ref=e1037] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Hielo Cristal" [ref=e1038]'
            - button "Guardar Hielo Cristal 4000 g de favoritos" [ref=e1039] [cursor=pointer]:
              - img [ref=e1040]
          - generic [ref=e1042]:
            - generic [ref=e1043]: Cristal
            - heading "Hielo Cristal" [level=3] [ref=e1044]
            - paragraph [ref=e1045]: 4000 g
            - generic [ref=e1046]:
              - generic [ref=e1047]:
                - strong [ref=e1049]: Precio próximamente
                - generic [ref=e1050]: Este producto todavía no está disponible para compra.
              - 'button "Hielo Cristal 4000 g: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1052]':
                - generic [ref=e1053]: Precio pendiente
        - article [ref=e1054]:
          - generic [ref=e1055]:
            - button "Ver Coca-Cola Sabor Original" [ref=e1056] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Sabor Original" [ref=e1057]'
            - button "Guardar Coca-Cola Sabor 2,25 L de favoritos" [ref=e1058] [cursor=pointer]:
              - img [ref=e1059]
          - generic [ref=e1061]:
            - heading "Coca-Cola Sabor" [level=3] [ref=e1062]
            - paragraph [ref=e1063]: 2,25 L
            - generic [ref=e1064]:
              - generic [ref=e1065]:
                - strong [ref=e1067]: Precio próximamente
                - generic [ref=e1068]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola Sabor 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1070]':
                - generic [ref=e1071]: Precio pendiente
        - article [ref=e1072]:
          - generic [ref=e1073]:
            - button "Ver Coca-Cola Sin Azúcar" [ref=e1074] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Sin Azúcar" [ref=e1075]'
            - button "Guardar Coca-Cola Sin Azúcar 2,25 L de favoritos" [ref=e1076] [cursor=pointer]:
              - img [ref=e1077]
          - generic [ref=e1079]:
            - heading "Coca-Cola Sin Azúcar" [level=3] [ref=e1080]
            - paragraph [ref=e1081]: 2,25 L
            - generic [ref=e1082]:
              - generic [ref=e1083]:
                - strong [ref=e1085]: Precio próximamente
                - generic [ref=e1086]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola Sin Azúcar 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1088]':
                - generic [ref=e1089]: Precio pendiente
        - article [ref=e1090]:
          - generic [ref=e1091]:
            - button "Ver Sprite Sin azúcar" [ref=e1092] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Sprite Sin azúcar" [ref=e1093]'
            - button "Guardar Sprite Sin azúcar 2,25 L de favoritos" [ref=e1094] [cursor=pointer]:
              - img [ref=e1095]
          - generic [ref=e1097]:
            - heading "Sprite Sin azúcar" [level=3] [ref=e1098]
            - paragraph [ref=e1099]: 2,25 L
            - generic [ref=e1100]:
              - generic [ref=e1101]:
                - strong [ref=e1103]: Precio próximamente
                - generic [ref=e1104]: Este producto todavía no está disponible para compra.
              - 'button "Sprite Sin azúcar 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1106]':
                - generic [ref=e1107]: Precio pendiente
        - article [ref=e1108]:
          - generic [ref=e1109]:
            - button "Ver 7UP" [ref=e1110] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: 7UP" [ref=e1111]'
            - button "Guardar 7UP 2 L de favoritos" [ref=e1112] [cursor=pointer]:
              - img [ref=e1113]
          - generic [ref=e1115]:
            - heading "7UP" [level=3] [ref=e1116]
            - paragraph [ref=e1117]: 2 L
            - generic [ref=e1118]:
              - generic [ref=e1119]:
                - strong [ref=e1121]: Precio próximamente
                - generic [ref=e1122]: Este producto todavía no está disponible para compra.
              - 'button "7UP 2 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1124]':
                - generic [ref=e1125]: Precio pendiente
        - article [ref=e1126]:
          - generic [ref=e1127]:
            - button "Ver Bonaqua" [ref=e1128] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Bonaqua" [ref=e1129]'
            - button "Guardar Bonaqua 2,25 L de favoritos" [ref=e1130] [cursor=pointer]:
              - img [ref=e1131]
          - generic [ref=e1133]:
            - heading "Bonaqua" [level=3] [ref=e1134]
            - paragraph [ref=e1135]: 2,25 L
            - generic [ref=e1136]:
              - generic [ref=e1137]:
                - strong [ref=e1139]: Precio próximamente
                - generic [ref=e1140]: Este producto todavía no está disponible para compra.
              - 'button "Bonaqua 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1142]':
                - generic [ref=e1143]: Precio pendiente
        - article [ref=e1144]:
          - generic [ref=e1145]:
            - button "Ver Manaos Lima limón" [ref=e1146] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Manaos Lima limón" [ref=e1147]'
            - button "Guardar Manaos Lima limón 2,25 L de favoritos" [ref=e1148] [cursor=pointer]:
              - img [ref=e1149]
          - generic [ref=e1151]:
            - heading "Manaos Lima limón" [level=3] [ref=e1152]
            - paragraph [ref=e1153]: 2,25 L
            - generic [ref=e1154]:
              - generic [ref=e1155]:
                - strong [ref=e1157]: Precio próximamente
                - generic [ref=e1158]: Este producto todavía no está disponible para compra.
              - 'button "Manaos Lima limón 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1160]':
                - generic [ref=e1161]: Precio pendiente
        - article [ref=e1162]:
          - generic [ref=e1163]:
            - button "Ver Manaos Naranja" [ref=e1164] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Manaos Naranja" [ref=e1165]'
            - button "Guardar Manaos Naranja 2,25 L de favoritos" [ref=e1166] [cursor=pointer]:
              - img [ref=e1167]
          - generic [ref=e1169]:
            - heading "Manaos Naranja" [level=3] [ref=e1170]
            - paragraph [ref=e1171]: 2,25 L
            - generic [ref=e1172]:
              - generic [ref=e1173]:
                - strong [ref=e1175]: Precio próximamente
                - generic [ref=e1176]: Este producto todavía no está disponible para compra.
              - 'button "Manaos Naranja 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1178]':
                - generic [ref=e1179]: Precio pendiente
        - article [ref=e1180]:
          - generic [ref=e1181]:
            - button "Ver Pepsi Black" [ref=e1182] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Pepsi Black" [ref=e1183]'
            - button "Guardar Pepsi Black 2,25 L de favoritos" [ref=e1184] [cursor=pointer]:
              - img [ref=e1185]
          - generic [ref=e1187]:
            - heading "Pepsi Black" [level=3] [ref=e1188]
            - paragraph [ref=e1189]: 2,25 L
            - generic [ref=e1190]:
              - generic [ref=e1191]:
                - strong [ref=e1193]: Precio próximamente
                - generic [ref=e1194]: Este producto todavía no está disponible para compra.
              - 'button "Pepsi Black 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1196]':
                - generic [ref=e1197]: Precio pendiente
        - article [ref=e1198]:
          - generic [ref=e1199]:
            - button "Ver Schweppes Tónica" [ref=e1200] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schweppes Tónica" [ref=e1201]'
            - button "Guardar Schweppes Tónica 354 ml · Lata de favoritos" [ref=e1202] [cursor=pointer]:
              - img [ref=e1203]
          - generic [ref=e1205]:
            - heading "Schweppes Tónica" [level=3] [ref=e1206]
            - paragraph [ref=e1207]: 354 ml · Lata
            - generic [ref=e1208]:
              - generic [ref=e1209]:
                - strong [ref=e1211]: Precio próximamente
                - generic [ref=e1212]: Este producto todavía no está disponible para compra.
              - 'button "Schweppes Tónica 354 ml · Lata: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1214]':
                - generic [ref=e1215]: Precio pendiente
        - article [ref=e1216]:
          - generic [ref=e1217]:
            - button "Ver Levité" [ref=e1218] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Levité" [ref=e1219]'
            - button "Guardar Levité 2,25 L de favoritos" [ref=e1220] [cursor=pointer]:
              - img [ref=e1221]
          - generic [ref=e1223]:
            - heading "Levité" [level=3] [ref=e1224]
            - paragraph [ref=e1225]: 2,25 L
            - generic [ref=e1226]:
              - generic [ref=e1227]:
                - strong [ref=e1229]: Precio próximamente
                - generic [ref=e1230]: Este producto todavía no está disponible para compra.
              - 'button "Levité 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1232]':
                - generic [ref=e1233]: Precio pendiente
        - article [ref=e1234]:
          - generic [ref=e1235]:
            - button "Ver Gancia" [ref=e1236] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Gancia" [ref=e1237]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Gancia 950 ml de favoritos" [ref=e1238] [cursor=pointer]:
              - img [ref=e1239]
          - generic [ref=e1241]:
            - heading "Gancia" [level=3] [ref=e1242]
            - paragraph [ref=e1243]: 950 ml
            - generic [ref=e1244]:
              - generic [ref=e1245]:
                - strong [ref=e1247]: Precio próximamente
                - generic [ref=e1248]: Este producto todavía no está disponible para compra.
              - 'button "Gancia 950 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1250]':
                - generic [ref=e1251]: Precio pendiente
        - article [ref=e1252]:
          - generic [ref=e1253]:
            - button "Ver Martini Bianco" [ref=e1254] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Martini Bianco" [ref=e1255]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Martini Bianco 1 L de favoritos" [ref=e1256] [cursor=pointer]:
              - img [ref=e1257]
          - generic [ref=e1259]:
            - heading "Martini Bianco" [level=3] [ref=e1260]
            - paragraph [ref=e1261]: 1 L
            - generic [ref=e1262]:
              - generic [ref=e1263]:
                - strong [ref=e1265]: Precio próximamente
                - generic [ref=e1266]: Este producto todavía no está disponible para compra.
              - 'button "Martini Bianco 1 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1268]':
                - generic [ref=e1269]: Precio pendiente
        - article [ref=e1270]:
          - generic [ref=e1271]:
            - button "Ver Monster Ultra" [ref=e1272] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Monster Ultra" [ref=e1273]'
            - button "Guardar Monster Ultra 473 ml · Lata de favoritos" [ref=e1274] [cursor=pointer]:
              - img [ref=e1275]
          - generic [ref=e1277]:
            - heading "Monster Ultra" [level=3] [ref=e1278]
            - paragraph [ref=e1279]: 473 ml · Lata
            - generic [ref=e1280]:
              - generic [ref=e1281]:
                - strong [ref=e1283]: Precio próximamente
                - generic [ref=e1284]: Este producto todavía no está disponible para compra.
              - 'button "Monster Ultra 473 ml · Lata: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1286]':
                - generic [ref=e1287]: Precio pendiente
        - article [ref=e1288]:
          - generic [ref=e1289]:
            - button "Ver Fernet Branca Edición Mundial" [ref=e1290] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Fernet Branca Edición Mundial" [ref=e1291]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Fernet Branca Edición Mundial 750 ml de favoritos" [ref=e1292] [cursor=pointer]:
              - img [ref=e1293]
          - generic [ref=e1295]:
            - heading "Fernet Branca Edición Mundial" [level=3] [ref=e1296]
            - paragraph [ref=e1297]: 750 ml
            - generic [ref=e1298]:
              - generic [ref=e1299]:
                - strong [ref=e1301]: Precio próximamente
                - generic [ref=e1302]: Este producto todavía no está disponible para compra.
              - 'button "Fernet Branca Edición Mundial 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1304]':
                - generic [ref=e1305]: Precio pendiente
        - article [ref=e1306]:
          - generic [ref=e1307]:
            - button "Ver Fernet Vittone" [ref=e1308] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Fernet Vittone" [ref=e1309]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Fernet Vittone 1 L de favoritos" [ref=e1310] [cursor=pointer]:
              - img [ref=e1311]
          - generic [ref=e1313]:
            - generic [ref=e1314]: Vittone
            - heading "Fernet Vittone" [level=3] [ref=e1315]
            - paragraph [ref=e1316]: 1 L
            - generic [ref=e1317]:
              - generic [ref=e1318]:
                - strong [ref=e1320]: Precio próximamente
                - generic [ref=e1321]: Este producto todavía no está disponible para compra.
              - 'button "Fernet Vittone 1 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1323]':
                - generic [ref=e1324]: Precio pendiente
        - article [ref=e1325]:
          - generic [ref=e1326]:
            - button "Ver Budweiser" [ref=e1327] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Budweiser" [ref=e1328]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Budweiser 473 ml · Lata de favoritos" [ref=e1329] [cursor=pointer]:
              - img [ref=e1330]
          - generic [ref=e1332]:
            - heading "Budweiser" [level=3] [ref=e1333]
            - paragraph [ref=e1334]: 473 ml · Lata
            - generic [ref=e1335]:
              - generic [ref=e1336]:
                - strong [ref=e1338]: Precio próximamente
                - generic [ref=e1339]: Este producto todavía no está disponible para compra.
              - 'button "Budweiser 473 ml · Lata: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1341]':
                - generic [ref=e1342]: Precio pendiente
        - article [ref=e1343]:
          - generic [ref=e1344]:
            - button "Ver Alamos Malbec" [ref=e1345] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Alamos Malbec" [ref=e1346]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Alamos Malbec 750 ml de favoritos" [ref=e1347] [cursor=pointer]:
              - img [ref=e1348]
          - generic [ref=e1350]:
            - heading "Alamos Malbec" [level=3] [ref=e1351]
            - paragraph [ref=e1352]: 750 ml
            - generic [ref=e1353]:
              - generic [ref=e1354]:
                - strong [ref=e1356]: Precio próximamente
                - generic [ref=e1357]: Este producto todavía no está disponible para compra.
              - 'button "Alamos Malbec 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1359]':
                - generic [ref=e1360]: Precio pendiente
        - article [ref=e1361]:
          - generic [ref=e1362]:
            - button "Ver Norton Malbec" [ref=e1363] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Norton Malbec" [ref=e1364]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Norton Malbec 750 ml de favoritos" [ref=e1365] [cursor=pointer]:
              - img [ref=e1366]
          - generic [ref=e1368]:
            - heading "Norton Malbec" [level=3] [ref=e1369]
            - paragraph [ref=e1370]: 750 ml
            - generic [ref=e1371]:
              - generic [ref=e1372]:
                - strong [ref=e1374]: Precio próximamente
                - generic [ref=e1375]: Este producto todavía no está disponible para compra.
              - 'button "Norton Malbec 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1377]':
                - generic [ref=e1378]: Precio pendiente
        - article [ref=e1379]:
          - generic [ref=e1380]:
            - button "Ver Rutini" [ref=e1381] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Rutini" [ref=e1382]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Rutini 750 ml de favoritos" [ref=e1383] [cursor=pointer]:
              - img [ref=e1384]
          - generic [ref=e1386]:
            - heading "Rutini" [level=3] [ref=e1387]
            - paragraph [ref=e1388]: 750 ml
            - generic [ref=e1389]:
              - generic [ref=e1390]:
                - strong [ref=e1392]: Precio próximamente
                - generic [ref=e1393]: Este producto todavía no está disponible para compra.
              - 'button "Rutini 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1395]':
                - generic [ref=e1396]: Precio pendiente
        - article [ref=e1397]:
          - generic [ref=e1398]:
            - button "Ver Trumpeter Malbec" [ref=e1399] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Trumpeter Malbec" [ref=e1400]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Trumpeter Malbec 750 ml de favoritos" [ref=e1401] [cursor=pointer]:
              - img [ref=e1402]
          - generic [ref=e1404]:
            - heading "Trumpeter Malbec" [level=3] [ref=e1405]
            - paragraph [ref=e1406]: 750 ml
            - generic [ref=e1407]:
              - generic [ref=e1408]:
                - strong [ref=e1410]: Precio próximamente
                - generic [ref=e1411]: Este producto todavía no está disponible para compra.
              - 'button "Trumpeter Malbec 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1413]':
                - generic [ref=e1414]: Precio pendiente
        - article [ref=e1415]:
          - generic [ref=e1416]:
            - button "Ver Coca-Cola Original" [ref=e1417] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Original" [ref=e1418]'
            - button "Guardar Coca-Cola 500 ml de favoritos" [ref=e1419] [cursor=pointer]:
              - img [ref=e1420]
          - generic [ref=e1422]:
            - heading "Coca-Cola" [level=3] [ref=e1423]
            - paragraph [ref=e1424]: 500 ml
            - generic [ref=e1425]:
              - generic [ref=e1426]:
                - strong [ref=e1428]: Precio próximamente
                - generic [ref=e1429]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola 500 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1431]':
                - generic [ref=e1432]: Precio pendiente
        - article [ref=e1433]:
          - generic [ref=e1434]:
            - button "Ver Coca-Cola Zero" [ref=e1435] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Zero" [ref=e1436]'
            - button "Guardar Coca-Cola Zero 500 ml de favoritos" [ref=e1437] [cursor=pointer]:
              - img [ref=e1438]
          - generic [ref=e1440]:
            - heading "Coca-Cola Zero" [level=3] [ref=e1441]
            - paragraph [ref=e1442]: 500 ml
            - generic [ref=e1443]:
              - generic [ref=e1444]:
                - strong [ref=e1446]: Precio próximamente
                - generic [ref=e1447]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola Zero 500 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1449]':
                - generic [ref=e1450]: Precio pendiente
        - article [ref=e1451]:
          - generic [ref=e1452]:
            - button "Ver Sprite Original" [ref=e1453] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Sprite Original" [ref=e1454]'
            - button "Guardar Sprite 500 ml de favoritos" [ref=e1455] [cursor=pointer]:
              - img [ref=e1456]
          - generic [ref=e1458]:
            - heading "Sprite" [level=3] [ref=e1459]
            - paragraph [ref=e1460]: 500 ml
            - generic [ref=e1461]:
              - generic [ref=e1462]:
                - strong [ref=e1464]: Precio próximamente
                - generic [ref=e1465]: Este producto todavía no está disponible para compra.
              - 'button "Sprite 500 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1467]':
                - generic [ref=e1468]: Precio pendiente
        - article [ref=e1469]:
          - generic [ref=e1470]:
            - button "Ver Coca-Cola Original" [ref=e1471] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Original" [ref=e1472]'
            - button "Guardar Coca-Cola 1,5 L de favoritos" [ref=e1473] [cursor=pointer]:
              - img [ref=e1474]
          - generic [ref=e1476]:
            - heading "Coca-Cola" [level=3] [ref=e1477]
            - paragraph [ref=e1478]: 1,5 L
            - generic [ref=e1479]:
              - generic [ref=e1480]:
                - strong [ref=e1482]: Precio próximamente
                - generic [ref=e1483]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1485]':
                - generic [ref=e1486]: Precio pendiente
        - article [ref=e1487]:
          - generic [ref=e1488]:
            - button "Ver Coca-Cola Zero" [ref=e1489] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Zero" [ref=e1490]'
            - button "Guardar Coca-Cola Zero 1,5 L de favoritos" [ref=e1491] [cursor=pointer]:
              - img [ref=e1492]
          - generic [ref=e1494]:
            - heading "Coca-Cola Zero" [level=3] [ref=e1495]
            - paragraph [ref=e1496]: 1,5 L
            - generic [ref=e1497]:
              - generic [ref=e1498]:
                - strong [ref=e1500]: Precio próximamente
                - generic [ref=e1501]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola Zero 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1503]':
                - generic [ref=e1504]: Precio pendiente
        - article [ref=e1505]:
          - generic [ref=e1506]:
            - button "Ver Sprite Original" [ref=e1507] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Sprite Original" [ref=e1508]'
            - button "Guardar Sprite 1,5 L de favoritos" [ref=e1509] [cursor=pointer]:
              - img [ref=e1510]
          - generic [ref=e1512]:
            - heading "Sprite" [level=3] [ref=e1513]
            - paragraph [ref=e1514]: 1,5 L
            - generic [ref=e1515]:
              - generic [ref=e1516]:
                - strong [ref=e1518]: Precio próximamente
                - generic [ref=e1519]: Este producto todavía no está disponible para compra.
              - 'button "Sprite 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1521]':
                - generic [ref=e1522]: Precio pendiente
        - article [ref=e1523]:
          - generic [ref=e1524]:
            - button "Ver Fanta Naranja" [ref=e1525] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Fanta Naranja" [ref=e1526]'
            - button "Guardar Fanta Naranja 1,5 L de favoritos" [ref=e1527] [cursor=pointer]:
              - img [ref=e1528]
          - generic [ref=e1530]:
            - heading "Fanta Naranja" [level=3] [ref=e1531]
            - paragraph [ref=e1532]: 1,5 L
            - generic [ref=e1533]:
              - generic [ref=e1534]:
                - strong [ref=e1536]: Precio próximamente
                - generic [ref=e1537]: Este producto todavía no está disponible para compra.
              - 'button "Fanta Naranja 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1539]':
                - generic [ref=e1540]: Precio pendiente
        - article [ref=e1541]:
          - generic [ref=e1542]:
            - button "Ver Schweppes Tónica" [ref=e1543] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schweppes Tónica" [ref=e1544]'
            - button "Guardar Schweppes Tónica 1,5 L de favoritos" [ref=e1545] [cursor=pointer]:
              - img [ref=e1546]
          - generic [ref=e1548]:
            - heading "Schweppes Tónica" [level=3] [ref=e1549]
            - paragraph [ref=e1550]: 1,5 L
            - generic [ref=e1551]:
              - generic [ref=e1552]:
                - strong [ref=e1554]: Precio próximamente
                - generic [ref=e1555]: Este producto todavía no está disponible para compra.
              - 'button "Schweppes Tónica 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1557]':
                - generic [ref=e1558]: Precio pendiente
        - article [ref=e1559]:
          - generic [ref=e1560]:
            - button "Ver Schweppes Citrus" [ref=e1561] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schweppes Citrus" [ref=e1562]'
            - button "Guardar Schweppes Citrus 1,5 L de favoritos" [ref=e1563] [cursor=pointer]:
              - img [ref=e1564]
          - generic [ref=e1566]:
            - heading "Schweppes Citrus" [level=3] [ref=e1567]
            - paragraph [ref=e1568]: 1,5 L
            - generic [ref=e1569]:
              - generic [ref=e1570]:
                - strong [ref=e1572]: Precio próximamente
                - generic [ref=e1573]: Este producto todavía no está disponible para compra.
              - 'button "Schweppes Citrus 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1575]':
                - generic [ref=e1576]: Precio pendiente
  - button "Ver carrito · $ 7.152. Ver pedido." [ref=e1577] [cursor=pointer]:
    - generic [ref=e1578]:
      - generic [ref=e1579]: Ver carrito
      - generic [ref=e1581]: 2 productos
    - strong [ref=e1582]: $ 7.152
  - navigation "Navegación móvil" [ref=e1583]:
    - button "Inicio" [ref=e1584] [cursor=pointer]:
      - generic [ref=e1585]: ⌂
      - generic [ref=e1586]: Inicio
    - button "Catálogo" [ref=e1587] [cursor=pointer]:
      - generic [ref=e1589]: Catálogo
    - button "Mis pedidos" [ref=e1590] [cursor=pointer]:
      - generic [ref=e1592]: Mis pedidos
    - button "Perfil" [ref=e1593] [cursor=pointer]:
      - generic [ref=e1595]: Perfil
```

# Test source

```ts
  462 |   const negocio = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  463 |   expect(negocio).not.toBe(home);
  464 | });
  465 | 
  466 | test('ningún texto de las vistas del cliente queda por debajo de 3:1', async ({ page }) => {
  467 |   await openHome(page);
  468 |   await page.locator('[data-home-sections] [data-add-product]:not([disabled])').first().click();
  469 | 
  470 |   for (const vista of ['home', 'catalog', 'cart', 'profile', 'tracking']) {
  471 |     await page.locator(`.mobile-nav [data-nav-view="${vista}"]`).click();
  472 |     await expect(page.locator(`[data-view="${vista}"]`)).toBeVisible();
  473 |     await page.waitForTimeout(250);
  474 |     const malos = await page.evaluate(() => {
  475 |       const parse = (v) => {
  476 |         const p = String(v).match(/[\d.]+/g);
  477 |         if (!p) return null;
  478 |         const [r, g, b, a = '1'] = p.map(Number);
  479 |         return { r, g, b, a };
  480 |       };
  481 |       const lum = ({ r, g, b }) => {
  482 |         const c = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  483 |         return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  484 |       };
  485 |       const out = [];
  486 |       for (const node of document.querySelectorAll('.app-view:not([hidden]) *')) {
  487 |         if (![...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
  488 |         const rect = node.getBoundingClientRect();
  489 |         if (rect.width < 2 || rect.height < 2) continue;
  490 |         const cs = getComputedStyle(node);
  491 |         if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.15) continue;
  492 |         const fg = parse(cs.color);
  493 |         if (!fg || fg.a < 0.15) continue;
  494 |         let bg = null;
  495 |         for (let c = node; c; c = c.parentElement) {
  496 |           const cand = parse(getComputedStyle(c).backgroundColor);
  497 |           if (cand && cand.a >= 0.9) { bg = cand; break; }
  498 |         }
  499 |         if (!bg) continue;
  500 |         const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
  501 |         if (ratio < 3) out.push(`${ratio.toFixed(2)}:1 <${node.tagName.toLowerCase()}> "${node.textContent.trim().slice(0, 40)}"`);
  502 |       }
  503 |       return out;
  504 |     });
  505 |     expect(malos, `contraste en ${vista}`).toEqual([]);
  506 |   }
  507 | });
  508 | 
  509 | // Los estados VACÍOS son los que ningún recorrido feliz visita, y por eso
  510 | // acumulan deuda: el estado "todavía no guardaste favoritos" tenía su título en
  511 | // 1,09:1 —invisible— desde antes de esta tarea, porque el bloque no lleva
  512 | // `.card` y su tinta, calibrada para papel, caía directo sobre el grafito.
  513 | test('los estados vacíos del cliente se apoyan en la superficie de contenido', async ({ page }) => {
  514 |   await openHome(page);
  515 |   await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  516 |   await page.locator('[data-category-strip] [data-category-id="favorites"]').click();
  517 |   const vacio = page.locator('[data-product-grid] .empty-state');
  518 |   await expect(vacio).toBeVisible();
  519 |   expect(await vacio.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(GONDOLA);
  520 | 
  521 |   const flojos = await page.evaluate(() => {
  522 |     const parse = (v) => {
  523 |       const p = String(v).match(/[\d.]+/g);
  524 |       if (!p) return null;
  525 |       const [r, g, b, a = '1'] = p.map(Number);
  526 |       return { r, g, b, a };
  527 |     };
  528 |     const lum = ({ r, g, b }) => {
  529 |       const c = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  530 |       return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  531 |     };
  532 |     const out = [];
  533 |     for (const node of document.querySelectorAll('[data-product-grid] .empty-state *')) {
  534 |       if (![...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
  535 |       const cs = getComputedStyle(node);
  536 |       const fg = parse(cs.color);
  537 |       if (!fg) continue;
  538 |       let bg = null;
  539 |       for (let c = node; c; c = c.parentElement) {
  540 |         const cand = parse(getComputedStyle(c).backgroundColor);
  541 |         if (cand && cand.a >= 0.9) { bg = cand; break; }
  542 |       }
  543 |       if (!bg) continue;
  544 |       const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
  545 |       if (ratio < 4.5) out.push(`${ratio.toFixed(2)}:1 "${node.textContent.trim().slice(0, 40)}"`);
  546 |     }
  547 |     return out;
  548 |   });
  549 |   expect(flojos, 'texto del estado vacío por debajo de 4,5:1').toEqual([]);
  550 | });
  551 | 
  552 | // Seguimiento CON pedido, que es el estado que el test de arriba no alcanza:
  553 | // sin pedido la vista es una tarjeta vacía y todo su texto vive adentro. Con
  554 | // pedido aparecen el titular, su bajada y las etiquetas de la línea de tiempo
  555 | // DIRECTAMENTE sobre el shell, y esos tres estaban calibrados para el fondo
  556 | // claro que la vista pintaba antes: al soltarlo, el titular quedó en 1,11:1.
  557 | // Un texto invisible no es un detalle de color, así que acá se mide.
  558 | test('el seguimiento con pedido activo se lee sobre el shell oscuro', async ({ page }) => {
  559 |   await openHome(page);
  560 |   await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  561 |   await seedCartAboveMinimum(page);
> 562 |   await page.locator('.mobile-nav [data-nav-view="cart"]').click();
      |                                                            ^ Error: locator.click: Test timeout of 45000ms exceeded.
  563 | 
  564 |   const direccion = page.locator('[data-profile-checkout] input[type="radio"]').first();
  565 |   if (await direccion.count()) await direccion.check();
  566 |   await page.locator('[data-checkout-submit]').click();
  567 |   await expect(page.locator('[data-view="tracking"] [data-tracking-title]')).toBeVisible();
  568 | 
  569 |   const flojos = await page.evaluate(() => {
  570 |     const parse = (v) => {
  571 |       const p = String(v).match(/[\d.]+/g);
  572 |       if (!p) return null;
  573 |       const [r, g, b, a = '1'] = p.map(Number);
  574 |       return { r, g, b, a };
  575 |     };
  576 |     const lum = ({ r, g, b }) => {
  577 |       const c = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  578 |       return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  579 |     };
  580 |     const out = [];
  581 |     for (const node of document.querySelectorAll('[data-view="tracking"] *')) {
  582 |       if (![...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
  583 |       const rect = node.getBoundingClientRect();
  584 |       if (rect.width < 2 || rect.height < 2) continue;
  585 |       const cs = getComputedStyle(node);
  586 |       if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.15) continue;
  587 |       const fg = parse(cs.color);
  588 |       if (!fg || fg.a < 0.15) continue;
  589 |       let bg = null;
  590 |       for (let c = node; c; c = c.parentElement) {
  591 |         const cand = parse(getComputedStyle(c).backgroundColor);
  592 |         if (cand && cand.a >= 0.9) { bg = cand; break; }
  593 |       }
  594 |       if (!bg) continue;
  595 |       const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
  596 |       if (ratio < 4.5) out.push(`${ratio.toFixed(2)}:1 "${node.textContent.trim().slice(0, 40)}"`);
  597 |     }
  598 |     return out;
  599 |   });
  600 |   expect(flojos, 'texto del seguimiento por debajo de 4,5:1').toEqual([]);
  601 | 
  602 |   // Y sus tarjetas son la misma superficie que el resto del cliente.
  603 |   expect(await page.locator('.tracking-rider-card').first()
  604 |     .evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(GONDOLA);
  605 | });
  606 | 
  607 | test('el texto de la home cumple el contraste mínimo sobre la superficie oscura', async ({ page }) => {
  608 |   await openHome(page, { stories: STORY_FIXTURES });
  609 | 
  610 |   const probes = [
  611 |     ['[data-home-business-place]', 4.5],
  612 |     ['[data-open-status]', 4.5],
  613 |     ['.brand-story-circle[data-story-seen="false"] .brand-story-label', 4.5],
  614 |     ['.home-hero-promo-copy strong', 4.5],
  615 |     ['.home-hero-promo-cta', 4.5],
  616 |     ['[data-view="home"] .taba-home-search input', 4.5],
  617 |     ['.home-section-head h2', 4.5],
  618 |     ['.home-section-head button', 4.5],
  619 |     ['.home-section-title small', 4.5],
  620 |     ['.home-brand-banner small', 4.5],
  621 |     ['.home-brand-banner span', 4.5],
  622 |     ['.mobile-nav button.active .mn-label', 4.5],
  623 |     ['.mobile-nav button:not(.active) .mn-label', 4.5],
  624 |   ];
  625 | 
  626 |   for (const [selector, minimum] of probes) {
  627 |     const measured = await contrast(page, selector);
  628 |     expect(measured, `sin medición para ${selector}`).not.toBeNull();
  629 |     expect(measured.ratio, `${selector} → ${measured.ratio}:1`).toBeGreaterThanOrEqual(minimum);
  630 |   }
  631 | });
  632 | 
  633 | test('todo control de la home alcanza 44x44 en los anchos compactos', async ({ page }) => {
  634 |   await openHome(page, { stories: STORY_FIXTURES });
  635 | 
  636 |   for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 800 }, PHONE, { width: 412, height: 915 }]) {
  637 |     await page.setViewportSize(viewport);
  638 |     const undersized = await page.locator('[data-view="home"] button:not([hidden])').evaluateAll((nodes) => nodes
  639 |       .filter((node) => node.offsetParent !== null)
  640 |       .map((node) => {
  641 |         const rect = node.getBoundingClientRect();
  642 |         return { html: node.outerHTML.slice(0, 90), width: rect.width, height: rect.height };
  643 |       })
  644 |       .filter(({ width, height }) => width < 44 || height < 44));
  645 |     expect(undersized, `${viewport.width}x${viewport.height}`).toEqual([]);
  646 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  647 |   }
  648 | });
  649 | 
  650 | test('la barra de carrito aparece con productos, respeta la nav y no la tapa', async ({ page }) => {
  651 |   await openHome(page);
  652 |   const bar = page.locator('[data-floating-cart]');
  653 |   await expect(bar).toBeHidden();
  654 | 
  655 |   await page.locator('[data-home-sections] [data-add-product]:not([disabled])').first().click();
  656 |   await expect(bar).toBeVisible();
  657 |   await expect(bar.locator('[data-floating-cart-count]')).toHaveText('1 producto');
  658 |   await expect(bar.locator('[data-floating-cart-summary]')).toContainText(/^\$/);
  659 | 
  660 |   const [barBox, navBox] = await Promise.all([bar.boundingBox(), page.locator('.mobile-nav').boundingBox()]);
  661 |   expect(navBox.y - (barBox.y + barBox.height)).toBeGreaterThanOrEqual(10);
  662 |   expect(barBox.height).toBeGreaterThanOrEqual(44);
```