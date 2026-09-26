using System.Text.Json;

namespace Taba.LocalAgent.Cli;

/// <summary>
/// Muestras para certificar cada documento en papel. No llevan datos de
/// clientes y el comprobante fiscal es de homologación con CAE en ceros: el
/// papel dice «COMPROBANTE DE PRUEBA / SIN VALIDEZ FISCAL» arriba y abajo.
/// </summary>
internal static class Samples
{
    public static JsonElement Order() => Parse("""
        {"business":{"name":"La Taba - MUESTRA"},
         "order":{"code":"MUESTRA-1","created_at":"2026-09-26T21:30:00+00:00","fulfillment":"delivery","notes":"sin hielo, tocar timbre",
                  "items":[{"name":"Fernet Branca 750 ml","quantity":2,"unit":"u","unit_price":12500,"subtotal":25000},
                           {"name":"Coca-Cola 2,25 L","quantity":1,"unit":null,"unit_price":4200,"subtotal":4200},
                           {"name":"Hielo en cubos 2 kg (bolsa)","quantity":1,"unit":null,"unit_price":2500,"subtotal":2500}],
                  "subtotal":31700,"delivery_fee":1500,"discount":0,"total":33200,"currency":"ARS",
                  "payment":{"method":"cash","label":"Efectivo"},"rider":null},
         "reprint":false}
        """);

    public static JsonElement Fiscal() => Parse("""
        {"environment":"homologation",
         "issuer":{"legal_name":"La Taba - MUESTRA","cuit":"20000000001","tax_condition":"monotributo","address":"Neuquén Capital","gross_income_number":null},
         "receiver":{"condition":"consumidor_final","document_type":99,"document_number":"0"},
         "voucher":{"type_code":11,"label":"Factura C","point_of_sale":1,"number":1,"issue_date":"2026-09-26","intent":"invoice","associated":null},
         "items":[{"description":"Fernet Branca 750 ml","quantity":2,"unit_price":12500,"net_amount":25000,"tax_amount":0}],
         "totals":{"net":25000,"tax":0,"exempt":0,"non_taxed":0,"other_taxes":0,"total":25000,"currency":"PES","currency_rate":1},
         "cae":"00000000000000","cae_expiration":"2026-10-06",
         "qr_url":"https://www.arca.gob.ar/fe/qr/?p=MUESTRA",
         "reprint":false}
        """);

    private static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}
