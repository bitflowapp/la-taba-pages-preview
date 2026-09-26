using System.Globalization;

namespace Taba.LocalAgent.Core.Printing.EscPos;

/// <summary>Un renglón de pedido tal como lo manda el backend.</summary>
public sealed record TicketLine(decimal Quantity, string Description, string? Note = null, decimal? LineTotal = null);

/// <summary>Los datos de un pedido para comanda o ticket. No incluye datos fiscales.</summary>
public sealed record OrderTicketData(
    string BusinessName,
    string OrderCode,
    DateTimeOffset CreatedAt,
    string FulfillmentLabel,
    IReadOnlyList<TicketLine> Lines,
    string? CustomerName = null,
    string? DeliveryAddress = null,
    decimal? Total = null,
    string? PaymentLabel = null);

/// <summary>
/// Un comprobante fiscal YA AUTORIZADO. El constructor exige un CAE de 14
/// dígitos y la URL del QR de ARCA: no hay forma de renderizar un comprobante
/// fiscal sin autorización.
/// </summary>
public sealed record AuthorizedFiscalReceipt
{
    public AuthorizedFiscalReceipt(
        string issuerName,
        string issuerCuit,
        string voucherLabel,
        int pointOfSale,
        long voucherNumber,
        DateOnly issueDate,
        decimal total,
        string cae,
        DateOnly caeExpiration,
        string qrUrl)
    {
        if (cae is null || cae.Length != 14 || !cae.All(char.IsAsciiDigit))
        {
            throw new ArgumentException("CAE_REQUIRED", nameof(cae));
        }

        if (!Uri.TryCreate(qrUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
        {
            throw new ArgumentException("QR_URL_REQUIRED", nameof(qrUrl));
        }

        IssuerName = issuerName;
        IssuerCuit = issuerCuit;
        VoucherLabel = voucherLabel;
        PointOfSale = pointOfSale;
        VoucherNumber = voucherNumber;
        IssueDate = issueDate;
        Total = total;
        Cae = cae;
        CaeExpiration = caeExpiration;
        QrUrl = qrUrl;
    }

    public string IssuerName { get; }

    public string IssuerCuit { get; }

    public string VoucherLabel { get; }

    public int PointOfSale { get; }

    public long VoucherNumber { get; }

    public DateOnly IssueDate { get; }

    public decimal Total { get; }

    public string Cae { get; }

    public DateOnly CaeExpiration { get; }

    public string QrUrl { get; }
}

/// <summary>Arma los tres documentos térmicos. Cada uno dice lo que es y nada más.</summary>
public static class TicketRenderer
{
    private static readonly CultureInfo Argentina = CultureInfo.GetCultureInfo("es-AR");

    /// <summary>Comanda de cocina: qué preparar. Sin precios, en letra grande lo que importa.</summary>
    public static byte[] KitchenTicket(OrderTicketData order, PrintFormat format)
    {
        ArgumentNullException.ThrowIfNull(order);
        var ticket = new EscPosBuilder(EscPosBuilder.ColumnsFor(format))
            .Align(TextAlign.Center).Bold(true).Line(order.BusinessName).Bold(false)
            .DoubleSize(true).Line(order.OrderCode).DoubleSize(false)
            .Line($"{order.CreatedAt.ToString("dd/MM HH:mm", Argentina)} - {order.FulfillmentLabel}")
            .Align(TextAlign.Left).Separator();
        foreach (var line in order.Lines)
        {
            ticket.Bold(true).Line($"{Quantity(line.Quantity)} x {line.Description}").Bold(false);
            if (!string.IsNullOrWhiteSpace(line.Note))
            {
                ticket.Line($"   Nota: {line.Note}");
            }
        }

        return ticket.Separator().Feed(3).Cut().Build();
    }

    /// <summary>Ticket de pedido o entrega. Dice explícitamente que no es comprobante fiscal.</summary>
    public static byte[] OrderTicket(OrderTicketData order, PrintFormat format)
    {
        ArgumentNullException.ThrowIfNull(order);
        var ticket = new EscPosBuilder(EscPosBuilder.ColumnsFor(format))
            .Align(TextAlign.Center).Bold(true).Line(order.BusinessName).Bold(false)
            .Line($"Pedido {order.OrderCode}")
            .Line(order.CreatedAt.ToString("dd/MM/yyyy HH:mm", Argentina))
            .Align(TextAlign.Left).Separator();
        if (!string.IsNullOrWhiteSpace(order.CustomerName))
        {
            ticket.Line(order.CustomerName);
        }

        ticket.Line(order.FulfillmentLabel);
        if (!string.IsNullOrWhiteSpace(order.DeliveryAddress))
        {
            ticket.Line(order.DeliveryAddress);
        }

        ticket.Separator();
        foreach (var line in order.Lines)
        {
            ticket.Row($"{Quantity(line.Quantity)} x {line.Description}", line.LineTotal is { } amount ? Money(amount) : string.Empty);
        }

        ticket.Separator();
        if (order.Total is { } total)
        {
            ticket.Bold(true).Row("TOTAL", Money(total)).Bold(false);
        }

        if (!string.IsNullOrWhiteSpace(order.PaymentLabel))
        {
            ticket.Line(order.PaymentLabel);
        }

        return ticket.Align(TextAlign.Center).Line("No valido como factura").Feed(3).Cut().Build();
    }

    /// <summary>Comprobante fiscal con su CAE y el QR de ARCA.</summary>
    public static byte[] FiscalReceipt(AuthorizedFiscalReceipt receipt, PrintFormat format)
    {
        ArgumentNullException.ThrowIfNull(receipt);
        return new EscPosBuilder(EscPosBuilder.ColumnsFor(format))
            .Align(TextAlign.Center).Bold(true).Line(receipt.IssuerName).Bold(false)
            .Line($"CUIT {receipt.IssuerCuit}")
            .Line($"{receipt.VoucherLabel} {receipt.PointOfSale:00000}-{receipt.VoucherNumber:00000000}")
            .Line($"Fecha {receipt.IssueDate.ToString("dd/MM/yyyy", Argentina)}")
            .Separator()
            .Bold(true).Row("TOTAL", Money(receipt.Total)).Bold(false)
            .Separator()
            .Line($"CAE {receipt.Cae}")
            .Line($"Vto. CAE {receipt.CaeExpiration.ToString("dd/MM/yyyy", Argentina)}")
            .QrCode(receipt.QrUrl)
            .Feed(3).Cut().Build();
    }

    /// <summary>Página de prueba: dice qué impresora y qué ancho, para verificar a ojo.</summary>
    public static byte[] TestPage(string printerName, PrintFormat format, DateTimeOffset now)
    {
        var columns = EscPosBuilder.ColumnsFor(format);
        return new EscPosBuilder(columns)
            .Align(TextAlign.Center).Bold(true).Line("La Taba - prueba de impresion").Bold(false)
            .Line(printerName)
            .Line($"{columns} columnas - {now.ToString("dd/MM/yyyy HH:mm", Argentina)}")
            .Separator('=')
            .Line("Si ves esta hoja cortada, la impresora esta lista.")
            .Feed(3).Cut().Build();
    }

    private static string Quantity(decimal quantity) =>
        quantity == decimal.Truncate(quantity)
            ? decimal.Truncate(quantity).ToString(CultureInfo.InvariantCulture)
            : quantity.ToString("0.###", Argentina);

    private static string Money(decimal amount) => "$ " + amount.ToString("#,##0.00", Argentina);
}
