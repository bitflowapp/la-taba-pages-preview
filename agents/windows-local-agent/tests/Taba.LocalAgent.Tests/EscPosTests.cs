using System.Text;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Core.Printing.EscPos;

namespace Taba.LocalAgent.Tests;

public sealed class EscPosTests
{
    private static readonly DateTimeOffset At = new(2026, 9, 26, 22, 4, 0, TimeSpan.FromHours(-3));

    private static OrderTicketData Order() => new(
        "La Taba",
        "LT-2044",
        At,
        "Delivery",
        [new TicketLine(4, "Gaseosa cola 2,25 L", LineTotal: 9600m), new TicketLine(2, "Papas fritas clásicas 150 g", "bien crocantes", 3200m)],
        "Diego Arriagada",
        "Mendoza 851, Neuquén",
        12800m,
        "Efectivo al recibir");

    [Fact]
    public void Todo_documento_empieza_inicializando_la_impresora_y_termina_cortando()
    {
        var bytes = TicketRenderer.KitchenTicket(Order(), PrintFormat.EscPos80mm);

        Assert.Equal(new byte[] { 0x1B, 0x40 }, bytes[..2]);
        Assert.Equal(new byte[] { 0x1D, 0x56, 66, 3 }, bytes[^4..]);
    }

    [Theory]
    [InlineData(PrintFormat.EscPos58mm, 32)]
    [InlineData(PrintFormat.EscPos80mm, 48)]
    public void Ningun_renglon_supera_el_ancho_del_papel(PrintFormat format, int columns)
    {
        var text = Printable(TicketRenderer.OrderTicket(Order() with { DeliveryAddress = new string('x', 120) }, format));

        Assert.All(text.Split('\n'), line => Assert.True(line.Length <= columns, $"«{line}» mide {line.Length}"));
    }

    [Fact]
    public void La_comanda_no_lleva_precios_y_el_ticket_dice_que_no_es_factura()
    {
        var kitchen = Printable(TicketRenderer.KitchenTicket(Order(), PrintFormat.EscPos80mm));
        var ticket = Printable(TicketRenderer.OrderTicket(Order(), PrintFormat.EscPos80mm));

        Assert.Contains("LT-2044", kitchen, StringComparison.Ordinal);
        Assert.Contains("4 x Gaseosa cola 2,25 L", kitchen, StringComparison.Ordinal);
        Assert.Contains("Nota: bien crocantes", kitchen, StringComparison.Ordinal);
        Assert.DoesNotContain("$", kitchen, StringComparison.Ordinal);
        Assert.Contains("TOTAL", ticket, StringComparison.Ordinal);
        Assert.Contains("No valido como factura", ticket, StringComparison.Ordinal);
    }

    [Fact]
    public void Los_acentos_se_transliteran_para_no_imprimir_basura()
    {
        Assert.Equal("Neuquen - canon Anadir", EscPosBuilder.Transliterate("Neuquén · cañón Añadir"));
        Assert.Equal("Todavia?", EscPosBuilder.Transliterate("¿Todavía?"));
        var bytes = new EscPosBuilder(32).Line("Neuquén").Build();
        Assert.All(bytes, b => Assert.True(b < 0x80));
    }

    [Fact]
    public void El_qr_usa_el_comando_gs_k_modelo_2_con_el_largo_correcto()
    {
        const string Url = "https://www.arca.gob.ar/fe/qr/?p=eyJ2ZXIiOjF9";
        var bytes = new EscPosBuilder(48).QrCode(Url).Build();
        var data = Encoding.ASCII.GetBytes(Url);
        var length = data.Length + 3;
        var store = new byte[] { 0x1D, (byte)'(', (byte)'k', (byte)(length & 0xFF), (byte)(length >> 8), 49, 80, 48 };

        var at = IndexOf(bytes, store);
        Assert.True(at > 0, "falta el comando que guarda el dato del QR");
        Assert.Equal(data, bytes[(at + store.Length)..(at + store.Length + data.Length)]);
        Assert.True(IndexOf(bytes, new byte[] { 0x1D, (byte)'(', (byte)'k', 4, 0, 49, 65, 50, 0 }) >= 0, "falta elegir el modelo 2");
        Assert.True(IndexOf(bytes, new byte[] { 0x1D, (byte)'(', (byte)'k', 3, 0, 49, 81, 48 }) > at, "falta imprimir el QR guardado");
    }

    [Fact]
    public void Un_comprobante_fiscal_sin_cae_valido_no_se_puede_ni_construir()
    {
        Assert.Throws<ArgumentException>(() => Receipt(cae: ""));
        Assert.Throws<ArgumentException>(() => Receipt(cae: "1234"));
        Assert.Throws<ArgumentException>(() => Receipt(cae: "7412345678901X"));
        Assert.Throws<ArgumentException>(() => Receipt(qr: "http://inseguro"));
    }

    [Fact]
    public void El_comprobante_autorizado_imprime_cae_vencimiento_y_qr()
    {
        var text = Printable(TicketRenderer.FiscalReceipt(Receipt(), PrintFormat.EscPos80mm));

        Assert.Contains("CAE 74123456789012", text, StringComparison.Ordinal);
        Assert.Contains("Vto. CAE 06/10/2026", text, StringComparison.Ordinal);
        Assert.Contains("Factura B 00004-00000042", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Las_palabras_largas_se_parten_sin_perder_texto()
    {
        var lines = EscPosBuilder.Wrap("Supercalifragilisticoespialidoso de verdad", 10).ToList();

        Assert.All(lines, line => Assert.True(line.Length <= 10));
        Assert.Equal("Supercalifragilisticoespialidoso de verdad".Replace(" ", "", StringComparison.Ordinal), string.Concat(lines).Replace(" ", "", StringComparison.Ordinal));
    }

    private static AuthorizedFiscalReceipt Receipt(string cae = "74123456789012", string qr = "https://www.arca.gob.ar/fe/qr/?p=abc") =>
        new("La Taba", "20-00000000-1", "Factura B", 4, 42, new DateOnly(2026, 9, 26), 12100m, cae, new DateOnly(2026, 10, 6), qr);

    /// <summary>El texto imprimible: saca los comandos ESC/POS conocidos y deja los renglones.</summary>
    private static string Printable(byte[] bytes)
    {
        var text = new StringBuilder();
        for (var i = 0; i < bytes.Length; i++)
        {
            var b = bytes[i];
            if (b == 0x1B)
            {
                i += bytes[i + 1] == (byte)'@' ? 1 : 2;
                continue;
            }

            if (b == 0x1D)
            {
                if (bytes[i + 1] == (byte)'(')
                {
                    var length = bytes[i + 3] | (bytes[i + 4] << 8);
                    i += 4 + length;
                    continue;
                }

                i += bytes[i + 1] == (byte)'V' ? 3 : 2;
                continue;
            }

            text.Append((char)b);
        }

        return text.ToString().TrimEnd('\n');
    }

    private static int IndexOf(byte[] haystack, byte[] needle)
    {
        for (var i = 0; i <= haystack.Length - needle.Length; i++)
        {
            if (haystack.AsSpan(i, needle.Length).SequenceEqual(needle))
            {
                return i;
            }
        }

        return -1;
    }
}
