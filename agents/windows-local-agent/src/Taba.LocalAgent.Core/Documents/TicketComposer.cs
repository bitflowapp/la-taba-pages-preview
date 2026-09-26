using System.Globalization;

namespace Taba.LocalAgent.Core.Documents;

/// <summary>
/// Arma los documentos del mostrador. Cada uno dice lo que es y nada más:
/// la comanda no lleva precios, el ticket de pedido dice que no es factura y el
/// comprobante fiscal sólo existe con CAE (lo garantiza el parser).
/// </summary>
public sealed class TicketComposer(TimeZoneInfo? timeZone = null)
{
    private static readonly CultureInfo Argentina = CultureInfo.GetCultureInfo("es-AR");
    private readonly TimeZoneInfo _timeZone = timeZone ?? TimeZoneInfo.Local;

    /// <summary>Comanda de cocina: qué preparar. Sin precios ni forma de pago.</summary>
    public TicketDocument KitchenTicket(OrderPayload order)
    {
        ArgumentNullException.ThrowIfNull(order);
        var local = TimeZoneInfo.ConvertTime(order.CreatedAt, _timeZone);
        var ticket = new TicketBuilder($"La Taba - comanda {order.Code}")
            .Text(order.BusinessName, TicketAlign.Center, bold: true)
            .Text(order.Code, TicketAlign.Center, bold: true, large: true)
            .Text($"{local.ToString("dd/MM HH:mm", Argentina)} - {Fulfillment(order.Fulfillment)}", TicketAlign.Center);
        if (order.Reprint)
        {
            ticket.Text("*** REIMPRESION ***", TicketAlign.Center, bold: true);
        }

        ticket.Separator();
        foreach (var item in order.Items)
        {
            ticket.Text($"{Quantity(item.Quantity, item.Unit)} x {item.Name}", bold: true);
        }

        ticket.Separator();
        if (!string.IsNullOrWhiteSpace(order.Notes))
        {
            ticket.Text($"Nota: {order.Notes}", bold: true);
        }

        return ticket.Feed(3).Build();
    }

    /// <summary>Ticket de pedido o entrega. Dice explícitamente que no es comprobante fiscal.</summary>
    public TicketDocument OrderTicket(OrderPayload order)
    {
        ArgumentNullException.ThrowIfNull(order);
        var local = TimeZoneInfo.ConvertTime(order.CreatedAt, _timeZone);
        var ticket = new TicketBuilder($"La Taba - pedido {order.Code}")
            .Text(order.BusinessName, TicketAlign.Center, bold: true)
            .Text($"Pedido {order.Code}", TicketAlign.Center, bold: true)
            .Text(local.ToString("dd/MM/yyyy HH:mm", Argentina), TicketAlign.Center);
        if (order.Reprint)
        {
            ticket.Text("*** REIMPRESION ***", TicketAlign.Center, bold: true);
        }

        ticket.Text(Fulfillment(order.Fulfillment)).Separator();
        foreach (var item in order.Items)
        {
            ticket.Split($"{Quantity(item.Quantity, item.Unit)} x {item.Name}", item.Subtotal is { } subtotal ? Money(subtotal) : string.Empty);
            if (item.Quantity != 1 && item.UnitPrice is { } unit)
            {
                ticket.Text($"  c/u {Money(unit)}");
            }
        }

        ticket.Separator();
        var hasExtras = order.DeliveryFee is > 0 || order.Discount is > 0;
        if (hasExtras && order.Subtotal is { } sub)
        {
            ticket.Split("Subtotal", Money(sub));
        }

        if (order.DeliveryFee is > 0 and var fee)
        {
            ticket.Split("Envio", Money(fee));
        }

        if (order.Discount is > 0 and var discount)
        {
            ticket.Split("Descuento", "-" + Money(discount));
        }

        if (order.Total is { } total)
        {
            ticket.Split("TOTAL", Money(total), bold: true);
        }

        if (!string.IsNullOrWhiteSpace(order.PaymentLabel))
        {
            ticket.Text($"Pago: {order.PaymentLabel}");
        }

        if (!string.IsNullOrWhiteSpace(order.RiderName))
        {
            ticket.Text($"Reparte: {order.RiderName}");
        }

        if (!string.IsNullOrWhiteSpace(order.Notes))
        {
            ticket.Text($"Nota: {order.Notes}");
        }

        return ticket.Separator().Text("No valido como factura", TicketAlign.Center).Feed(3).Build();
    }

    /// <summary>Comprobante fiscal autorizado: emisor, tipo y número, receptor, total, CAE, vencimiento y QR de ARCA.</summary>
    public static TicketDocument FiscalReceipt(FiscalPayload receipt)
    {
        ArgumentNullException.ThrowIfNull(receipt);
        var test = !string.Equals(receipt.Environment, "production", StringComparison.Ordinal);
        var ticket = new TicketBuilder($"La Taba - comprobante {receipt.PointOfSale:00000}-{receipt.VoucherNumber:00000000}");
        if (test)
        {
            ticket.Text("COMPROBANTE DE PRUEBA", TicketAlign.Center, bold: true)
                .Text("SIN VALIDEZ FISCAL", TicketAlign.Center, bold: true);
        }

        ticket.Text(receipt.IssuerName, TicketAlign.Center, bold: true)
            .Text($"CUIT {Cuit(receipt.IssuerCuit)}", TicketAlign.Center);
        if (!string.IsNullOrWhiteSpace(receipt.IssuerTaxCondition))
        {
            ticket.Text(TaxCondition(receipt.IssuerTaxCondition), TicketAlign.Center);
        }

        if (!string.IsNullOrWhiteSpace(receipt.IssuerAddress))
        {
            ticket.Text(receipt.IssuerAddress, TicketAlign.Center);
        }

        if (!string.IsNullOrWhiteSpace(receipt.IssuerGrossIncome))
        {
            ticket.Text($"IIBB {receipt.IssuerGrossIncome}", TicketAlign.Center);
        }

        ticket.Separator()
            .Text(receipt.VoucherLabel.ToUpper(Argentina), TicketAlign.Center, bold: true, large: true)
            .Text(string.Create(CultureInfo.InvariantCulture, $"Cod. {receipt.VoucherTypeCode:00}"), TicketAlign.Center)
            .Text(string.Create(CultureInfo.InvariantCulture, $"Nro {receipt.PointOfSale:00000}-{receipt.VoucherNumber:00000000}"), TicketAlign.Center)
            .Text($"Fecha {receipt.IssueDate.ToString("dd/MM/yyyy", Argentina)}", TicketAlign.Center);
        if (receipt.Reprint)
        {
            ticket.Text("DUPLICADO", TicketAlign.Center, bold: true);
        }

        if (receipt.AssociatedVoucher is { } associated)
        {
            ticket.Text($"Comprobante asociado: {associated}");
        }

        ticket.Separator().Text($"Receptor: {TaxCondition(receipt.ReceiverCondition ?? "consumidor_final")}");
        if (receipt.ReceiverDocumentType is { } docType and not 99 && !string.IsNullOrWhiteSpace(receipt.ReceiverDocumentNumber))
        {
            ticket.Text($"{DocumentTypeLabel(docType)} {receipt.ReceiverDocumentNumber}");
        }

        ticket.Separator();
        foreach (var item in receipt.Items)
        {
            ticket.Split($"{Quantity(item.Quantity, null)} x {item.Description}", Money(item.Quantity * item.UnitPrice));
        }

        ticket.Separator().Split("TOTAL", Money(receipt.Total), bold: true);
        if (!string.Equals(receipt.Currency, "PES", StringComparison.Ordinal))
        {
            ticket.Text(string.Create(CultureInfo.InvariantCulture, $"Moneda {receipt.Currency} - cotizacion {receipt.CurrencyRate:0.######}"));
        }

        ticket.Separator()
            .Text($"CAE {receipt.Cae}")
            .Text($"Vto. CAE {receipt.CaeExpiration.ToString("dd/MM/yyyy", Argentina)}")
            .Qr(receipt.QrUrl);
        if (test)
        {
            ticket.Text("SIN VALIDEZ FISCAL", TicketAlign.Center, bold: true);
        }

        return ticket.Feed(3).Build();
    }

    /// <summary>Hoja de prueba: impresora, ancho, tabla de caracteres, acentos, regla de columnas y un QR.</summary>
    public static TicketDocument TestPage(string printerName, int paperWidthMm, int columns, string codePage, DateTimeOffset now)
    {
        var ruler = string.Concat(Enumerable.Range(0, (columns + 9) / 10).Select(i => "1234567890"))[..columns];
        return new TicketBuilder("La Taba - prueba de impresion")
            .Text("La Taba - prueba de impresion", TicketAlign.Center, bold: true)
            .Text(printerName, TicketAlign.Center)
            .Text(string.Create(CultureInfo.InvariantCulture, $"{paperWidthMm} mm - {columns} columnas - {codePage}"), TicketAlign.Center)
            .Text(now.ToString("dd/MM/yyyy HH:mm", Argentina), TicketAlign.Center)
            .Separator('=')
            .Text("Acentos: aeiou AEIOU -> áéíóú ÁÉÍÓÚ ñ Ñ ü ¿? ¡!")
            .Text(ruler)
            .Split("Izquierda", "Derecha")
            .Text("Centrado", TicketAlign.Center)
            .Text("Negrita", bold: true)
            .Text("Grande", TicketAlign.Center, large: true)
            .Qr("https://la-taba-commercial-pilot.pages.dev/")
            .Text("Si ves esta hoja cortada, la impresora esta lista.", TicketAlign.Center)
            .Feed(3)
            .Build();
    }

    public static string Money(decimal amount) => "$ " + amount.ToString("#,##0.00", Argentina);

    public static string Cuit(string cuit) =>
        cuit.Length == 11 ? $"{cuit[..2]}-{cuit[2..10]}-{cuit[10..]}" : cuit;

    private static string Quantity(decimal quantity, string? unit)
    {
        var number = quantity == decimal.Truncate(quantity)
            ? decimal.Truncate(quantity).ToString(CultureInfo.InvariantCulture)
            : quantity.ToString("0.###", Argentina);
        return unit is null or "u" or "un" or "unidad" ? number : $"{number} {unit}";
    }

    private static string Fulfillment(string value) => value switch
    {
        "delivery" => "Envio a domicilio",
        "pickup" => "Retira en el local",
        _ => value,
    };

    private static string TaxCondition(string value) => value switch
    {
        "consumidor_final" => "Consumidor Final",
        "monotributo" or "responsable_monotributo" => "Responsable Monotributo",
        "responsable_inscripto" => "IVA Responsable Inscripto",
        "exento" or "iva_sujeto_exento" => "IVA Sujeto Exento",
        _ => value.Replace('_', ' '),
    };

    private static string DocumentTypeLabel(int type) => type switch
    {
        80 => "CUIT",
        86 => "CUIL",
        96 => "DNI",
        _ => string.Create(CultureInfo.InvariantCulture, $"Doc. {type}"),
    };
}
