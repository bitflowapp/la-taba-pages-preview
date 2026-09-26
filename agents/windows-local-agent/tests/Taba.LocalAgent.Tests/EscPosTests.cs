using System.Text;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Core.Printing.EscPos;

namespace Taba.LocalAgent.Tests;

/// <summary>Documentos del mostrador y su codificación ESC/POS en 58 y 80 mm.</summary>
public sealed class EscPosTests
{
    private static readonly TimeZoneInfo Argentina = TimeZoneInfo.CreateCustomTimeZone("AR", TimeSpan.FromHours(-3), "AR", "AR");
    private static readonly TicketComposer Composer = new(Argentina);
    private static readonly PrinterProfile Thermal80 = new("Termica 80", PrinterDriverKind.EscPos, 80);
    private static readonly PrinterProfile Thermal58 = new("Termica 58", PrinterDriverKind.EscPos, 58);

    private static string Ascii(byte[] bytes) => Encoding.ASCII.GetString(bytes);

    private static byte[] Encode(TicketDocument document, PrinterProfile? profile = null) => EscPosEncoder.Encode(document, profile ?? Thermal80);

    [Fact]
    public void Todo_documento_empieza_inicializando_la_impresora_y_termina_cortando()
    {
        var bytes = Encode(Composer.KitchenTicket(PrintPayloadParser.ParseOrder(Payloads.Order())));
        Assert.Equal(new byte[] { 0x1B, (byte)'@' }, bytes[..2]);
        Assert.Equal(new byte[] { 0x1D, (byte)'V', 66, 3 }, bytes[^4..]);
    }

    [Fact]
    public void La_comanda_no_lleva_precios_y_el_ticket_dice_que_no_es_factura()
    {
        var order = PrintPayloadParser.ParseOrder(Payloads.Order());
        var kitchen = Ascii(Encode(Composer.KitchenTicket(order)));
        Assert.Contains("2 x Fernet Branca 750 ml", kitchen, StringComparison.Ordinal);
        Assert.Contains("Nota: sin cebolla", kitchen, StringComparison.Ordinal);
        Assert.DoesNotContain("$", kitchen, StringComparison.Ordinal);
        Assert.DoesNotContain("Efectivo", kitchen, StringComparison.Ordinal);

        var ticket = Ascii(Encode(Composer.OrderTicket(order)));
        Assert.Contains("No valido como factura", ticket, StringComparison.Ordinal);
        Assert.Contains("Pago: Efectivo", ticket, StringComparison.Ordinal);
        Assert.Contains("Reparte: Marco", ticket, StringComparison.Ordinal);
        Assert.Contains("Envio a domicilio", ticket, StringComparison.Ordinal);
        Assert.Matches(@"TOTAL\s+\$ 3\.800,00", ticket);
        Assert.Contains("c/u $ 1.250,00", ticket, StringComparison.Ordinal);
    }

    [Fact]
    public void La_hora_del_ticket_es_la_del_local_no_la_del_servidor()
    {
        var ticket = Ascii(Encode(Composer.OrderTicket(PrintPayloadParser.ParseOrder(Payloads.Order()))));
        Assert.Contains("26/09/2026 15:30", ticket, StringComparison.Ordinal);
    }

    [Fact]
    public void Una_reimpresion_lo_dice_en_el_papel()
    {
        var order = PrintPayloadParser.ParseOrder(Payloads.Order(reprint: true));
        Assert.Contains("*** REIMPRESION ***", Ascii(Encode(Composer.KitchenTicket(order))), StringComparison.Ordinal);
        Assert.Contains("*** REIMPRESION ***", Ascii(Encode(Composer.OrderTicket(order))), StringComparison.Ordinal);
        Assert.Contains("DUPLICADO", Ascii(Encode(TicketComposer.FiscalReceipt(PrintPayloadParser.ParseFiscal(Payloads.Fiscal(reprint: true))))), StringComparison.Ordinal);
    }

    [Fact]
    public void Los_acentos_se_transliteran_para_no_imprimir_basura()
    {
        Assert.Equal("Neuquen - cafe con n? - Pina", EscPosBuilder.Transliterate("Neuquén – café con ñ? — Piña"));
        Assert.Equal("Que tal!", EscPosBuilder.Transliterate("¿Qué tal!"));
        Assert.Equal("\"hola\"", EscPosBuilder.Transliterate("«hola»"));
    }

    [Fact]
    public void Con_la_tabla_PC850_se_imprimen_los_acentos_de_verdad()
    {
        var bytes = new EscPosBuilder(48, EscPosCodePage.Pc850).Line("Neuquén ñandú ¿Sí?").Build();
        Assert.Equal(new byte[] { 0x1B, (byte)'@', 0x1B, (byte)'t', 2 }, bytes[..5]);
        var text = bytes[5..^1];
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        Assert.Equal("Neuquén ñandú ¿Sí?", Encoding.GetEncoding(850).GetString(text));
    }

    [Fact]
    public void Un_caracter_que_la_tabla_no_tiene_sale_como_signo_de_pregunta_no_como_basura()
    {
        var bytes = new EscPosBuilder(48, EscPosCodePage.Pc850).Line("precio €5").Build();
        Assert.Equal("precio ?5", Encoding.ASCII.GetString(bytes[5..^1]));
    }

    [Fact]
    public void El_qr_usa_el_comando_gs_k_modelo_2_con_el_largo_correcto()
    {
        const string Data = "https://www.arca.gob.ar/fe/qr/?p=abc";
        var bytes = new EscPosBuilder(32).QrCode(Data).Build();
        var store = Array.IndexOf(bytes, (byte)80);
        Assert.True(store > 0);
        Assert.Equal(new byte[] { 0x1D, (byte)'(', (byte)'k', 4, 0, 49, 65, 50, 0 }, bytes[2..11]);
        var length = Data.Length + 3;
        Assert.Equal((byte)(length & 0xFF), bytes[store - 3]);
        Assert.Equal((byte)(length >> 8), bytes[store - 2]);
        Assert.Throws<ArgumentOutOfRangeException>(() => new EscPosBuilder(32).QrCode("ñandú"));
    }

    [Theory]
    [InlineData("", "FISCAL_WITHOUT_CAE")]
    [InlineData("123", "FISCAL_WITHOUT_CAE")]
    [InlineData("1234567890123A", "FISCAL_WITHOUT_CAE")]
    [InlineData("123456789012345", "MALFORMED_PAYLOAD")]
    public void Un_comprobante_fiscal_sin_cae_valido_no_se_puede_ni_construir(string cae, string code)
    {
        var error = Assert.Throws<MalformedPayloadException>(() => PrintPayloadParser.ParseFiscal(Payloads.Fiscal(cae: cae)));
        Assert.Equal(code, error.Code);
    }

    [Fact]
    public void El_comprobante_autorizado_imprime_emisor_tipo_numero_cae_vencimiento_y_qr()
    {
        var bytes = Encode(TicketComposer.FiscalReceipt(PrintPayloadParser.ParseFiscal(Payloads.Fiscal(environment: "production"))));
        var text = Ascii(bytes);
        Assert.Contains("TABA IMPRIME SA", text, StringComparison.Ordinal);
        Assert.Contains("CUIT 20-12345678-9", text, StringComparison.Ordinal);
        Assert.Contains("FACTURA C", text, StringComparison.Ordinal);
        Assert.Contains("Cod. 11", text, StringComparison.Ordinal);
        Assert.Contains("Nro 00001-00000123", text, StringComparison.Ordinal);
        Assert.Contains("CAE 12345678901234", text, StringComparison.Ordinal);
        Assert.Contains("Vto. CAE 06/10/2026", text, StringComparison.Ordinal);
        Assert.Contains("Receptor: Consumidor Final", text, StringComparison.Ordinal);
        Assert.Contains("https://www.arca.gob.ar/fe/qr/?p=eyJ2ZXIiOjF9", text, StringComparison.Ordinal);
        Assert.DoesNotContain("SIN VALIDEZ FISCAL", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Un_comprobante_de_homologacion_dice_que_no_tiene_validez_fiscal()
    {
        var text = Ascii(Encode(TicketComposer.FiscalReceipt(PrintPayloadParser.ParseFiscal(Payloads.Fiscal()))));
        Assert.Contains("COMPROBANTE DE PRUEBA", text, StringComparison.Ordinal);
        Assert.Equal(2, text.Split("SIN VALIDEZ FISCAL").Length - 1);
    }

    [Theory]
    [InlineData(58, 32)]
    [InlineData(80, 48)]
    public void Cada_ancho_de_papel_respeta_sus_columnas(int width, int columns)
    {
        var profile = new PrinterProfile("T", PrinterDriverKind.EscPos, width);
        Assert.Equal(columns, profile.EffectiveColumns);
        var bytes = Encode(Composer.OrderTicket(PrintPayloadParser.ParseOrder(Payloads.Order(notes: new string('x', 120)))), profile);
        var lines = Ascii(bytes).Split('\n').Select(l => new string(l.Where(c => c >= 0x20 && c < 0x7F).ToArray()));
        Assert.All(lines, line => Assert.True(line.Length <= columns + 8, $"renglon de {line.Length}: {line}"));
        Assert.Contains(new string('-', columns), Ascii(bytes), StringComparison.Ordinal);
    }

    [Fact]
    public void Un_item_largo_se_parte_y_el_importe_queda_en_el_ultimo_renglon()
    {
        var bytes = new EscPosBuilder(32).Row("2 x Fernet Branca edicion especial aniversario 750 ml", "$ 2.500,00").Build();
        var lines = Ascii(bytes[2..]).Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.True(lines.Length >= 2);
        Assert.EndsWith("$ 2.500,00", lines[^1], StringComparison.Ordinal);
        Assert.All(lines, line => Assert.True(line.Length <= 32));
    }

    [Fact]
    public void Las_palabras_largas_se_parten_sin_perder_texto()
    {
        var word = new string('a', 70);
        var lines = TextWrap.Wrap($"{word} fin", 32);
        Assert.Equal(word + "fin", string.Concat(lines).Replace(" ", string.Empty, StringComparison.Ordinal));
        Assert.All(lines, line => Assert.True(line.Length <= 32));
    }

    [Fact]
    public void El_texto_grande_se_corta_a_la_mitad_de_columnas()
    {
        var document = new TicketBuilder("t").Text("PEDIDO-LARGO-DE-PRUEBA-PARA-DOBLE-ANCHO", large: true).Build();
        var bytes = Encode(document, Thermal58);
        var text = Ascii(bytes);
        Assert.Contains("\u001d!\u0011", text, StringComparison.Ordinal);
        var body = text[(text.IndexOf("\u001d!\u0011", StringComparison.Ordinal) + 3)..text.IndexOf("\u001d!\0", StringComparison.Ordinal)];
        Assert.All(body.Split('\n', StringSplitOptions.RemoveEmptyEntries), line => Assert.True(line.Length <= 16));
    }

    [Fact]
    public void La_hoja_de_prueba_dice_impresora_ancho_y_tabla()
    {
        var page = TicketComposer.TestPage("POS-80", 80, 48, "Pc850", DateTimeOffset.Parse("2026-09-26T12:00:00-03:00", System.Globalization.CultureInfo.InvariantCulture));
        var text = Ascii(Encode(page));
        Assert.Contains("POS-80", text, StringComparison.Ordinal);
        Assert.Contains("80 mm - 48 columnas - Pc850", text, StringComparison.Ordinal);
        Assert.Contains("123456789012345678901234567890123456789012345678", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Un_perfil_invalido_se_rechaza_antes_de_imprimir()
    {
        Assert.Throws<ArgumentException>(() => new PrinterProfile("", PrinterDriverKind.EscPos).Validate());
        Assert.Throws<ArgumentException>(() => new PrinterProfile("T", PrinterDriverKind.EscPos, 76).Validate());
        Assert.Throws<ArgumentException>(() => new PrinterProfile("T", PrinterDriverKind.EscPos, 80, null, EscPosCodePage.Ascii, 9).Validate());
        new PrinterProfile("A4 oficina", PrinterDriverKind.Windows, 210).Validate();
    }
}
