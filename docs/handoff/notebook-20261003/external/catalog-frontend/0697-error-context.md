# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: taba2-brand-home.spec.mjs >> la superficie de contenido es la misma en toda la app del cliente
- Location: tests\e2e\taba2-brand-home.spec.mjs:435:1

# Error details

```
Error: tarjeta de la home

expect(received).toBe(expected) // Object.is equality

Expected: "rgb(29, 34, 42)"
Received: "rgb(248, 246, 241)"
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
      - generic [ref=e213]:
        - button "Ver las 2 historias nuevas de La Taba" [ref=e215] [cursor=pointer]
        - generic [ref=e218]:
          - button "Ver la historia Heineken bien fría. Cervezas de La Taba. Nueva" [ref=e219] [cursor=pointer]:
            - generic [ref=e222]: Cervezas
          - button "Ver la historia Monster para la noche. Energizantes de La Taba. Nueva" [ref=e223] [cursor=pointer]:
            - generic [ref=e226]: Energizantes
      - region "Combos" [ref=e227]:
        - generic [ref=e229]:
          - heading "Combos" [level=2] [ref=e230]
          - generic [ref=e231]: Armados por el local · hasta $ 2.752 de ahorro
        - generic [ref=e232]:
          - article [ref=e233]:
            - button "Ver el combo Previa Imperial" [ref=e234] [cursor=pointer]:
              - emphasis [ref=e237]: ×6
              - generic [ref=e238]: Ahorrás $ 2.200
            - generic [ref=e239]:
              - generic [ref=e240]:
                - strong [ref=e241]: Previa Imperial
                - generic [ref=e242]: Seis latas bien frías para arrancar
              - paragraph [ref=e243]: 6× Imperial Golden
              - generic [ref=e244]:
                - generic [ref=e245]: $ 18.000
                - strong [ref=e246]: $ 15.800
                - emphasis [ref=e247]: −12.2%
              - generic [ref=e248]:
                - generic [ref=e249]: "+18"
                - generic [ref=e250]: 6 unidades
                - generic [ref=e251]: Quedan 16
              - button "Ver qué trae" [ref=e252] [cursor=pointer]
          - article [ref=e253]:
            - button "Ver el combo Heineken x6" [ref=e254] [cursor=pointer]:
              - emphasis [ref=e257]: ×6
              - generic [ref=e258]: Ahorrás $ 2.400
            - generic [ref=e259]:
              - generic [ref=e260]:
                - strong [ref=e261]: Heineken x6
                - generic [ref=e262]: La verde, por media docena
              - paragraph [ref=e263]: 6× Heineken
              - generic [ref=e264]:
                - generic [ref=e265]: $ 23.400
                - strong [ref=e266]: $ 21.000
                - emphasis [ref=e267]: −10.3%
              - generic [ref=e268]:
                - generic [ref=e269]: "+18"
                - generic [ref=e270]: 6 unidades
                - generic [ref=e271]: Quedan 16
              - button "Ver qué trae" [ref=e272] [cursor=pointer]
          - article [ref=e273]:
            - button "Ver el combo Corona Extra x6" [ref=e274] [cursor=pointer]:
              - emphasis [ref=e277]: ×6
              - generic [ref=e278]: Ahorrás $ 2.200
            - generic [ref=e279]:
              - generic [ref=e280]:
                - strong [ref=e281]: Corona Extra x6
                - generic [ref=e282]: Seis porrones de 330 ml
              - paragraph [ref=e283]: 6× Corona Extra
              - generic [ref=e284]:
                - generic [ref=e285]: $ 21.600
                - strong [ref=e286]: $ 19.400
                - emphasis [ref=e287]: −10.2%
              - generic [ref=e288]:
                - generic [ref=e289]: "+18"
                - generic [ref=e290]: 6 unidades
                - generic [ref=e291]: Quedan 16
              - button "Ver qué trae" [ref=e292] [cursor=pointer]
          - article [ref=e293]:
            - button "Ver el combo Birra y energía" [ref=e294] [cursor=pointer]:
              - generic [ref=e295]:
                - emphasis [ref=e297]: ×4
                - emphasis [ref=e299]: ×2
              - generic [ref=e300]: Ahorrás $ 2.150
            - generic [ref=e301]:
              - generic [ref=e302]:
                - strong [ref=e303]: Birra y energía
                - generic [ref=e304]: Cuatro latas y dos para aguantar
              - paragraph [ref=e305]: 4× Imperial Golden · 2× Speed Unlimited Original
              - generic [ref=e306]:
                - generic [ref=e307]: $ 17.850
                - strong [ref=e308]: $ 15.700
                - emphasis [ref=e309]: −12%
              - generic [ref=e310]:
                - generic [ref=e311]: "+18"
                - generic [ref=e312]: 6 unidades
                - generic [ref=e313]: Quedan 24
              - button "Ver qué trae" [ref=e314] [cursor=pointer]
          - article [ref=e315]:
            - button "Ver el combo Tabla de cervezas" [ref=e316] [cursor=pointer]:
              - generic [ref=e322]: "+2"
              - generic [ref=e323]: Ahorrás $ 2.000
            - generic [ref=e324]:
              - generic [ref=e325]:
                - strong [ref=e326]: Tabla de cervezas
                - generic [ref=e327]: Una de cada una, seis en total
              - paragraph [ref=e328]: 1× Imperial Golden · 1× Imperial Extra Lager · 1× Imperial APA · 1× Imperial Cream Stout · 1× Schneider Rubia · 1× Corona Extra
              - generic [ref=e329]:
                - generic [ref=e330]: $ 19.100
                - strong [ref=e331]: $ 17.100
                - emphasis [ref=e332]: −10.5%
              - generic [ref=e333]:
                - generic [ref=e334]: "+18"
                - generic [ref=e335]: 6 unidades
                - generic [ref=e336]: Quedan 99
              - button "Ver qué trae" [ref=e337] [cursor=pointer]
          - article [ref=e338]:
            - button "Ver el combo Noche larga" [ref=e339] [cursor=pointer]:
              - generic [ref=e340]:
                - emphasis [ref=e342]: ×4
                - emphasis [ref=e344]: ×2
              - generic [ref=e345]: Ahorrás $ 2.752
            - generic [ref=e346]:
              - generic [ref=e347]:
                - strong [ref=e348]: Noche larga
                - generic [ref=e349]: Cuatro Heineken y dos Red Bull
              - paragraph [ref=e350]: 4× Heineken · 2× Red Bull Energy Drink
              - generic [ref=e351]:
                - generic [ref=e352]: $ 22.752
                - strong [ref=e353]: $ 20.000
                - emphasis [ref=e354]: −12.1%
              - generic [ref=e355]:
                - generic [ref=e356]: "+18"
                - generic [ref=e357]: 6 unidades
                - generic [ref=e358]: Quedan 24
              - button "Ver qué trae" [ref=e359] [cursor=pointer]
          - article [ref=e360]:
            - button "Ver el combo Cuatro para arrancar" [ref=e361] [cursor=pointer]:
              - emphasis [ref=e364]: ×4
              - generic [ref=e365]: Ahorrás $ 1.200
            - generic [ref=e366]:
              - generic [ref=e367]:
                - strong [ref=e368]: Cuatro para arrancar
                - generic [ref=e369]: Speed por cuatro
              - paragraph [ref=e370]: 4× Speed Unlimited Original
              - generic [ref=e371]:
                - generic [ref=e372]: $ 11.700
                - strong [ref=e373]: $ 10.500
                - emphasis [ref=e374]: −10.3%
              - generic [ref=e375]:
                - generic [ref=e376]: 4 unidades
                - generic [ref=e377]: Quedan 24
              - button "Ver qué trae" [ref=e378] [cursor=pointer]
      - generic [ref=e379]:
        - region "Cervezas" [ref=e380]:
          - generic [ref=e381]:
            - heading "Cervezas" [level=2] [ref=e383]
            - button "Ver todos" [ref=e384] [cursor=pointer]
          - generic [ref=e385]:
            - article [ref=e386]:
              - button "Guardar Heineken 473 ml · Lata de favoritos" [ref=e387] [cursor=pointer]:
                - img [ref=e388]
              - button "Ver Heineken. Venta exclusiva a mayores de 18 años" [ref=e390] [cursor=pointer]:
                - img "Heineken" [ref=e391]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e392]:
                - strong [ref=e393]: Heineken
                - generic [ref=e394]: 473 ml · Lata
                - generic [ref=e395]: $ 3.900
              - button "Agregar Heineken 473 ml · Lata al pedido" [ref=e397] [cursor=pointer]:
                - generic [ref=e398]: +
            - article [ref=e399]:
              - button "Guardar Corona Extra 330 ml de favoritos" [ref=e400] [cursor=pointer]:
                - img [ref=e401]
              - button "Ver Corona Extra. Venta exclusiva a mayores de 18 años" [ref=e403] [cursor=pointer]:
                - img "Corona Extra" [ref=e404]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e405]:
                - strong [ref=e406]: Corona Extra
                - generic [ref=e407]: 330 ml
                - generic [ref=e408]: $ 3.600
              - button "Agregar Corona Extra 330 ml al pedido" [ref=e410] [cursor=pointer]:
                - generic [ref=e411]: +
            - article [ref=e412]:
              - button "Guardar Imperial APA 473 ml · Lata de favoritos" [ref=e413] [cursor=pointer]:
                - img [ref=e414]
              - button "Ver Imperial APA. Venta exclusiva a mayores de 18 años" [ref=e416] [cursor=pointer]:
                - img "Imperial APA" [ref=e417]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e418]:
                - strong [ref=e419]: Imperial APA
                - generic [ref=e420]: 473 ml · Lata
                - generic [ref=e421]: $ 3.000
              - button "Agregar Imperial APA 473 ml · Lata al pedido" [ref=e423] [cursor=pointer]:
                - generic [ref=e424]: +
            - article [ref=e425]:
              - button "Guardar Imperial Cream Stout 473 ml · Lata de favoritos" [ref=e426] [cursor=pointer]:
                - img [ref=e427]
              - button "Ver Imperial Cream Stout. Venta exclusiva a mayores de 18 años" [ref=e429] [cursor=pointer]:
                - img "Imperial Cream Stout" [ref=e430]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e431]:
                - strong [ref=e432]: Imperial Cream Stout
                - generic [ref=e433]: 473 ml · Lata
                - generic [ref=e434]: $ 3.000
              - button "Agregar Imperial Cream Stout 473 ml · Lata al pedido" [ref=e436] [cursor=pointer]:
                - generic [ref=e437]: +
            - article [ref=e438]:
              - button "Guardar Imperial Extra Lager 473 ml · Lata de favoritos" [ref=e439] [cursor=pointer]:
                - img [ref=e440]
              - button "Ver Imperial Extra Lager. Venta exclusiva a mayores de 18 años" [ref=e442] [cursor=pointer]:
                - img "Imperial Extra Lager" [ref=e443]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e444]:
                - strong [ref=e445]: Imperial Extra Lager
                - generic [ref=e446]: 473 ml · Lata
                - generic [ref=e447]: $ 3.000
              - button "Agregar Imperial Extra Lager 473 ml · Lata al pedido" [ref=e449] [cursor=pointer]:
                - generic [ref=e450]: +
            - article [ref=e451]:
              - button "Guardar Imperial Golden 473 ml · Lata de favoritos" [ref=e452] [cursor=pointer]:
                - img [ref=e453]
              - button "Ver Imperial Golden. Venta exclusiva a mayores de 18 años" [ref=e455] [cursor=pointer]:
                - img "Imperial Golden" [ref=e456]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e457]:
                - strong [ref=e458]: Imperial Golden
                - generic [ref=e459]: 473 ml · Lata
                - generic [ref=e460]: $ 3.000
              - button "Agregar Imperial Golden 473 ml · Lata al pedido" [ref=e462] [cursor=pointer]:
                - generic [ref=e463]: +
            - article [ref=e464]:
              - button "Guardar Schneider Rubia 710 ml · Lata de favoritos" [ref=e465] [cursor=pointer]:
                - img [ref=e466]
              - button "Ver Schneider Rubia. Venta exclusiva a mayores de 18 años" [ref=e468] [cursor=pointer]:
                - img "Schneider Rubia" [ref=e469]
                - generic:
                  - generic: "+18"
                  - generic: Venta exclusiva a mayores de 18 años
              - generic [ref=e470]:
                - strong [ref=e471]: Schneider Rubia
                - generic [ref=e472]: 710 ml · Lata
                - generic [ref=e473]: $ 3.500
              - button "Agregar Schneider Rubia 710 ml · Lata al pedido" [ref=e475] [cursor=pointer]:
                - generic [ref=e476]: +
        - region "Energizantes" [ref=e477]:
          - generic [ref=e478]:
            - heading "Energizantes" [level=2] [ref=e480]
            - button "Ver todos" [ref=e481] [cursor=pointer]
          - generic [ref=e482]:
            - article [ref=e483]:
              - button "Guardar Red Bull Energy Drink 250 ml · Lata de favoritos" [ref=e484] [cursor=pointer]:
                - img [ref=e485]
              - button "Ver Red Bull Energy Drink" [ref=e487] [cursor=pointer]:
                - img "Red Bull Energy Drink" [ref=e488]
              - generic [ref=e489]:
                - strong [ref=e490]: Red Bull Energy Drink
                - generic [ref=e491]: 250 ml · Lata
                - generic [ref=e492]: $ 3.576
              - button "Agregar Red Bull Energy Drink 250 ml · Lata al pedido" [ref=e494] [cursor=pointer]:
                - generic [ref=e495]: +
            - article [ref=e496]:
              - button "Guardar Monster Mango Loco 473 ml · Lata de favoritos" [ref=e497] [cursor=pointer]:
                - img [ref=e498]
              - button "Ver Monster Mango Loco" [ref=e500] [cursor=pointer]:
                - img "Monster Mango Loco" [ref=e501]
              - generic [ref=e502]:
                - strong [ref=e503]: Monster Mango Loco
                - generic [ref=e504]: 473 ml · Lata
                - generic [ref=e505]: $ 3.390
              - button "Agregar Monster Mango Loco 473 ml · Lata al pedido" [ref=e507] [cursor=pointer]:
                - generic [ref=e508]: +
            - article [ref=e509]:
              - button "Guardar Speed Unlimited 473 ml · Lata de favoritos" [ref=e510] [cursor=pointer]:
                - img [ref=e511]
              - button "Ver Speed Unlimited Original" [ref=e513] [cursor=pointer]:
                - img "Speed Unlimited Original" [ref=e514]
              - generic [ref=e515]:
                - strong [ref=e516]: Speed Unlimited
                - generic [ref=e517]: 473 ml · Lata
                - generic [ref=e518]: $ 2.925
              - button "Agregar Speed Unlimited 473 ml · Lata al pedido" [ref=e520] [cursor=pointer]:
                - generic [ref=e521]: +
            - article [ref=e522]:
              - button "Guardar Speed Unlimited Zero Sugar 473 ml · Lata de favoritos" [ref=e523] [cursor=pointer]:
                - img [ref=e524]
              - button "Ver Speed Unlimited Zero Sugar" [ref=e526] [cursor=pointer]:
                - img "Speed Unlimited Zero Sugar" [ref=e527]
              - generic [ref=e528]:
                - strong [ref=e529]: Speed Unlimited Zero Sugar
                - generic [ref=e530]: 473 ml · Lata
                - generic [ref=e531]: $ 2.925
              - button "Agregar Speed Unlimited Zero Sugar 473 ml · Lata al pedido" [ref=e533] [cursor=pointer]:
                - generic [ref=e534]: +
        - button "Heineken bien fría. Ver Heineken en el catálogo" [ref=e536] [cursor=pointer]:
          - generic [ref=e537]: La marca
          - strong [ref=e538]: Heineken bien fría
          - generic [ref=e539]:
            - text: Ver Heineken
            - generic [ref=e540]: →
      - region "Selección del local" [ref=e541]:
        - generic [ref=e542]:
          - generic [ref=e543]:
            - heading "Selección del local" [level=2] [ref=e544]
            - generic [ref=e545]: Bodega y destilados
          - button "Ver todos" [ref=e546] [cursor=pointer]
        - generic [ref=e547]:
          - article [ref=e548]:
            - button "Guardar Rutini Malbec 750 ml de favoritos" [ref=e549] [cursor=pointer]:
              - img [ref=e550]
            - button "Ver Rutini Malbec. Venta exclusiva a mayores de 18 años" [ref=e552] [cursor=pointer]:
              - img "Rutini Malbec" [ref=e553]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e554]:
              - strong [ref=e555]: Rutini Malbec
              - generic [ref=e556]: 750 ml
              - generic [ref=e557]: Precio próximamente
            - button "Ver la ficha de Rutini Malbec. Este producto todavía no está disponible para compra." [ref=e559] [cursor=pointer]:
              - generic [ref=e560]: Ver detalle
          - article [ref=e561]:
            - button "Guardar Buhero Negro 450 ml de favoritos" [ref=e562] [cursor=pointer]:
              - img [ref=e563]
            - button "Ver Buhero Negro. Venta exclusiva a mayores de 18 años" [ref=e565] [cursor=pointer]:
              - img "Buhero Negro" [ref=e566]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e567]:
              - strong [ref=e568]: Buhero Negro
              - generic [ref=e569]: 450 ml
              - generic [ref=e570]: Precio próximamente
            - button "Ver la ficha de Buhero Negro. Este producto todavía no está disponible para compra." [ref=e572] [cursor=pointer]:
              - generic [ref=e573]: Ver detalle
          - article [ref=e574]:
            - button "Guardar Cinzano Rosso 950 ml de favoritos" [ref=e575] [cursor=pointer]:
              - img [ref=e576]
            - button "Ver Cinzano Rosso. Venta exclusiva a mayores de 18 años" [ref=e578] [cursor=pointer]:
              - img "Cinzano Rosso" [ref=e579]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e580]:
              - strong [ref=e581]: Cinzano Rosso
              - generic [ref=e582]: 950 ml
              - generic [ref=e583]: Precio próximamente
            - button "Ver la ficha de Cinzano Rosso. Este producto todavía no está disponible para compra." [ref=e585] [cursor=pointer]:
              - generic [ref=e586]: Ver detalle
          - article [ref=e587]:
            - button "Guardar Chandon Délice 750 ml de favoritos" [ref=e588] [cursor=pointer]:
              - img [ref=e589]
            - button "Ver Chandon Délice. Venta exclusiva a mayores de 18 años" [ref=e591] [cursor=pointer]:
              - img "Chandon Délice" [ref=e592]
              - generic:
                - generic: "+18"
                - generic: Venta exclusiva a mayores de 18 años
            - generic [ref=e593]:
              - strong [ref=e594]: Chandon Délice
              - generic [ref=e595]: 750 ml
              - generic [ref=e596]: Precio próximamente
            - button "Ver la ficha de Chandon Délice. Este producto todavía no está disponible para compra." [ref=e598] [cursor=pointer]:
              - generic [ref=e599]: Ver detalle
      - button "Ver catálogo completo" [ref=e600] [cursor=pointer]:
        - generic [ref=e601]: Ver catálogo completo
        - generic [ref=e602]: ›
  - navigation "Navegación móvil" [ref=e603]:
    - button "Inicio" [ref=e604] [cursor=pointer]:
      - generic [ref=e605]: ⌂
      - generic [ref=e606]: Inicio
    - button "Catálogo" [ref=e607] [cursor=pointer]:
      - generic [ref=e609]: Catálogo
    - button "Mis pedidos" [ref=e610] [cursor=pointer]:
      - generic [ref=e612]: Mis pedidos
    - button "Perfil" [ref=e613] [cursor=pointer]:
      - generic [ref=e615]: Perfil
```

# Test source

```ts
  340 |   await openHome(page);
  341 |   const search = page.locator('[data-view="home"] .taba-home-search');
  342 |   const input = search.locator('input');
  343 | 
  344 |   const [box, home] = await Promise.all([search.boundingBox(), page.locator('[data-view="home"]').boundingBox()]);
  345 |   expect(box.width).toBeGreaterThan(home.width * 0.88);
  346 |   expect(box.height).toBeGreaterThanOrEqual(48);
  347 |   expect(await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  348 |   // Un solo texto para las tres cajas de búsqueda, y corto: a 320 px los tres
  349 |   // anteriores se cortaban dentro de su propia caja.
  350 |   await expect(input).toHaveAttribute('placeholder', 'Buscar productos o marcas');
  351 | 
  352 |   await input.fill('coca');
  353 |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  354 |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  355 | });
  356 | 
  357 | test('la fila de categorías sólo ofrece rubros que hoy se pueden comprar', async ({ page }) => {
  358 |   await openHome(page);
  359 |   const chips = page.locator('[data-home-category-strip] [data-category-id]');
  360 |   const ids = await chips.evaluateAll((nodes) => nodes.map((node) => node.dataset.categoryId));
  361 | 
  362 |   expect(ids[0]).toBe('all');
  363 |   // Desde la publicación minorista los rubros con comprables son cervezas y
  364 |   // energizantes: las botellas sueltas de gaseosas y mixers esperan precio.
  365 |   expect(ids).toContain('cervezas');
  366 |   expect(ids).toContain('energizantes');
  367 |   expect(ids).not.toContain('gaseosas');
  368 |   // Sin precio publicado un rubro no puede ser protagonista de la home.
  369 |   expect(ids).not.toContain('whisky');
  370 |   expect(ids).not.toContain('fernet');
  371 | 
  372 |   // Ninguna categoría de la fila lleva a un catálogo vacío.
  373 |   for (const id of ids.filter((candidate) => candidate !== 'all')) {
  374 |     await page.locator(`[data-home-category-strip] [data-category-id="${id}"]`).click();
  375 |     await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  376 |     await page.goBack();
  377 |     await expect(page.locator('[data-view="home"]')).toBeVisible();
  378 |   }
  379 | });
  380 | 
  381 | test('el banner editorial lleva a un destino con producto comprable y no afirma un descuento', async ({ page }) => {
  382 |   await openHome(page);
  383 |   const banner = page.locator('.home-brand-banner').first();
  384 |   await expect(banner).toBeVisible();
  385 |   await expect(banner).not.toContainText('%');
  386 |   await expect(banner).not.toContainText('$');
  387 | 
  388 |   // El destino puede ser de rubro (`data-category-id`) o de marca
  389 |   // (`data-brand-query`); lo que NO puede es prometer una compra que el
  390 |   // catálogo no respalda (P1-2): al tocarlo tiene que aparecer al menos un
  391 |   // producto con "Agregar" habilitado, no una góndola de precios pendientes.
  392 |   const destino = await banner.evaluate((node) => node.dataset.categoryId || node.dataset.brandQuery);
  393 |   expect(destino).toBeTruthy();
  394 |   await banner.click();
  395 |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  396 |   await expect(page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()).toBeVisible();
  397 | });
  398 | 
  399 | test('el shell de marca es continuo entre las vistas del cliente', async ({ page }) => {
  400 |   await openHome(page);
  401 |   const leer = () => page.evaluate(() => ({
  402 |     vista: document.body.dataset.activeView,
  403 |     body: getComputedStyle(document.body).backgroundColor,
  404 |     topbar: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
  405 |     nav: getComputedStyle(document.querySelector('.mobile-nav')).backgroundColor,
  406 |   }));
  407 | 
  408 |   const home = await leer();
  409 |   // Fondo de marca oscuro, producto sobre GONDOLA. El blanco puro se retiró: sobre
  410 |   // grafito recortaba la pantalla como un papel pegado y, sobre todo, era el
  411 |   // origen del salto "home premium → formulario blanco genérico", porque cada
  412 |   // hoja elegía su propio blanco. Ahora hay una sola superficie de contenido y
  413 |   // este test la fija en su valor resuelto, no en un token.
  414 |   expect(home.body).toBe(brandSurfaceRgb());
  415 |   expect(await page.locator('.home-best-card').first().evaluate((n) => getComputedStyle(n).backgroundColor))
  416 |     .toBe(GONDOLA);
  417 | 
  418 |   // Navegar NO puede producir un salto negro → blanco: el shell se conserva.
  419 |   for (const vista of ['catalog', 'cart', 'profile', 'tracking']) {
  420 |     await page.locator(`.mobile-nav [data-nav-view="${vista}"]`).click();
  421 |     await expect(page.locator(`[data-view="${vista}"]`)).toBeVisible();
  422 |     const actual = await leer();
  423 |     expect(actual.vista, `vista ${vista}`).toBe(vista);
  424 |     expect(actual.body, `fondo en ${vista}`).toBe(home.body);
  425 |     expect(actual.topbar, `barra en ${vista}`).toBe(home.topbar);
  426 |     expect(actual.nav, `navegación en ${vista}`).toBe(home.nav);
  427 |   }
  428 | });
  429 | 
  430 | // Lo que hacía sentir "otra aplicación" al tocar Carrito no era el fondo —el
  431 | // shell ya era continuo— sino la SUPERFICIE del contenido: la home mostraba una
  432 | // vidriera y el carrito un formulario blanco puro, con otra sombra y otro radio.
  433 | // Esto fija que la tarjeta de producto, la del carrito y la del perfil sean
  434 | // exactamente la misma superficie.
  435 | test('la superficie de contenido es la misma en toda la app del cliente', async ({ page }) => {
  436 |   await openHome(page);
  437 |   const superficie = async (selector) => page.locator(selector).first()
  438 |     .evaluate((node) => getComputedStyle(node).backgroundColor);
  439 | 
> 440 |   expect(await superficie('.home-best-card'), 'tarjeta de la home').toBe(GONDOLA);
      |                                                                     ^ Error: tarjeta de la home
  441 | 
  442 |   await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  443 |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  444 |   expect(await superficie('[data-product-grid] .product-card'), 'tarjeta del catálogo').toBe(GONDOLA);
  445 | 
  446 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  447 |   await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  448 |   await expect(page.locator('[data-view="cart"] .cart-card')).toBeVisible();
  449 |   expect(await superficie('[data-view="cart"] .cart-card'), 'tarjeta del carrito').toBe(GONDOLA);
  450 |   expect(await superficie('[data-view="cart"] .checkout-form'), 'formulario del checkout').toBe(GONDOLA);
  451 | 
  452 |   await page.locator('.mobile-nav [data-nav-view="profile"]').click();
  453 |   await expect(page.locator('[data-view="profile"] .profile-card').first()).toBeVisible();
  454 |   expect(await superficie('[data-view="profile"] .profile-card'), 'tarjeta del perfil').toBe(GONDOLA);
  455 | });
  456 | 
  457 | test('el panel operativo conserva su superficie clara', async ({ page }) => {
  458 |   await openHome(page);
  459 |   const home = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  460 |   await page.goto('/?demo=1#business');
  461 |   await expect(page.locator('[data-view="business"]')).toBeVisible();
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
```