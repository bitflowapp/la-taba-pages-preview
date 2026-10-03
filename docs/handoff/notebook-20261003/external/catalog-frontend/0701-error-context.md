# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: taba2-brand-home.spec.mjs >> sin historias publicadas el logo no se anuncia como botón
- Location: tests\e2e\taba2-brand-home.spec.mjs:152:1

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.evaluate: Test timeout of 45000ms exceeded.
Call log:
  - waiting for locator('.brand-hero [data-stories-static] .brand-logo-ring')

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - button "Ir al inicio del comercio" [ref=e4] [cursor=pointer]:
      - strong [ref=e6]: La Taba
    - button "Avenida Argentina 450" [ref=e8] [cursor=pointer]:
      - img [ref=e10]
      - strong [ref=e14]: Avenida Argentina 450
      - generic [ref=e15]: ›
    - button "Ver mi pedido" [ref=e17] [cursor=pointer]:
      - img [ref=e19]
  - main [ref=e22]:
    - generic [ref=e24]:
      - region "La Taba" [ref=e25]:
        - generic [ref=e26]:
          - heading "La Taba" [level=1] [ref=e27]:
            - generic [ref=e28]: La Taba
          - paragraph [ref=e29]: Delivery y retiro · Mendoza 827, Neuquén
          - paragraph [ref=e30]:
            - generic [ref=e31]: Pedidos disponibles
      - generic [ref=e32]:
        - img [ref=e33]
        - searchbox "Buscar productos o marcas" [ref=e36]
      - generic "Categorías de la tienda" [ref=e37]:
        - button "Todas" [ref=e38] [cursor=pointer]:
          - img [ref=e40]
          - generic [ref=e45]: Todas
        - button "Cervezas" [ref=e46] [cursor=pointer]:
          - img [ref=e48]
          - generic [ref=e51]: Cervezas
        - button "Energizantes" [ref=e52] [cursor=pointer]:
          - img [ref=e54]
          - generic [ref=e56]: Energizantes
      - button "Bien fría, como tiene que ser. La selección de cervezas del local, lista para llevar. Ver cervezas" [ref=e58] [cursor=pointer]:
        - generic [ref=e59]:
          - generic [ref=e60]: La vidriera
          - strong [ref=e61]: Bien fría, como tiene que ser
          - generic [ref=e62]:
            - text: Ver cervezas
            - generic [ref=e63]: →
      - region "Destacados" [ref=e64]:
        - generic [ref=e65]:
          - heading "Destacados" [level=2] [ref=e67]
          - button "Ver todos" [ref=e68] [cursor=pointer]
        - generic [ref=e69]:
          - article [ref=e70]:
            - button "Guardar Heineken 473 ml · Lata de favoritos" [ref=e71] [cursor=pointer]:
              - img [ref=e72]
            - button "Ver Heineken. Venta exclusiva a mayores de 18 años" [ref=e74] [cursor=pointer]:
              - img "Heineken" [ref=e75]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e76]:
              - strong [ref=e77]: Heineken
              - generic [ref=e78]: 473 ml · Lata
              - generic [ref=e79]: $ 3.900
            - button "Agregar Heineken 473 ml · Lata al pedido" [ref=e81] [cursor=pointer]:
              - generic [ref=e82]: +
          - article [ref=e83]:
            - button "Guardar Corona Extra 330 ml de favoritos" [ref=e84] [cursor=pointer]:
              - img [ref=e85]
            - button "Ver Corona Extra. Venta exclusiva a mayores de 18 años" [ref=e87] [cursor=pointer]:
              - img "Corona Extra" [ref=e88]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e89]:
              - strong [ref=e90]: Corona Extra
              - generic [ref=e91]: 330 ml
              - generic [ref=e92]: $ 3.600
            - button "Agregar Corona Extra 330 ml al pedido" [ref=e94] [cursor=pointer]:
              - generic [ref=e95]: +
          - article [ref=e96]:
            - button "Guardar Red Bull Energy Drink 250 ml · Lata de favoritos" [ref=e97] [cursor=pointer]:
              - img [ref=e98]
            - button "Ver Red Bull Energy Drink" [ref=e100] [cursor=pointer]:
              - img "Red Bull Energy Drink" [ref=e101]
            - generic [ref=e102]:
              - strong [ref=e103]: Red Bull Energy Drink
              - generic [ref=e104]: 250 ml · Lata
              - generic [ref=e105]: $ 3.576
            - button "Agregar Red Bull Energy Drink 250 ml · Lata al pedido" [ref=e107] [cursor=pointer]:
              - generic [ref=e108]: +
          - article [ref=e109]:
            - button "Guardar Monster Mango Loco 473 ml · Lata de favoritos" [ref=e110] [cursor=pointer]:
              - img [ref=e111]
            - button "Ver Monster Mango Loco" [ref=e113] [cursor=pointer]:
              - img "Monster Mango Loco" [ref=e114]
            - generic [ref=e115]:
              - strong [ref=e116]: Monster Mango Loco
              - generic [ref=e117]: 473 ml · Lata
              - generic [ref=e118]: $ 3.390
            - button "Agregar Monster Mango Loco 473 ml · Lata al pedido" [ref=e120] [cursor=pointer]:
              - generic [ref=e121]: +
          - article [ref=e122]:
            - button "Guardar Speed Unlimited 473 ml · Lata de favoritos" [ref=e123] [cursor=pointer]:
              - img [ref=e124]
            - button "Ver Speed Unlimited Original" [ref=e126] [cursor=pointer]:
              - img "Speed Unlimited Original" [ref=e127]
            - generic [ref=e128]:
              - strong [ref=e129]: Speed Unlimited
              - generic [ref=e130]: 473 ml · Lata
              - generic [ref=e131]: $ 2.925
            - button "Agregar Speed Unlimited 473 ml · Lata al pedido" [ref=e133] [cursor=pointer]:
              - generic [ref=e134]: +
          - article [ref=e135]:
            - button "Guardar Imperial APA 473 ml · Lata de favoritos" [ref=e136] [cursor=pointer]:
              - img [ref=e137]
            - button "Ver Imperial APA. Venta exclusiva a mayores de 18 años" [ref=e139] [cursor=pointer]:
              - img "Imperial APA" [ref=e140]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e141]:
              - strong [ref=e142]: Imperial APA
              - generic [ref=e143]: 473 ml · Lata
              - generic [ref=e144]: $ 3.000
            - button "Agregar Imperial APA 473 ml · Lata al pedido" [ref=e146] [cursor=pointer]:
              - generic [ref=e147]: +
          - article [ref=e148]:
            - button "Guardar Schneider Rubia 710 ml · Lata de favoritos" [ref=e149] [cursor=pointer]:
              - img [ref=e150]
            - button "Ver Schneider Rubia. Venta exclusiva a mayores de 18 años" [ref=e152] [cursor=pointer]:
              - img "Schneider Rubia" [ref=e153]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e154]:
              - strong [ref=e155]: Schneider Rubia
              - generic [ref=e156]: 710 ml · Lata
              - generic [ref=e157]: $ 3.500
            - button "Agregar Schneider Rubia 710 ml · Lata al pedido" [ref=e159] [cursor=pointer]:
              - generic [ref=e160]: +
          - article [ref=e161]:
            - button "Guardar Speed Unlimited Zero Sugar 473 ml · Lata de favoritos" [ref=e162] [cursor=pointer]:
              - img [ref=e163]
            - button "Ver Speed Unlimited Zero Sugar" [ref=e165] [cursor=pointer]:
              - img "Speed Unlimited Zero Sugar" [ref=e166]
            - generic [ref=e167]:
              - strong [ref=e168]: Speed Unlimited Zero Sugar
              - generic [ref=e169]: 473 ml · Lata
              - generic [ref=e170]: $ 2.925
            - button "Agregar Speed Unlimited Zero Sugar 473 ml · Lata al pedido" [ref=e172] [cursor=pointer]:
              - generic [ref=e173]: +
          - article [ref=e174]:
            - button "Guardar Imperial Cream Stout 473 ml · Lata de favoritos" [ref=e175] [cursor=pointer]:
              - img [ref=e176]
            - button "Ver Imperial Cream Stout. Venta exclusiva a mayores de 18 años" [ref=e178] [cursor=pointer]:
              - img "Imperial Cream Stout" [ref=e179]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e180]:
              - strong [ref=e181]: Imperial Cream Stout
              - generic [ref=e182]: 473 ml · Lata
              - generic [ref=e183]: $ 3.000
            - button "Agregar Imperial Cream Stout 473 ml · Lata al pedido" [ref=e185] [cursor=pointer]:
              - generic [ref=e186]: +
          - article [ref=e187]:
            - button "Guardar Imperial Extra Lager 473 ml · Lata de favoritos" [ref=e188] [cursor=pointer]:
              - img [ref=e189]
            - button "Ver Imperial Extra Lager. Venta exclusiva a mayores de 18 años" [ref=e191] [cursor=pointer]:
              - img "Imperial Extra Lager" [ref=e192]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e193]:
              - strong [ref=e194]: Imperial Extra Lager
              - generic [ref=e195]: 473 ml · Lata
              - generic [ref=e196]: $ 3.000
            - button "Agregar Imperial Extra Lager 473 ml · Lata al pedido" [ref=e198] [cursor=pointer]:
              - generic [ref=e199]: +
          - article [ref=e200]:
            - button "Guardar Imperial Golden 473 ml · Lata de favoritos" [ref=e201] [cursor=pointer]:
              - img [ref=e202]
            - button "Ver Imperial Golden. Venta exclusiva a mayores de 18 años" [ref=e204] [cursor=pointer]:
              - img "Imperial Golden" [ref=e205]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e206]:
              - strong [ref=e207]: Imperial Golden
              - generic [ref=e208]: 473 ml · Lata
              - generic [ref=e209]: $ 3.000
            - button "Agregar Imperial Golden 473 ml · Lata al pedido" [ref=e211] [cursor=pointer]:
              - generic [ref=e212]: +
      - region "Combos" [ref=e213]:
        - generic [ref=e215]:
          - heading "Combos" [level=2] [ref=e216]
          - generic [ref=e217]: Armados por el local · hasta $ 2.752 de ahorro
        - generic [ref=e218]:
          - article [ref=e219]:
            - button "Ver el combo Previa Imperial" [ref=e220] [cursor=pointer]:
              - emphasis [ref=e223]: ×6
              - generic [ref=e224]: Ahorrás $ 2.200
            - generic [ref=e225]:
              - generic [ref=e226]:
                - strong [ref=e227]: Previa Imperial
                - generic [ref=e228]: Seis latas bien frías para arrancar
              - paragraph [ref=e229]: 6× Imperial Golden
              - generic [ref=e230]:
                - generic [ref=e231]: $ 18.000
                - strong [ref=e232]: $ 15.800
                - emphasis [ref=e233]: −12.2%
              - generic [ref=e234]:
                - generic [ref=e235]: "+18"
                - generic [ref=e236]: 6 unidades
                - generic [ref=e237]: Quedan 16
              - button "Ver qué trae" [ref=e238] [cursor=pointer]
          - article [ref=e239]:
            - button "Ver el combo Heineken x6" [ref=e240] [cursor=pointer]:
              - emphasis [ref=e243]: ×6
              - generic [ref=e244]: Ahorrás $ 2.400
            - generic [ref=e245]:
              - generic [ref=e246]:
                - strong [ref=e247]: Heineken x6
                - generic [ref=e248]: La verde, por media docena
              - paragraph [ref=e249]: 6× Heineken
              - generic [ref=e250]:
                - generic [ref=e251]: $ 23.400
                - strong [ref=e252]: $ 21.000
                - emphasis [ref=e253]: −10.3%
              - generic [ref=e254]:
                - generic [ref=e255]: "+18"
                - generic [ref=e256]: 6 unidades
                - generic [ref=e257]: Quedan 16
              - button "Ver qué trae" [ref=e258] [cursor=pointer]
          - article [ref=e259]:
            - button "Ver el combo Corona Extra x6" [ref=e260] [cursor=pointer]:
              - emphasis [ref=e263]: ×6
              - generic [ref=e264]: Ahorrás $ 2.200
            - generic [ref=e265]:
              - generic [ref=e266]:
                - strong [ref=e267]: Corona Extra x6
                - generic [ref=e268]: Seis porrones de 330 ml
              - paragraph [ref=e269]: 6× Corona Extra
              - generic [ref=e270]:
                - generic [ref=e271]: $ 21.600
                - strong [ref=e272]: $ 19.400
                - emphasis [ref=e273]: −10.2%
              - generic [ref=e274]:
                - generic [ref=e275]: "+18"
                - generic [ref=e276]: 6 unidades
                - generic [ref=e277]: Quedan 16
              - button "Ver qué trae" [ref=e278] [cursor=pointer]
          - article [ref=e279]:
            - button "Ver el combo Birra y energía" [ref=e280] [cursor=pointer]:
              - generic [ref=e281]:
                - emphasis [ref=e283]: ×4
                - emphasis [ref=e285]: ×2
              - generic [ref=e286]: Ahorrás $ 2.150
            - generic [ref=e287]:
              - generic [ref=e288]:
                - strong [ref=e289]: Birra y energía
                - generic [ref=e290]: Cuatro latas y dos para aguantar
              - paragraph [ref=e291]: 4× Imperial Golden · 2× Speed Unlimited Original
              - generic [ref=e292]:
                - generic [ref=e293]: $ 17.850
                - strong [ref=e294]: $ 15.700
                - emphasis [ref=e295]: −12%
              - generic [ref=e296]:
                - generic [ref=e297]: "+18"
                - generic [ref=e298]: 6 unidades
                - generic [ref=e299]: Quedan 24
              - button "Ver qué trae" [ref=e300] [cursor=pointer]
          - article [ref=e301]:
            - button "Ver el combo Tabla de cervezas" [ref=e302] [cursor=pointer]:
              - generic [ref=e308]: "+2"
              - generic [ref=e309]: Ahorrás $ 2.000
            - generic [ref=e310]:
              - generic [ref=e311]:
                - strong [ref=e312]: Tabla de cervezas
                - generic [ref=e313]: Una de cada una, seis en total
              - paragraph [ref=e314]: 1× Imperial Golden · 1× Imperial Extra Lager · 1× Imperial APA · 1× Imperial Cream Stout · 1× Schneider Rubia · 1× Corona Extra
              - generic [ref=e315]:
                - generic [ref=e316]: $ 19.100
                - strong [ref=e317]: $ 17.100
                - emphasis [ref=e318]: −10.5%
              - generic [ref=e319]:
                - generic [ref=e320]: "+18"
                - generic [ref=e321]: 6 unidades
                - generic [ref=e322]: Quedan 99
              - button "Ver qué trae" [ref=e323] [cursor=pointer]
          - article [ref=e324]:
            - button "Ver el combo Noche larga" [ref=e325] [cursor=pointer]:
              - generic [ref=e326]:
                - emphasis [ref=e328]: ×4
                - emphasis [ref=e330]: ×2
              - generic [ref=e331]: Ahorrás $ 2.752
            - generic [ref=e332]:
              - generic [ref=e333]:
                - strong [ref=e334]: Noche larga
                - generic [ref=e335]: Cuatro Heineken y dos Red Bull
              - paragraph [ref=e336]: 4× Heineken · 2× Red Bull Energy Drink
              - generic [ref=e337]:
                - generic [ref=e338]: $ 22.752
                - strong [ref=e339]: $ 20.000
                - emphasis [ref=e340]: −12.1%
              - generic [ref=e341]:
                - generic [ref=e342]: "+18"
                - generic [ref=e343]: 6 unidades
                - generic [ref=e344]: Quedan 24
              - button "Ver qué trae" [ref=e345] [cursor=pointer]
          - article [ref=e346]:
            - button "Ver el combo Cuatro para arrancar" [ref=e347] [cursor=pointer]:
              - emphasis [ref=e350]: ×4
              - generic [ref=e351]: Ahorrás $ 1.200
            - generic [ref=e352]:
              - generic [ref=e353]:
                - strong [ref=e354]: Cuatro para arrancar
                - generic [ref=e355]: Speed por cuatro
              - paragraph [ref=e356]: 4× Speed Unlimited Original
              - generic [ref=e357]:
                - generic [ref=e358]: $ 11.700
                - strong [ref=e359]: $ 10.500
                - emphasis [ref=e360]: −10.3%
              - generic [ref=e361]:
                - generic [ref=e362]: 4 unidades
                - generic [ref=e363]: Quedan 24
              - button "Ver qué trae" [ref=e364] [cursor=pointer]
      - generic [ref=e365]:
        - region "Cervezas" [ref=e366]:
          - generic [ref=e367]:
            - heading "Cervezas" [level=2] [ref=e369]
            - button "Ver todos" [ref=e370] [cursor=pointer]
          - generic [ref=e371]:
            - article [ref=e372]:
              - button "Guardar Heineken 473 ml · Lata de favoritos" [ref=e373] [cursor=pointer]:
                - img [ref=e374]
              - button "Ver Heineken. Venta exclusiva a mayores de 18 años" [ref=e376] [cursor=pointer]:
                - img "Heineken" [ref=e377]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e378]:
                - strong [ref=e379]: Heineken
                - generic [ref=e380]: 473 ml · Lata
                - generic [ref=e381]: $ 3.900
              - button "Agregar Heineken 473 ml · Lata al pedido" [ref=e383] [cursor=pointer]:
                - generic [ref=e384]: +
            - article [ref=e385]:
              - button "Guardar Corona Extra 330 ml de favoritos" [ref=e386] [cursor=pointer]:
                - img [ref=e387]
              - button "Ver Corona Extra. Venta exclusiva a mayores de 18 años" [ref=e389] [cursor=pointer]:
                - img "Corona Extra" [ref=e390]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e391]:
                - strong [ref=e392]: Corona Extra
                - generic [ref=e393]: 330 ml
                - generic [ref=e394]: $ 3.600
              - button "Agregar Corona Extra 330 ml al pedido" [ref=e396] [cursor=pointer]:
                - generic [ref=e397]: +
            - article [ref=e398]:
              - button "Guardar Imperial APA 473 ml · Lata de favoritos" [ref=e399] [cursor=pointer]:
                - img [ref=e400]
              - button "Ver Imperial APA. Venta exclusiva a mayores de 18 años" [ref=e402] [cursor=pointer]:
                - img "Imperial APA" [ref=e403]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e404]:
                - strong [ref=e405]: Imperial APA
                - generic [ref=e406]: 473 ml · Lata
                - generic [ref=e407]: $ 3.000
              - button "Agregar Imperial APA 473 ml · Lata al pedido" [ref=e409] [cursor=pointer]:
                - generic [ref=e410]: +
            - article [ref=e411]:
              - button "Guardar Imperial Cream Stout 473 ml · Lata de favoritos" [ref=e412] [cursor=pointer]:
                - img [ref=e413]
              - button "Ver Imperial Cream Stout. Venta exclusiva a mayores de 18 años" [ref=e415] [cursor=pointer]:
                - img "Imperial Cream Stout" [ref=e416]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e417]:
                - strong [ref=e418]: Imperial Cream Stout
                - generic [ref=e419]: 473 ml · Lata
                - generic [ref=e420]: $ 3.000
              - button "Agregar Imperial Cream Stout 473 ml · Lata al pedido" [ref=e422] [cursor=pointer]:
                - generic [ref=e423]: +
            - article [ref=e424]:
              - button "Guardar Imperial Extra Lager 473 ml · Lata de favoritos" [ref=e425] [cursor=pointer]:
                - img [ref=e426]
              - button "Ver Imperial Extra Lager. Venta exclusiva a mayores de 18 años" [ref=e428] [cursor=pointer]:
                - img "Imperial Extra Lager" [ref=e429]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e430]:
                - strong [ref=e431]: Imperial Extra Lager
                - generic [ref=e432]: 473 ml · Lata
                - generic [ref=e433]: $ 3.000
              - button "Agregar Imperial Extra Lager 473 ml · Lata al pedido" [ref=e435] [cursor=pointer]:
                - generic [ref=e436]: +
            - article [ref=e437]:
              - button "Guardar Imperial Golden 473 ml · Lata de favoritos" [ref=e438] [cursor=pointer]:
                - img [ref=e439]
              - button "Ver Imperial Golden. Venta exclusiva a mayores de 18 años" [ref=e441] [cursor=pointer]:
                - img "Imperial Golden" [ref=e442]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e443]:
                - strong [ref=e444]: Imperial Golden
                - generic [ref=e445]: 473 ml · Lata
                - generic [ref=e446]: $ 3.000
              - button "Agregar Imperial Golden 473 ml · Lata al pedido" [ref=e448] [cursor=pointer]:
                - generic [ref=e449]: +
            - article [ref=e450]:
              - button "Guardar Schneider Rubia 710 ml · Lata de favoritos" [ref=e451] [cursor=pointer]:
                - img [ref=e452]
              - button "Ver Schneider Rubia. Venta exclusiva a mayores de 18 años" [ref=e454] [cursor=pointer]:
                - img "Schneider Rubia" [ref=e455]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e456]:
                - strong [ref=e457]: Schneider Rubia
                - generic [ref=e458]: 710 ml · Lata
                - generic [ref=e459]: $ 3.500
              - button "Agregar Schneider Rubia 710 ml · Lata al pedido" [ref=e461] [cursor=pointer]:
                - generic [ref=e462]: +
        - region "Energizantes" [ref=e463]:
          - generic [ref=e464]:
            - heading "Energizantes" [level=2] [ref=e466]
            - button "Ver todos" [ref=e467] [cursor=pointer]
          - generic [ref=e468]:
            - article [ref=e469]:
              - button "Guardar Red Bull Energy Drink 250 ml · Lata de favoritos" [ref=e470] [cursor=pointer]:
                - img [ref=e471]
              - button "Ver Red Bull Energy Drink" [ref=e473] [cursor=pointer]:
                - img "Red Bull Energy Drink" [ref=e474]
              - generic [ref=e475]:
                - strong [ref=e476]: Red Bull Energy Drink
                - generic [ref=e477]: 250 ml · Lata
                - generic [ref=e478]: $ 3.576
              - button "Agregar Red Bull Energy Drink 250 ml · Lata al pedido" [ref=e480] [cursor=pointer]:
                - generic [ref=e481]: +
            - article [ref=e482]:
              - button "Guardar Monster Mango Loco 473 ml · Lata de favoritos" [ref=e483] [cursor=pointer]:
                - img [ref=e484]
              - button "Ver Monster Mango Loco" [ref=e486] [cursor=pointer]:
                - img "Monster Mango Loco" [ref=e487]
              - generic [ref=e488]:
                - strong [ref=e489]: Monster Mango Loco
                - generic [ref=e490]: 473 ml · Lata
                - generic [ref=e491]: $ 3.390
              - button "Agregar Monster Mango Loco 473 ml · Lata al pedido" [ref=e493] [cursor=pointer]:
                - generic [ref=e494]: +
            - article [ref=e495]:
              - button "Guardar Speed Unlimited 473 ml · Lata de favoritos" [ref=e496] [cursor=pointer]:
                - img [ref=e497]
              - button "Ver Speed Unlimited Original" [ref=e499] [cursor=pointer]:
                - img "Speed Unlimited Original" [ref=e500]
              - generic [ref=e501]:
                - strong [ref=e502]: Speed Unlimited
                - generic [ref=e503]: 473 ml · Lata
                - generic [ref=e504]: $ 2.925
              - button "Agregar Speed Unlimited 473 ml · Lata al pedido" [ref=e506] [cursor=pointer]:
                - generic [ref=e507]: +
            - article [ref=e508]:
              - button "Guardar Speed Unlimited Zero Sugar 473 ml · Lata de favoritos" [ref=e509] [cursor=pointer]:
                - img [ref=e510]
              - button "Ver Speed Unlimited Zero Sugar" [ref=e512] [cursor=pointer]:
                - img "Speed Unlimited Zero Sugar" [ref=e513]
              - generic [ref=e514]:
                - strong [ref=e515]: Speed Unlimited Zero Sugar
                - generic [ref=e516]: 473 ml · Lata
                - generic [ref=e517]: $ 2.925
              - button "Agregar Speed Unlimited Zero Sugar 473 ml · Lata al pedido" [ref=e519] [cursor=pointer]:
                - generic [ref=e520]: +
        - button "Heineken bien fría. Ver Heineken en el catálogo" [ref=e522] [cursor=pointer]:
          - generic [ref=e523]: La marca
          - strong [ref=e524]: Heineken bien fría
          - generic [ref=e525]:
            - text: Ver Heineken
            - generic [ref=e526]: →
      - region "Selección del local" [ref=e527]:
        - generic [ref=e528]:
          - generic [ref=e529]:
            - heading "Selección del local" [level=2] [ref=e530]
            - generic [ref=e531]: Bodega y destilados
          - button "Ver todos" [ref=e532] [cursor=pointer]
        - generic [ref=e533]:
          - article [ref=e534]:
            - button "Guardar Rutini Malbec 750 ml de favoritos" [ref=e535] [cursor=pointer]:
              - img [ref=e536]
            - button "Ver Rutini Malbec. Venta exclusiva a mayores de 18 años" [ref=e538] [cursor=pointer]:
              - img "Rutini Malbec" [ref=e539]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e540]:
              - strong [ref=e541]: Rutini Malbec
              - generic [ref=e542]: 750 ml
              - generic [ref=e543]: Precio próximamente
            - button "Ver la ficha de Rutini Malbec. Este producto todavía no está disponible para compra." [ref=e545] [cursor=pointer]:
              - generic [ref=e546]: Ver detalle
          - article [ref=e547]:
            - button "Guardar Buhero Negro 450 ml de favoritos" [ref=e548] [cursor=pointer]:
              - img [ref=e549]
            - button "Ver Buhero Negro. Venta exclusiva a mayores de 18 años" [ref=e551] [cursor=pointer]:
              - img "Buhero Negro" [ref=e552]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e553]:
              - strong [ref=e554]: Buhero Negro
              - generic [ref=e555]: 450 ml
              - generic [ref=e556]: Precio próximamente
            - button "Ver la ficha de Buhero Negro. Este producto todavía no está disponible para compra." [ref=e558] [cursor=pointer]:
              - generic [ref=e559]: Ver detalle
          - article [ref=e560]:
            - button "Guardar Cinzano Rosso 950 ml de favoritos" [ref=e561] [cursor=pointer]:
              - img [ref=e562]
            - button "Ver Cinzano Rosso. Venta exclusiva a mayores de 18 años" [ref=e564] [cursor=pointer]:
              - img "Cinzano Rosso" [ref=e565]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e566]:
              - strong [ref=e567]: Cinzano Rosso
              - generic [ref=e568]: 950 ml
              - generic [ref=e569]: Precio próximamente
            - button "Ver la ficha de Cinzano Rosso. Este producto todavía no está disponible para compra." [ref=e571] [cursor=pointer]:
              - generic [ref=e572]: Ver detalle
          - article [ref=e573]:
            - button "Guardar Chandon Délice 750 ml de favoritos" [ref=e574] [cursor=pointer]:
              - img [ref=e575]
            - button "Ver Chandon Délice. Venta exclusiva a mayores de 18 años" [ref=e577] [cursor=pointer]:
              - img "Chandon Délice" [ref=e578]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e579]:
              - strong [ref=e580]: Chandon Délice
              - generic [ref=e581]: 750 ml
              - generic [ref=e582]: Precio próximamente
            - button "Ver la ficha de Chandon Délice. Este producto todavía no está disponible para compra." [ref=e584] [cursor=pointer]:
              - generic [ref=e585]: Ver detalle
      - button "Ver catálogo completo" [ref=e586] [cursor=pointer]:
        - generic [ref=e587]: Ver catálogo completo
        - generic [ref=e588]: ›
  - navigation "Navegación móvil" [ref=e589]:
    - button "Inicio" [ref=e590] [cursor=pointer]:
      - generic [ref=e591]: ⌂
      - generic [ref=e592]: Inicio
    - button "Catálogo" [ref=e593] [cursor=pointer]:
      - generic [ref=e595]: Catálogo
    - button "Mis pedidos" [ref=e596] [cursor=pointer]:
      - generic [ref=e598]: Mis pedidos
    - button "Perfil" [ref=e599] [cursor=pointer]:
      - generic [ref=e601]: Perfil
```

# Test source

```ts
  78  |       const v = value / 255;
  79  |       return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  80  |     };
  81  |     return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  82  |   };
  83  |   const foreground = parse(getComputedStyle(node).color);
  84  |   let background = null;
  85  |   for (let cursor = node; cursor; cursor = cursor.parentElement) {
  86  |     const candidate = parse(getComputedStyle(cursor).backgroundColor);
  87  |     if (candidate && candidate.a >= 0.92) { background = candidate; break; }
  88  |   }
  89  |   if (!foreground || !background) return null;
  90  |   const light = Math.max(luminance(foreground), luminance(background));
  91  |   const dark = Math.min(luminance(foreground), luminance(background));
  92  |   return {
  93  |     ratio: Number(((light + 0.05) / (dark + 0.05)).toFixed(2)),
  94  |     fontSize: parseFloat(getComputedStyle(node).fontSize),
  95  |     fontWeight: Number(getComputedStyle(node).fontWeight) || 400,
  96  |   };
  97  | }`;
  98  | 
  99  | async function contrast(page, selector) {
  100 |   return page.evaluate(new Function(`return ${CONTRAST_PROBE}`)(), selector);
  101 | }
  102 | 
  103 | // La entrada a historias existe en DOS lugares —el encabezado de la home y el
  104 | // de Perfil— y comparte marcado, así que cada aserción tiene que decir de cuál
  105 | // habla. Estos helpers evitan que un selector suelto vuelva a apuntar a las dos.
  106 | const HERO = '.brand-hero';
  107 | const PERFIL_HEAD = '.profile-page-head';
  108 | const entradaHome = (page) => page.locator(`${HERO} [data-stories-slot]`);
  109 | const logoHome = (page) => page.locator(`${HERO} .brand-logo-action`);
  110 | const logoEstaticoHome = (page) => page.locator(`${HERO} [data-stories-static]`);
  111 | 
  112 | async function openHome(page, { stories = null, viewport = PHONE } = {}) {
  113 |   await page.setViewportSize(viewport);
  114 |   await installBrowserStubs(page);
  115 |   // `null` = sin origen declarado: manda lo que traiga el modo (la demo siembra
  116 |   // sus fixtures). Un array —incluido `[]`— declara el origen real y gana
  117 |   // siempre, que es el contrato que consumirá el backend.
  118 |   if (Array.isArray(stories)) {
  119 |     await page.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, stories);
  120 |   }
  121 |   await gotoDemoReset(page, '/?reset=1&demo=1');
  122 |   await page.waitForSelector('[data-view="home"] .home-best-card');
  123 | }
  124 | 
  125 | test('el encabezado presenta la identidad real del comercio, no una escrita a mano', async ({ page }) => {
  126 |   const guards = installPageGuards(page);
  127 |   await openHome(page);
  128 | 
  129 |   // El "¡Bienvenido a" se retiró: era decoración de tres renglones encima del
  130 |   // primer producto. Lo que se fija sigue siendo lo mismo que fijaba antes —que
  131 |   // la identidad SALE de `businessConfig` y no está escrita a mano—, ahora
  132 |   // sobre el encabezado compacto.
  133 |   await expect(page.getByRole('heading', { name: 'La Taba', level: 1 })).toBeVisible();
  134 |   // Rubro y dirección salen de `businessConfig`: la vista sólo los concatena.
  135 |   // Este renglón dice QUÉ HACE el comercio y DÓNDE. Decía el rubro («Tienda de
  136 |   // bebidas»), que ya está en la barra superior, mientras la palabra «delivery»
  137 |   // no aparecía en 2.143 px de home: un cliente que llegaba por un enlace no
  138 |   // tenía cómo saber si le llevan la bebida. Sale de `businessConfig`, igual
  139 |   // que antes, y sin nada que decir del servicio vuelve el rubro.
  140 |   await expect(page.locator('[data-home-business-place]')).toHaveText('Delivery y retiro · Mendoza 827, Neuquén');
  141 |   await expect(page.locator('[data-open-status]')).toBeVisible();
  142 |   await expect(page.locator('[data-open-status]')).toHaveText('Pedidos disponibles');
  143 |   // Sin horario publicado no se inventa ninguno.
  144 |   await expect(page.locator('[data-home-business-hours]')).toBeHidden();
  145 |   await guards.assertClean();
  146 | });
  147 | 
  148 | // El origen productivo es el global que publica el backend. La demo siembra
  149 | // fixtures propias (`preview-stories-data.js`), así que para ejercitar el
  150 | // fail-closed hay que declarar explícitamente que el origen real está vacío:
  151 | // es exactamente lo que ocurre en producción antes del primer publicado.
  152 | test('sin historias publicadas el logo no se anuncia como botón', async ({ page }) => {
  153 |   await openHome(page, { stories: [] });
  154 | 
  155 |   // El fail-closed rige en TODAS las entradas, no sólo en la de la home.
  156 |   await expect(page.locator('[data-stories-slot]')).toHaveCount(2);
  157 |   for (const estado of await page.locator('[data-stories-slot]').evaluateAll(
  158 |     (nodos) => nodos.map((n) => n.dataset.storiesState),
  159 |   )) {
  160 |     expect(estado).toBe('empty');
  161 |   }
  162 |   await expect(logoHome(page)).toBeHidden();
  163 |   await expect(page.locator(`${PERFIL_HEAD} .brand-logo-action`)).toBeHidden();
  164 |   // La fila de círculos es la entrada nueva: sin historias queda vacía y no
  165 |   // sobrevive ni un círculo prometiendo contenido.
  166 |   await expect(page.locator('.brand-story-circle')).toHaveCount(0);
  167 |   /*
  168 |    * Y la fila ENTERA desaparece, emblema incluido. Antes el emblema se quedaba
  169 |    * solo, como identidad del comercio: 88 px de la primera pantalla para
  170 |    * repetir la marca por TERCERA vez —ya está en la barra superior y en el h1—
  171 |    * justo encima del primer producto. Medido el 2026-08-25, 383 de los 844 px
  172 |    * del pliegue eran cromo antes de la primera bebida.
  173 |    */
  174 |   await expect(page.locator(`${HERO} .brand-stories-strip`)).toBeHidden();
  175 |   await expect(logoEstaticoHome(page)).toBeHidden();
  176 |   // El aro no se pinta: nada promete contenido inexistente.
  177 |   const ringPainted = await page.locator(`${HERO} [data-stories-static] .brand-logo-ring`)
> 178 |     .evaluate((node) => getComputedStyle(node).backgroundImage !== 'none');
      |      ^ Error: locator.evaluate: Test timeout of 45000ms exceeded.
  179 |   expect(ringPainted).toBe(false);
  180 | });
  181 | 
  182 | // El emblema de marca es el elemento de identidad de la home. Lo que se fija no
  183 | // es su dibujo sino que se PINTE: el aro de historias es `position: absolute` y
  184 | // basta que la cara pierda su `z-index` para que le tape "LA TABA".
  185 | test('el emblema de marca se ve entero, con y sin el aro de historias encendido', async ({ page }) => {
  186 |   await openHome(page, { stories: STORY_FIXTURES });
  187 | 
  188 |   const logo = logoHome(page);
  189 |   await expect(logo.locator('img')).toHaveAttribute('src', /taba2-emblem\.svg$/);
  190 | 
  191 |   const capas = await logo.evaluate((nodo) => {
  192 |     const cara = nodo.querySelector('.brand-logo-face');
  193 |     const aro = nodo.querySelector('.brand-logo-ring');
  194 |     const caja = cara.getBoundingClientRect();
  195 |     const imagen = cara.querySelector('img').getBoundingClientRect();
  196 |     // Punto justo dentro del borde superior del emblema, donde vive "LA TABA".
  197 |     const x = Math.round(caja.left + caja.width / 2);
  198 |     const y = Math.round(caja.top + 6);
  199 |     return {
  200 |       encima: document.elementFromPoint(x, y)?.className || '',
  201 |       caraZ: getComputedStyle(cara).zIndex,
  202 |       caraPos: getComputedStyle(cara).position,
  203 |       aroPos: getComputedStyle(aro).position,
  204 |       emblemaLleno: Math.round(imagen.width) === Math.round(caja.width),
  205 |       caraDentroDelSlot: Math.round(caja.width) < Math.round(nodo.getBoundingClientRect().width),
  206 |     };
  207 |   });
  208 | 
  209 |   // Quien recibe el toque sobre el emblema no puede ser el aro.
  210 |   expect(capas.encima, 'algo tapa el emblema').not.toContain('brand-logo-ring');
  211 |   expect(capas.aroPos).toBe('absolute');
  212 |   expect(capas.caraPos).toBe('relative');
  213 |   expect(capas.caraZ).not.toBe('auto');
  214 |   expect(capas.emblemaLleno, 'el emblema no llena su caja').toBe(true);
  215 |   // El aro corre por fuera: si la cara midiera lo mismo que el slot, no habría
  216 |   // lugar donde pintarlo.
  217 |   expect(capas.caraDentroDelSlot).toBe(true);
  218 | 
  219 |   /*
  220 |    * Sin historias la fila ENTERA se va, emblema incluido. Antes el emblema se
  221 |    * quedaba solo sobre el shell oscuro; medido el 2026-08-25, esos 88 px eran
  222 |    * la tercera repetición de la marca —ya está en la barra superior y en el
  223 |    * h1— justo encima del primer producto, en una primera pantalla donde 383 de
  224 |    * 844 px eran cromo antes de la primera bebida.
  225 |    *
  226 |    * Lo que sigue valiendo, y es lo que se fija acá: el emblema se dibuja entero
  227 |    * CUANDO se dibuja, con su cara dentro del slot y su sombra propia. Eso se
  228 |    * verifica arriba, con historias publicadas.
  229 |    */
  230 |   const limpio = await page.context().browser().newContext({ viewport: PHONE });
  231 |   const sinHistorias = await limpio.newPage();
  232 |   await installBrowserStubs(sinHistorias);
  233 |   await sinHistorias.addInitScript(() => { window.TABA2_STORIES = []; });
  234 |   await gotoDemoReset(sinHistorias, '/?reset=1&demo=1');
  235 |   // La fila entera queda oculta, así que el slot se espera ATTACHED y no
  236 |   // visible: pedir 'visible' esperaría para siempre justo lo que este cambio
  237 |   // vino a sacar de la primera pantalla.
  238 |   await sinHistorias.waitForSelector('[data-stories-slot][data-stories-state="empty"]', { state: 'attached' });
  239 |   await expect(sinHistorias.locator(`${HERO} .brand-stories-strip`)).toBeHidden();
  240 |   await limpio.close();
  241 | });
  242 | 
  243 | test('la caja del logo no se mueve entre estados: sin historias y con historias mide igual', async ({ page }) => {
  244 |   await openHome(page);
  245 |   const empty = await entradaHome(page).boundingBox();
  246 | 
  247 |   const context = await page.context().browser().newContext({ viewport: PHONE });
  248 |   const withStories = await context.newPage();
  249 |   await installBrowserStubs(withStories);
  250 |   await withStories.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, STORY_FIXTURES);
  251 |   await gotoDemoReset(withStories, '/?reset=1&demo=1');
  252 |   await withStories.waitForSelector(`${HERO} .brand-logo-action:not([hidden])`);
  253 |   const filled = await entradaHome(withStories).boundingBox();
  254 | 
  255 |   expect(Math.round(filled.width)).toBe(Math.round(empty.width));
  256 |   expect(Math.round(filled.height)).toBe(Math.round(empty.height));
  257 |   await context.close();
  258 | });
  259 | 
  260 | test('con historias vigentes el logo es botón, el aro se enciende y el acceso dice cuántas hay', async ({ page }) => {
  261 |   await openHome(page, { stories: STORY_FIXTURES });
  262 | 
  263 |   await expect(entradaHome(page)).toHaveAttribute('data-stories-state', 'unseen');
  264 |   const logo = logoHome(page);
  265 |   await expect(logo).toBeVisible();
  266 |   await expect(logo).toHaveAttribute('aria-label', /2 historias nuevas de La Taba/);
  267 |   // El estado no viaja sólo en el color del aro: hay un círculo por historia y
  268 |   // cada uno declara si ya se vio. Antes esto lo decía un rótulo suelto de una
  269 |   // tarjeta ancha que no mostraba ninguna historia.
  270 |   await expect(page.locator('.brand-story-circle')).toHaveCount(2);
  271 |   await expect(page.locator('.brand-story-circle[data-story-seen="false"]')).toHaveCount(2);
  272 | 
  273 |   await logo.click();
  274 |   const modal = page.locator('[data-stories-modal]');
  275 |   await expect(modal).toBeVisible();
  276 |   await expect(modal.getByRole('heading', { name: 'Combo de la semana' })).toBeVisible();
  277 |   await expect(modal.locator('[data-story-cta]')).toHaveText('Ver categoría');
  278 | 
```