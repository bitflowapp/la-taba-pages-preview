# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: la-taba.spec.mjs >> carga inicial, home sin lista infinita y catálogo por categorías
- Location: tests\e2e\la-taba.spec.mjs:10:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('[data-view]')
Expected: 7
Received: 8
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for locator('[data-view]')
    14 × locator resolved to 8 elements
       - unexpected value "8"

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - button "Ir al inicio del comercio" [ref=e4] [cursor=pointer]:
      - strong [ref=e6]: La Taba
    - generic [ref=e7]:
      - navigation "Navegación principal" [ref=e8]:
        - button "Inicio" [ref=e9] [cursor=pointer]
        - button "Categorías" [ref=e10] [cursor=pointer]
        - button "Pedidos" [ref=e11] [cursor=pointer]
        - button "Seguir" [ref=e12] [cursor=pointer]
        - button "Cuenta" [ref=e13] [cursor=pointer]
      - button "Avenida Argentina 450" [ref=e14] [cursor=pointer]:
        - img [ref=e16]
        - strong [ref=e20]: Avenida Argentina 450
        - generic [ref=e21]: ›
    - generic "Buscar productos en La Taba" [ref=e22]:
      - img [ref=e23]
      - searchbox "Buscar productos en La Taba" [ref=e26]
    - button "Ver mi pedido" [ref=e28] [cursor=pointer]:
      - img [ref=e30]
  - main [ref=e33]:
    - generic [ref=e35]:
      - region "La Taba" [ref=e36]:
        - generic [ref=e37]:
          - heading "La Taba" [level=1] [ref=e38]:
            - generic [ref=e39]: La Taba
          - paragraph [ref=e40]: Delivery y retiro · Mendoza 827, Neuquén
          - paragraph [ref=e41]:
            - generic [ref=e42]: Pedidos disponibles
      - generic [ref=e43]:
        - img [ref=e44]
        - searchbox "Buscar productos o marcas" [ref=e47]
      - generic "Categorías de la tienda" [ref=e48]:
        - button "Todas" [ref=e49] [cursor=pointer]:
          - img [ref=e51]
          - generic [ref=e56]: Todas
        - button "Cervezas" [ref=e57] [cursor=pointer]:
          - img [ref=e59]
          - generic [ref=e62]: Cervezas
        - button "Energizantes" [ref=e63] [cursor=pointer]:
          - img [ref=e65]
          - generic [ref=e67]: Energizantes
      - button "Bien fría, como tiene que ser. La selección de cervezas del local, lista para llevar. Ver cervezas" [ref=e69] [cursor=pointer]:
        - generic [ref=e70]:
          - generic [ref=e71]: La vidriera
          - strong [ref=e72]: Bien fría, como tiene que ser
          - generic [ref=e73]: La selección de cervezas del local, lista para llevar.
          - generic [ref=e74]:
            - text: Ver cervezas
            - generic [ref=e75]: →
      - region "Destacados" [ref=e76]:
        - generic [ref=e77]:
          - heading "Destacados" [level=2] [ref=e79]
          - button "Ver todos" [ref=e80] [cursor=pointer]
        - generic [ref=e81]:
          - article [ref=e82]:
            - button "Guardar Heineken 473 ml · Lata de favoritos" [ref=e83] [cursor=pointer]:
              - img [ref=e84]
            - button "Ver Heineken. Venta exclusiva a mayores de 18 años" [ref=e86] [cursor=pointer]:
              - img "Heineken" [ref=e87]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e88]:
              - strong [ref=e89]: Heineken
              - generic [ref=e90]: 473 ml · Lata
              - generic [ref=e91]: $ 3.900
            - button "Agregar Heineken 473 ml · Lata al pedido" [ref=e93] [cursor=pointer]:
              - generic [ref=e94]: +
          - article [ref=e95]:
            - button "Guardar Corona Extra 330 ml de favoritos" [ref=e96] [cursor=pointer]:
              - img [ref=e97]
            - button "Ver Corona Extra. Venta exclusiva a mayores de 18 años" [ref=e99] [cursor=pointer]:
              - img "Corona Extra" [ref=e100]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e101]:
              - strong [ref=e102]: Corona Extra
              - generic [ref=e103]: 330 ml
              - generic [ref=e104]: $ 3.600
            - button "Agregar Corona Extra 330 ml al pedido" [ref=e106] [cursor=pointer]:
              - generic [ref=e107]: +
          - article [ref=e108]:
            - button "Guardar Red Bull Energy Drink 250 ml · Lata de favoritos" [ref=e109] [cursor=pointer]:
              - img [ref=e110]
            - button "Ver Red Bull Energy Drink" [ref=e112] [cursor=pointer]:
              - img "Red Bull Energy Drink" [ref=e113]
            - generic [ref=e114]:
              - strong [ref=e115]: Red Bull Energy Drink
              - generic [ref=e116]: 250 ml · Lata
              - generic [ref=e117]: $ 3.576
            - button "Agregar Red Bull Energy Drink 250 ml · Lata al pedido" [ref=e119] [cursor=pointer]:
              - generic [ref=e120]: +
          - article [ref=e121]:
            - button "Guardar Monster Mango Loco 473 ml · Lata de favoritos" [ref=e122] [cursor=pointer]:
              - img [ref=e123]
            - button "Ver Monster Mango Loco" [ref=e125] [cursor=pointer]:
              - img "Monster Mango Loco" [ref=e126]
            - generic [ref=e127]:
              - strong [ref=e128]: Monster Mango Loco
              - generic [ref=e129]: 473 ml · Lata
              - generic [ref=e130]: $ 3.390
            - button "Agregar Monster Mango Loco 473 ml · Lata al pedido" [ref=e132] [cursor=pointer]:
              - generic [ref=e133]: +
          - article [ref=e134]:
            - button "Guardar Speed Unlimited 473 ml · Lata de favoritos" [ref=e135] [cursor=pointer]:
              - img [ref=e136]
            - button "Ver Speed Unlimited Original" [ref=e138] [cursor=pointer]:
              - img "Speed Unlimited Original" [ref=e139]
            - generic [ref=e140]:
              - strong [ref=e141]: Speed Unlimited
              - generic [ref=e142]: 473 ml · Lata
              - generic [ref=e143]: $ 2.925
            - button "Agregar Speed Unlimited 473 ml · Lata al pedido" [ref=e145] [cursor=pointer]:
              - generic [ref=e146]: +
          - article [ref=e147]:
            - button "Guardar Imperial APA 473 ml · Lata de favoritos" [ref=e148] [cursor=pointer]:
              - img [ref=e149]
            - button "Ver Imperial APA. Venta exclusiva a mayores de 18 años" [ref=e151] [cursor=pointer]:
              - img "Imperial APA" [ref=e152]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e153]:
              - strong [ref=e154]: Imperial APA
              - generic [ref=e155]: 473 ml · Lata
              - generic [ref=e156]: $ 3.000
            - button "Agregar Imperial APA 473 ml · Lata al pedido" [ref=e158] [cursor=pointer]:
              - generic [ref=e159]: +
          - article [ref=e160]:
            - button "Guardar Schneider Rubia 710 ml · Lata de favoritos" [ref=e161] [cursor=pointer]:
              - img [ref=e162]
            - button "Ver Schneider Rubia. Venta exclusiva a mayores de 18 años" [ref=e164] [cursor=pointer]:
              - img "Schneider Rubia" [ref=e165]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e166]:
              - strong [ref=e167]: Schneider Rubia
              - generic [ref=e168]: 710 ml · Lata
              - generic [ref=e169]: $ 3.500
            - button "Agregar Schneider Rubia 710 ml · Lata al pedido" [ref=e171] [cursor=pointer]:
              - generic [ref=e172]: +
          - article [ref=e173]:
            - button "Guardar Speed Unlimited Zero Sugar 473 ml · Lata de favoritos" [ref=e174] [cursor=pointer]:
              - img [ref=e175]
            - button "Ver Speed Unlimited Zero Sugar" [ref=e177] [cursor=pointer]:
              - img "Speed Unlimited Zero Sugar" [ref=e178]
            - generic [ref=e179]:
              - strong [ref=e180]: Speed Unlimited Zero Sugar
              - generic [ref=e181]: 473 ml · Lata
              - generic [ref=e182]: $ 2.925
            - button "Agregar Speed Unlimited Zero Sugar 473 ml · Lata al pedido" [ref=e184] [cursor=pointer]:
              - generic [ref=e185]: +
          - article [ref=e186]:
            - button "Guardar Imperial Cream Stout 473 ml · Lata de favoritos" [ref=e187] [cursor=pointer]:
              - img [ref=e188]
            - button "Ver Imperial Cream Stout. Venta exclusiva a mayores de 18 años" [ref=e190] [cursor=pointer]:
              - img "Imperial Cream Stout" [ref=e191]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e192]:
              - strong [ref=e193]: Imperial Cream Stout
              - generic [ref=e194]: 473 ml · Lata
              - generic [ref=e195]: $ 3.000
            - button "Agregar Imperial Cream Stout 473 ml · Lata al pedido" [ref=e197] [cursor=pointer]:
              - generic [ref=e198]: +
          - article [ref=e199]:
            - button "Guardar Imperial Extra Lager 473 ml · Lata de favoritos" [ref=e200] [cursor=pointer]:
              - img [ref=e201]
            - button "Ver Imperial Extra Lager. Venta exclusiva a mayores de 18 años" [ref=e203] [cursor=pointer]:
              - img "Imperial Extra Lager" [ref=e204]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e205]:
              - strong [ref=e206]: Imperial Extra Lager
              - generic [ref=e207]: 473 ml · Lata
              - generic [ref=e208]: $ 3.000
            - button "Agregar Imperial Extra Lager 473 ml · Lata al pedido" [ref=e210] [cursor=pointer]:
              - generic [ref=e211]: +
          - article [ref=e212]:
            - button "Guardar Imperial Golden 473 ml · Lata de favoritos" [ref=e213] [cursor=pointer]:
              - img [ref=e214]
            - button "Ver Imperial Golden. Venta exclusiva a mayores de 18 años" [ref=e216] [cursor=pointer]:
              - img "Imperial Golden" [ref=e217]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e218]:
              - strong [ref=e219]: Imperial Golden
              - generic [ref=e220]: 473 ml · Lata
              - generic [ref=e221]: $ 3.000
            - button "Agregar Imperial Golden 473 ml · Lata al pedido" [ref=e223] [cursor=pointer]:
              - generic [ref=e224]: +
      - generic [ref=e225]:
        - button "Ver las 2 historias nuevas de La Taba" [ref=e227] [cursor=pointer]
        - generic [ref=e230]:
          - button "Ver la historia Heineken bien fría. Cervezas de La Taba. Nueva" [ref=e231] [cursor=pointer]:
            - generic [ref=e234]: Cervezas
          - button "Ver la historia Monster para la noche. Energizantes de La Taba. Nueva" [ref=e235] [cursor=pointer]:
            - generic [ref=e238]: Energizantes
      - region "Combos" [ref=e239]:
        - generic [ref=e241]:
          - heading "Combos" [level=2] [ref=e242]
          - generic [ref=e243]: Armados por el local · hasta $ 2.752 de ahorro
        - generic [ref=e244]:
          - article [ref=e245]:
            - button "Ver el combo Previa Imperial" [ref=e246] [cursor=pointer]:
              - emphasis [ref=e249]: ×6
              - generic [ref=e250]: Ahorrás $ 2.200
            - generic [ref=e251]:
              - generic [ref=e252]:
                - strong [ref=e253]: Previa Imperial
                - generic [ref=e254]: Seis latas bien frías para arrancar
              - paragraph [ref=e255]: 6× Imperial Golden
              - generic [ref=e256]:
                - generic [ref=e257]: $ 18.000
                - strong [ref=e258]: $ 15.800
                - emphasis [ref=e259]: −12.2%
              - generic [ref=e260]:
                - generic [ref=e261]: "+18"
                - generic [ref=e262]: 6 unidades
                - generic [ref=e263]: Quedan 16
              - button "Ver qué trae" [ref=e264] [cursor=pointer]
          - article [ref=e265]:
            - button "Ver el combo Heineken x6" [ref=e266] [cursor=pointer]:
              - emphasis [ref=e269]: ×6
              - generic [ref=e270]: Ahorrás $ 2.400
            - generic [ref=e271]:
              - generic [ref=e272]:
                - strong [ref=e273]: Heineken x6
                - generic [ref=e274]: La verde, por media docena
              - paragraph [ref=e275]: 6× Heineken
              - generic [ref=e276]:
                - generic [ref=e277]: $ 23.400
                - strong [ref=e278]: $ 21.000
                - emphasis [ref=e279]: −10.3%
              - generic [ref=e280]:
                - generic [ref=e281]: "+18"
                - generic [ref=e282]: 6 unidades
                - generic [ref=e283]: Quedan 16
              - button "Ver qué trae" [ref=e284] [cursor=pointer]
          - article [ref=e285]:
            - button "Ver el combo Corona Extra x6" [ref=e286] [cursor=pointer]:
              - emphasis [ref=e289]: ×6
              - generic [ref=e290]: Ahorrás $ 2.200
            - generic [ref=e291]:
              - generic [ref=e292]:
                - strong [ref=e293]: Corona Extra x6
                - generic [ref=e294]: Seis porrones de 330 ml
              - paragraph [ref=e295]: 6× Corona Extra
              - generic [ref=e296]:
                - generic [ref=e297]: $ 21.600
                - strong [ref=e298]: $ 19.400
                - emphasis [ref=e299]: −10.2%
              - generic [ref=e300]:
                - generic [ref=e301]: "+18"
                - generic [ref=e302]: 6 unidades
                - generic [ref=e303]: Quedan 16
              - button "Ver qué trae" [ref=e304] [cursor=pointer]
          - article [ref=e305]:
            - button "Ver el combo Birra y energía" [ref=e306] [cursor=pointer]:
              - generic [ref=e307]:
                - emphasis [ref=e309]: ×4
                - emphasis [ref=e311]: ×2
              - generic [ref=e312]: Ahorrás $ 2.150
            - generic [ref=e313]:
              - generic [ref=e314]:
                - strong [ref=e315]: Birra y energía
                - generic [ref=e316]: Cuatro latas y dos para aguantar
              - paragraph [ref=e317]: 4× Imperial Golden · 2× Speed Unlimited Original
              - generic [ref=e318]:
                - generic [ref=e319]: $ 17.850
                - strong [ref=e320]: $ 15.700
                - emphasis [ref=e321]: −12%
              - generic [ref=e322]:
                - generic [ref=e323]: "+18"
                - generic [ref=e324]: 6 unidades
                - generic [ref=e325]: Quedan 24
              - button "Ver qué trae" [ref=e326] [cursor=pointer]
          - article [ref=e327]:
            - button "Ver el combo Tabla de cervezas" [ref=e328] [cursor=pointer]:
              - generic [ref=e334]: "+2"
              - generic [ref=e335]: Ahorrás $ 2.000
            - generic [ref=e336]:
              - generic [ref=e337]:
                - strong [ref=e338]: Tabla de cervezas
                - generic [ref=e339]: Una de cada una, seis en total
              - paragraph [ref=e340]: 1× Imperial Golden · 1× Imperial Extra Lager · 1× Imperial APA · 1× Imperial Cream Stout · 1× Schneider Rubia · 1× Corona Extra
              - generic [ref=e341]:
                - generic [ref=e342]: $ 19.100
                - strong [ref=e343]: $ 17.100
                - emphasis [ref=e344]: −10.5%
              - generic [ref=e345]:
                - generic [ref=e346]: "+18"
                - generic [ref=e347]: 6 unidades
                - generic [ref=e348]: Quedan 99
              - button "Ver qué trae" [ref=e349] [cursor=pointer]
          - article [ref=e350]:
            - button "Ver el combo Noche larga" [ref=e351] [cursor=pointer]:
              - generic [ref=e352]:
                - emphasis [ref=e354]: ×4
                - emphasis [ref=e356]: ×2
              - generic [ref=e357]: Ahorrás $ 2.752
            - generic [ref=e358]:
              - generic [ref=e359]:
                - strong [ref=e360]: Noche larga
                - generic [ref=e361]: Cuatro Heineken y dos Red Bull
              - paragraph [ref=e362]: 4× Heineken · 2× Red Bull Energy Drink
              - generic [ref=e363]:
                - generic [ref=e364]: $ 22.752
                - strong [ref=e365]: $ 20.000
                - emphasis [ref=e366]: −12.1%
              - generic [ref=e367]:
                - generic [ref=e368]: "+18"
                - generic [ref=e369]: 6 unidades
                - generic [ref=e370]: Quedan 24
              - button "Ver qué trae" [ref=e371] [cursor=pointer]
          - article [ref=e372]:
            - button "Ver el combo Cuatro para arrancar" [ref=e373] [cursor=pointer]:
              - emphasis [ref=e376]: ×4
              - generic [ref=e377]: Ahorrás $ 1.200
            - generic [ref=e378]:
              - generic [ref=e379]:
                - strong [ref=e380]: Cuatro para arrancar
                - generic [ref=e381]: Speed por cuatro
              - paragraph [ref=e382]: 4× Speed Unlimited Original
              - generic [ref=e383]:
                - generic [ref=e384]: $ 11.700
                - strong [ref=e385]: $ 10.500
                - emphasis [ref=e386]: −10.3%
              - generic [ref=e387]:
                - generic [ref=e388]: 4 unidades
                - generic [ref=e389]: Quedan 24
              - button "Ver qué trae" [ref=e390] [cursor=pointer]
      - generic [ref=e391]:
        - region "Cervezas" [ref=e392]:
          - generic [ref=e393]:
            - heading "Cervezas" [level=2] [ref=e395]
            - button "Ver todos" [ref=e396] [cursor=pointer]
          - generic [ref=e397]:
            - article [ref=e398]:
              - button "Guardar Heineken 473 ml · Lata de favoritos" [ref=e399] [cursor=pointer]:
                - img [ref=e400]
              - button "Ver Heineken. Venta exclusiva a mayores de 18 años" [ref=e402] [cursor=pointer]:
                - img "Heineken" [ref=e403]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e404]:
                - strong [ref=e405]: Heineken
                - generic [ref=e406]: 473 ml · Lata
                - generic [ref=e407]: $ 3.900
              - button "Agregar Heineken 473 ml · Lata al pedido" [ref=e409] [cursor=pointer]:
                - generic [ref=e410]: +
            - article [ref=e411]:
              - button "Guardar Corona Extra 330 ml de favoritos" [ref=e412] [cursor=pointer]:
                - img [ref=e413]
              - button "Ver Corona Extra. Venta exclusiva a mayores de 18 años" [ref=e415] [cursor=pointer]:
                - img "Corona Extra" [ref=e416]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e417]:
                - strong [ref=e418]: Corona Extra
                - generic [ref=e419]: 330 ml
                - generic [ref=e420]: $ 3.600
              - button "Agregar Corona Extra 330 ml al pedido" [ref=e422] [cursor=pointer]:
                - generic [ref=e423]: +
            - article [ref=e424]:
              - button "Guardar Imperial APA 473 ml · Lata de favoritos" [ref=e425] [cursor=pointer]:
                - img [ref=e426]
              - button "Ver Imperial APA. Venta exclusiva a mayores de 18 años" [ref=e428] [cursor=pointer]:
                - img "Imperial APA" [ref=e429]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e430]:
                - strong [ref=e431]: Imperial APA
                - generic [ref=e432]: 473 ml · Lata
                - generic [ref=e433]: $ 3.000
              - button "Agregar Imperial APA 473 ml · Lata al pedido" [ref=e435] [cursor=pointer]:
                - generic [ref=e436]: +
            - article [ref=e437]:
              - button "Guardar Imperial Cream Stout 473 ml · Lata de favoritos" [ref=e438] [cursor=pointer]:
                - img [ref=e439]
              - button "Ver Imperial Cream Stout. Venta exclusiva a mayores de 18 años" [ref=e441] [cursor=pointer]:
                - img "Imperial Cream Stout" [ref=e442]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e443]:
                - strong [ref=e444]: Imperial Cream Stout
                - generic [ref=e445]: 473 ml · Lata
                - generic [ref=e446]: $ 3.000
              - button "Agregar Imperial Cream Stout 473 ml · Lata al pedido" [ref=e448] [cursor=pointer]:
                - generic [ref=e449]: +
            - article [ref=e450]:
              - button "Guardar Imperial Extra Lager 473 ml · Lata de favoritos" [ref=e451] [cursor=pointer]:
                - img [ref=e452]
              - button "Ver Imperial Extra Lager. Venta exclusiva a mayores de 18 años" [ref=e454] [cursor=pointer]:
                - img "Imperial Extra Lager" [ref=e455]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e456]:
                - strong [ref=e457]: Imperial Extra Lager
                - generic [ref=e458]: 473 ml · Lata
                - generic [ref=e459]: $ 3.000
              - button "Agregar Imperial Extra Lager 473 ml · Lata al pedido" [ref=e461] [cursor=pointer]:
                - generic [ref=e462]: +
            - article [ref=e463]:
              - button "Guardar Imperial Golden 473 ml · Lata de favoritos" [ref=e464] [cursor=pointer]:
                - img [ref=e465]
              - button "Ver Imperial Golden. Venta exclusiva a mayores de 18 años" [ref=e467] [cursor=pointer]:
                - img "Imperial Golden" [ref=e468]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e469]:
                - strong [ref=e470]: Imperial Golden
                - generic [ref=e471]: 473 ml · Lata
                - generic [ref=e472]: $ 3.000
              - button "Agregar Imperial Golden 473 ml · Lata al pedido" [ref=e474] [cursor=pointer]:
                - generic [ref=e475]: +
            - article [ref=e476]:
              - button "Guardar Schneider Rubia 710 ml · Lata de favoritos" [ref=e477] [cursor=pointer]:
                - img [ref=e478]
              - button "Ver Schneider Rubia. Venta exclusiva a mayores de 18 años" [ref=e480] [cursor=pointer]:
                - img "Schneider Rubia" [ref=e481]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e482]:
                - strong [ref=e483]: Schneider Rubia
                - generic [ref=e484]: 710 ml · Lata
                - generic [ref=e485]: $ 3.500
              - button "Agregar Schneider Rubia 710 ml · Lata al pedido" [ref=e487] [cursor=pointer]:
                - generic [ref=e488]: +
        - region "Energizantes" [ref=e489]:
          - generic [ref=e490]:
            - heading "Energizantes" [level=2] [ref=e492]
            - button "Ver todos" [ref=e493] [cursor=pointer]
          - generic [ref=e494]:
            - article [ref=e495]:
              - button "Guardar Red Bull Energy Drink 250 ml · Lata de favoritos" [ref=e496] [cursor=pointer]:
                - img [ref=e497]
              - button "Ver Red Bull Energy Drink" [ref=e499] [cursor=pointer]:
                - img "Red Bull Energy Drink" [ref=e500]
              - generic [ref=e501]:
                - strong [ref=e502]: Red Bull Energy Drink
                - generic [ref=e503]: 250 ml · Lata
                - generic [ref=e504]: $ 3.576
              - button "Agregar Red Bull Energy Drink 250 ml · Lata al pedido" [ref=e506] [cursor=pointer]:
                - generic [ref=e507]: +
            - article [ref=e508]:
              - button "Guardar Monster Mango Loco 473 ml · Lata de favoritos" [ref=e509] [cursor=pointer]:
                - img [ref=e510]
              - button "Ver Monster Mango Loco" [ref=e512] [cursor=pointer]:
                - img "Monster Mango Loco" [ref=e513]
              - generic [ref=e514]:
                - strong [ref=e515]: Monster Mango Loco
                - generic [ref=e516]: 473 ml · Lata
                - generic [ref=e517]: $ 3.390
              - button "Agregar Monster Mango Loco 473 ml · Lata al pedido" [ref=e519] [cursor=pointer]:
                - generic [ref=e520]: +
            - article [ref=e521]:
              - button "Guardar Speed Unlimited 473 ml · Lata de favoritos" [ref=e522] [cursor=pointer]:
                - img [ref=e523]
              - button "Ver Speed Unlimited Original" [ref=e525] [cursor=pointer]:
                - img "Speed Unlimited Original" [ref=e526]
              - generic [ref=e527]:
                - strong [ref=e528]: Speed Unlimited
                - generic [ref=e529]: 473 ml · Lata
                - generic [ref=e530]: $ 2.925
              - button "Agregar Speed Unlimited 473 ml · Lata al pedido" [ref=e532] [cursor=pointer]:
                - generic [ref=e533]: +
            - article [ref=e534]:
              - button "Guardar Speed Unlimited Zero Sugar 473 ml · Lata de favoritos" [ref=e535] [cursor=pointer]:
                - img [ref=e536]
              - button "Ver Speed Unlimited Zero Sugar" [ref=e538] [cursor=pointer]:
                - img "Speed Unlimited Zero Sugar" [ref=e539]
              - generic [ref=e540]:
                - strong [ref=e541]: Speed Unlimited Zero Sugar
                - generic [ref=e542]: 473 ml · Lata
                - generic [ref=e543]: $ 2.925
              - button "Agregar Speed Unlimited Zero Sugar 473 ml · Lata al pedido" [ref=e545] [cursor=pointer]:
                - generic [ref=e546]: +
        - button "Heineken bien fría. Ver Heineken en el catálogo" [ref=e548] [cursor=pointer]:
          - generic [ref=e549]: La marca
          - strong [ref=e550]: Heineken bien fría
          - generic [ref=e551]:
            - text: Ver Heineken
            - generic [ref=e552]: →
      - region "Selección del local" [ref=e553]:
        - generic [ref=e554]:
          - generic [ref=e555]:
            - heading "Selección del local" [level=2] [ref=e556]
            - generic [ref=e557]: Bodega y destilados
          - button "Ver todos" [ref=e558] [cursor=pointer]
        - generic [ref=e559]:
          - article [ref=e560]:
            - button "Guardar Rutini Malbec 750 ml de favoritos" [ref=e561] [cursor=pointer]:
              - img [ref=e562]
            - button "Ver Rutini Malbec. Venta exclusiva a mayores de 18 años" [ref=e564] [cursor=pointer]:
              - img "Rutini Malbec" [ref=e565]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e566]:
              - strong [ref=e567]: Rutini Malbec
              - generic [ref=e568]: 750 ml
              - generic [ref=e569]: Precio próximamente
            - button "Ver la ficha de Rutini Malbec. Este producto todavía no está disponible para compra." [ref=e571] [cursor=pointer]:
              - generic [ref=e572]: Ver detalle
          - article [ref=e573]:
            - button "Guardar Buhero Negro 450 ml de favoritos" [ref=e574] [cursor=pointer]:
              - img [ref=e575]
            - button "Ver Buhero Negro. Venta exclusiva a mayores de 18 años" [ref=e577] [cursor=pointer]:
              - img "Buhero Negro" [ref=e578]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e579]:
              - strong [ref=e580]: Buhero Negro
              - generic [ref=e581]: 450 ml
              - generic [ref=e582]: Precio próximamente
            - button "Ver la ficha de Buhero Negro. Este producto todavía no está disponible para compra." [ref=e584] [cursor=pointer]:
              - generic [ref=e585]: Ver detalle
          - article [ref=e586]:
            - button "Guardar Cinzano Rosso 950 ml de favoritos" [ref=e587] [cursor=pointer]:
              - img [ref=e588]
            - button "Ver Cinzano Rosso. Venta exclusiva a mayores de 18 años" [ref=e590] [cursor=pointer]:
              - img "Cinzano Rosso" [ref=e591]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e592]:
              - strong [ref=e593]: Cinzano Rosso
              - generic [ref=e594]: 950 ml
              - generic [ref=e595]: Precio próximamente
            - button "Ver la ficha de Cinzano Rosso. Este producto todavía no está disponible para compra." [ref=e597] [cursor=pointer]:
              - generic [ref=e598]: Ver detalle
          - article [ref=e599]:
            - button "Guardar Chandon Délice 750 ml de favoritos" [ref=e600] [cursor=pointer]:
              - img [ref=e601]
            - button "Ver Chandon Délice. Venta exclusiva a mayores de 18 años" [ref=e603] [cursor=pointer]:
              - img "Chandon Délice" [ref=e604]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e605]:
              - strong [ref=e606]: Chandon Délice
              - generic [ref=e607]: 750 ml
              - generic [ref=e608]: Precio próximamente
            - button "Ver la ficha de Chandon Délice. Este producto todavía no está disponible para compra." [ref=e610] [cursor=pointer]:
              - generic [ref=e611]: Ver detalle
      - button "Ver catálogo completo" [ref=e612] [cursor=pointer]:
        - generic [ref=e613]: Ver catálogo completo
        - generic [ref=e614]: ›
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { fillCheckout, gotoDemoReset, installBrowserStubs, installPageGuards, openBusinessSection, openFirstProductModal, seedCartAboveMinimum, seedCheckoutProfile, waitForToast } from './helpers.mjs';
  3   | 
  4   | const TRACKING_GPS_NOTE = 'Seguimiento por estados, sin GPS ni ubicación en vivo.';
  5   | 
  6   | test.beforeEach(async ({ page }) => {
  7   |   await installBrowserStubs(page);
  8   | });
  9   | 
  10  | test('carga inicial, home sin lista infinita y catálogo por categorías', async ({ page }) => {
  11  |   const guards = installPageGuards(page);
  12  | 
  13  |   await page.goto('/?demo=1');
  14  |   await expect(page.locator('[data-cart-count]').first()).toHaveText('0');
  15  |   await expect(page.locator('[data-cart-total-small]')).toHaveText(/\$\s*0/);
  16  |   await expect(page.locator('[data-view="home"]')).toBeVisible();
  17  |   await expect(page.locator('[data-view="cart"]')).toBeHidden();
> 18  |   await expect(page.locator('[data-view]')).toHaveCount(7);
      |                                             ^ Error: expect(locator).toHaveCount(expected) failed
  19  | 
  20  |   // El home no muestra el grid de productos completo (sin lista infinita).
  21  |   await expect(page.locator('[data-view="home"] [data-product-grid]')).toHaveCount(0);
  22  |   await expect(page.locator('[data-view="home"] .category-strip')).toBeVisible();
  23  |   await expect(page.locator('[data-home-active-order]')).toBeHidden();
  24  | 
  25  |   // Entrar al catálogo desde el CTA del home.
  26  |   await page.locator('[data-view="home"] [data-nav-view="catalog"]').first().click();
  27  |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  28  |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  29  |   await expect.poll(() => page.locator('[data-product-grid] .product-card').count()).toBeGreaterThan(0);
  30  | 
  31  |   // Seleccionar la categoría de gaseosas.
  32  |   await page.locator('[data-view="catalog"] [data-category-id="gaseosas"]').click();
  33  |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  34  | 
  35  |   // Seleccionar la categoría de aguas.
  36  |   await page.locator('[data-view="catalog"] [data-category-id="mixers"]').click();
  37  |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  38  | 
  39  |   // Ordenar por menor precio.
  40  |   await page.locator('[data-sort-select]').selectOption('price_asc');
  41  |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  42  | 
  43  |   await openFirstProductModal(page);
  44  |   await page.locator('[data-close-modal]').click();
  45  | 
  46  |   const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  47  |   expect(overflow).toBeTruthy();
  48  | 
  49  |   await guards.assertClean();
  50  | });
  51  | 
  52  | test('agregar producto desde una categoría del catálogo', async ({ page }) => {
  53  |   const guards = installPageGuards(page);
  54  | 
  55  |   await page.goto('/?demo=1');
  56  |   await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  57  |   // Energizantes: gaseosas quedó sin comprables al retirar de la góndola el
  58  |   // pack de proveedor; sus botellas sueltas todavía esperan precio.
  59  |   await page.locator('[data-view="catalog"] [data-category-id="energizantes"]').click();
  60  | 
  61  |   // Una sola unidad: este contrato mide el stepper de la tarjeta, no el mínimo
  62  |   // de delivery, así que no hace falta llegar a él.
  63  |   await page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first().click();
  64  |   await waitForToast(page, /agregado al pedido/);
  65  |   await expect(page.locator('[data-cart-count]').first()).not.toHaveText('0');
  66  |   const desktopCart = page.locator('.topbar [data-open-cart]');
  67  |   await expect(desktopCart).toBeVisible();
  68  |   await expect(page.locator('[data-cart-total-small]')).toContainText('$');
  69  |   await desktopCart.click();
  70  |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  71  |   await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  72  | 
  73  |   // La tarjeta del producto agregado muestra el stepper de cantidad.
  74  |   const card = page.locator('[data-product-grid] .product-card.in-cart').first();
  75  |   await expect(card).toBeVisible();
  76  |   await expect(card.locator('.qty-stepper strong')).toHaveText('1');
  77  |   await card.locator('[data-cart-inc]').click();
  78  |   await expect(card.locator('.qty-stepper strong')).toHaveText('2');
  79  |   await expect(page.locator('[data-cart-count]').first()).toHaveText('2');
  80  |   await card.locator('[data-cart-dec]').click();
  81  |   await expect(card.locator('.qty-stepper strong')).toHaveText('1');
  82  | 
  83  |   await guards.assertClean();
  84  | });
  85  | 
  86  | test('catálogo: tiles limpios (nombre debajo) y breadcrumb compacto', async ({ page }) => {
  87  |   const guards = installPageGuards(page);
  88  | 
  89  |   await page.goto('/?demo=1');
  90  |   await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  91  |   await page.locator('[data-view="catalog"] [data-category-id="energizantes"]').click();
  92  | 
  93  |   const card = page.locator('[data-product-grid] .product-card').first();
  94  |   await expect(card).toBeVisible();
  95  |   // El nombre del producto vive en el cuerpo (h3), no superpuesto sobre el tile.
  96  |   await expect(card.locator('.product-body h3')).toBeVisible();
  97  |   await expect(card.locator('.product-media img')).toBeVisible();
  98  | 
  99  |   await expect(page.locator('[data-view="catalog"] .section-head .secondary-button')).toHaveCount(0);
  100 | 
  101 |   await guards.assertClean();
  102 | });
  103 | 
  104 | test('carrito vacío oculta el formulario de checkout y lo muestra al cargar productos', async ({ page }) => {
  105 |   const guards = installPageGuards(page);
  106 | 
  107 |   await page.goto('/?demo=1#cart');
  108 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  109 |   // Con el carrito vacío no debe verse el formulario "Datos para finalizar" ni vaciar.
  110 |   await expect(page.locator('[data-cart-list]')).toContainText('Tu pedido está vacío');
  111 |   await expect(page.locator('[data-checkout-form]')).toBeHidden();
  112 |   await expect(page.locator('[data-clear-cart]')).toBeHidden();
  113 |   await expect(page.locator('[data-cart-list] [data-nav-view="catalog"]')).toBeVisible();
  114 | 
  115 |   // Al agregar un producto, el formulario aparece para completar el pedido.
  116 |   await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  117 |   await seedCartAboveMinimum(page);
  118 |   await page.locator('.desktop-nav [data-nav-view="cart"]').click();
```