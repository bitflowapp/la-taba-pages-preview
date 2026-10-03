# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: taba2-brand-home.spec.mjs >> la navegación inferior conserva rutas, contador y estado accesible
- Location: tests\e2e\taba2-brand-home.spec.mjs:668:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.mobile-nav').locator('button')
Expected: 5
Received: 4
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for locator('.mobile-nav').locator('button')
    14 × locator resolved to 4 elements
       - unexpected value "4"

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
  663 | 
  664 |   await bar.click();
  665 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  666 | });
  667 | 
  668 | test('la navegación inferior conserva rutas, contador y estado accesible', async ({ page }) => {
  669 |   await openHome(page);
  670 |   const nav = page.locator('.mobile-nav');
> 671 |   await expect(nav.locator('button')).toHaveCount(5);
      |                                       ^ Error: expect(locator).toHaveCount(expected) failed
  672 |   // Cinco destinos distintos: ninguno repetido, así `aria-current` apunta a uno.
  673 |   for (const vista of ['home', 'catalog', 'cart', 'tracking', 'profile']) {
  674 |     await expect(nav.locator(`[data-nav-view="${vista}"]`)).toHaveCount(1);
  675 |   }
  676 |   await expect(nav.locator('[data-nav-view="home"]')).toHaveAttribute('aria-current', 'page');
  677 |   await expect(nav.locator('[data-nav-view="catalog"]')).not.toHaveAttribute('aria-current', 'page');
  678 | 
  679 |   await nav.locator('[data-nav-view="catalog"]').click();
  680 |   await expect(nav.locator('[data-nav-view="catalog"]')).toHaveAttribute('aria-current', 'page');
  681 |   await page.goBack();
  682 |   await expect(page.locator('[data-view="home"]')).toBeVisible();
  683 |   await expect(nav.locator('[data-nav-view="home"]')).toHaveAttribute('aria-current', 'page');
  684 | });
  685 | 
  686 | test('con movimiento reducido el aro deja de animarse y el estado sigue siendo legible', async ({ page }) => {
  687 |   await page.emulateMedia({ reducedMotion: 'reduce' });
  688 |   await openHome(page, { stories: STORY_FIXTURES });
  689 | 
  690 |   const ring = page.locator(`${HERO} .brand-logo-action .brand-logo-ring`);
  691 |   const duration = await ring.evaluate((node) => getComputedStyle(node).animationDuration);
  692 |   expect(parseFloat(duration)).toBeLessThanOrEqual(0.01);
  693 |   // El aro sigue pintado y los círculos siguen declarando el estado.
  694 |   expect(await ring.evaluate((node) => getComputedStyle(node).backgroundImage)).not.toBe('none');
  695 |   await expect(page.locator('.brand-story-circle[data-story-seen="false"]')).toHaveCount(2);
  696 | });
  697 | 
  698 | test('la home no crece sin control en los anchos objetivo', async ({ page }) => {
  699 |   for (const viewport of [
  700 |     { width: 320, height: 568 },
  701 |     { width: 360, height: 800 },
  702 |     { width: 390, height: 844 },
  703 |     { width: 393, height: 852 },
  704 |     { width: 412, height: 915 },
  705 |     { width: 768, height: 1024 },
  706 |     { width: 1440, height: 1000 },
  707 |   ]) {
  708 |     await page.setViewportSize(viewport);
  709 |     await installBrowserStubs(page);
  710 |     await gotoDemoReset(page, '/?reset=1&demo=1');
  711 |     await page.waitForSelector('[data-view="home"] .home-best-card');
  712 |     const geometry = await page.evaluate(() => ({
  713 |       documentWidth: document.documentElement.scrollWidth,
  714 |       viewportWidth: window.innerWidth,
  715 |       homeHeight: Math.ceil(document.querySelector('[data-view="home"]').getBoundingClientRect().height),
  716 |       homeSections: document.querySelectorAll('[data-home-sections] .home-category-section').length,
  717 |       homeBanners: [...document.querySelectorAll('[data-view="home"] .home-brand-banner')]
  718 |         .filter((node) => getComputedStyle(node).display !== 'none').length,
  719 |     }));
  720 |     expect(geometry.documentWidth, `${viewport.width}px`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  721 |     // La home pasó de una grilla de vista previa de 4 tarjetas a carruseles por
  722 |     // sección de bebidas, así que es deliberadamente más alta. Lo que se
  723 |     // controla ya no es un alto arbitrario sino la CANTIDAD de secciones: el
  724 |     // tope real vive en HOME_MAX_SECTIONS y este techo lo respalda. Sin ese
  725 |     // tope las 11 secciones definidas darían ~4000px y esto volvería a fallar.
  726 |     expect(geometry.homeSections, `${viewport.width}px`).toBeLessThanOrEqual(6);
  727 |     // Cada tramo puede cerrar con un banner editorial, así que el techo sube con
  728 |     // la vidriera: 6 secciones + 6 banners en escritorio. Sigue siendo
  729 |     // un techo real —una sección de más lo rompe— y se acompaña del invariante
  730 |     // de abajo, que impide que los banners crezcan por su cuenta.
  731 |     expect(geometry.homeBanners, `${viewport.width}px`).toBeLessThanOrEqual(geometry.homeSections);
  732 |     // El techo subió de 3200 a 3700 con la composición cerrada: la home suma el
  733 |     // HERO promocional (270px) y el tramo de "Selección del local" (≈370px), que
  734 |     // son piezas del pedido comercial, no crecimiento accidental. Medido da
  735 |     // 3539–3559 en los seis anchos de teléfono y 3396–3512 en tablet/escritorio,
  736 |     // así que 3700 deja ~140px de holgura para variaciones de copy y NO alcanza
  737 |     // para un tramo más: una sección nueva (≈330px) o un banner extra (≈200px)
  738 |     // lo rompen, que es exactamente lo que este techo tiene que detectar.
  739 |     expect(geometry.homeHeight, `${viewport.width}px`).toBeLessThan(3700);
  740 |   }
  741 | });
  742 | 
  743 | // La vidriera intercalada tiene cuatro reglas que no pueden aflojarse sin que la
  744 | // home vuelva a ser un muestrario: un banner no repite un destino que ya tiene
  745 | // carrusel, no hay dos destinos iguales, nunca hay dos seguidos y ninguno afirma
  746 | // un precio.
  747 | //
  748 | // Un banner tiene DOS formas de destino y las dos son reales: `data-category-id`
  749 | // filtra el catálogo por rubro y `data-brand-query` lo busca por marca. La de
  750 | // marca existe porque hay marcas que son un motivo de compra en sí mismas
  751 | // (Heineken) y que, metidas dentro del banner de "Cervezas", desaparecían. El
  752 | // test las trata igual: lo que se verifica es que el destino traiga producto
  753 | // COMPRABLE (P1-2), no de qué clase es.
  754 | test('los banners editoriales cortan el ritmo sin repetir destino ni prometer precio', async ({ page }) => {
  755 |   await openHome(page);
  756 | 
  757 |   const composicion = await page.evaluate(() => {
  758 |     const visible = (node) => getComputedStyle(node).display !== 'none';
  759 |     const banners = [...document.querySelectorAll('[data-view="home"] .home-brand-banner')].filter(visible);
  760 |     const secciones = [...document.querySelectorAll('[data-home-sections] .home-category-section')];
  761 |     const destino = (node) => (node.dataset.categoryId
  762 |       ? { tipo: 'categoria', valor: node.dataset.categoryId }
  763 |       : { tipo: 'marca', valor: node.dataset.brandQuery });
  764 |     return {
  765 |       destinos: banners.map(destino),
  766 |       textos: banners.map((node) => node.textContent.replace(/\s+/g, ' ').trim()),
  767 |       seccionesConCarrusel: secciones
  768 |         .map((node) => node.querySelector('[data-category-id]')?.dataset.categoryId)
  769 |         .filter(Boolean),
  770 |       // Dos banners "seguidos" = sin un tramo de producto entre medio.
  771 |       adyacentes: banners.filter((node, index) => {
```