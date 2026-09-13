# Commerce V3 · iPhone bugfix and friction pass

## Address flow observed before this pass

In checkout the address editor was already inline, so opening it did not navigate to another page. With an empty profile, the customer first saved name and phone. For a new delivery address the sequence was:

1. Tap **Agregar dirección**.
2. Write **Calle** and **Número** in the same form. Optional delivery details were collapsed. The first address was already marked as default.
3. Tap **Elegir en el mapa** (or **Usar mi ubicación**, which asks for browser permission only after this tap).
4. Choose the door on the map or adjust the pin. A denied GPS permission left the map route available.
5. Tap **Confirmar ubicación**.
6. Tap **Guardar dirección**. Checkout selected the saved address automatically.

That is five touch actions apart from typing when using the map (open, map, pin, confirm, save), one inline editor, two required text fields, and an explicit location confirmation. A GPS result replaced the map/pin actions but still needed its own confirmation and save. No extra "set default" action was required for a first address.

## Address flow after this pass

1. Tap **Agregar dirección**.
2. Write **Calle** and **Número** together; optional fields remain available in the same block.
3. Tap **Elegir en el mapa**, choose the door, then tap **Guardar dirección**. That save confirms the selected point, closes the editor, selects the saved address and keeps the customer in checkout.

The map route now takes four touch actions apart from typing (open, map, pin, save). Using GPS takes three (open, use location, save), with permission requested only after the GPS action. A denied permission never disables the map route. The customer sees a readable address and “Ubicación confirmada”; coordinates, accuracy and source stay in the address data, not in the customer interface.

GPS itself is optional. A **confirmed delivery point** is still required by the existing client and order contracts (`js/core/delivery-location.js`, the `saveAddress` gate in `js/address-capture-controller.js`, and the database order location constraint). Street and number alone are not accepted as a delivery destination by that contract. This pass does not loosen it or infer coordinates from an unverified street address.

The payment method remains the same native select and the same two enabled methods; its mobile hit target is larger. No payment rule or financial gate changed.
