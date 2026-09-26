using System.Globalization;
using System.Text.Json;

namespace Taba.LocalAgent.Core.Documents;

/// <summary>Los tres documentos que el backend encola (print_jobs.document_type).</summary>
public enum DocumentType
{
    OrderTicket,
    KitchenTicket,
    FiscalReceipt,
}

public static class DocumentTypes
{
    public static string ToWire(this DocumentType type) => type switch
    {
        DocumentType.OrderTicket => "order_ticket",
        DocumentType.KitchenTicket => "kitchen_ticket",
        DocumentType.FiscalReceipt => "fiscal_receipt",
        _ => throw new ArgumentOutOfRangeException(nameof(type)),
    };

    public static bool TryParse(string? value, out DocumentType type)
    {
        switch (value)
        {
            case "order_ticket":
                type = DocumentType.OrderTicket;
                return true;
            case "kitchen_ticket":
                type = DocumentType.KitchenTicket;
                return true;
            case "fiscal_receipt":
                type = DocumentType.FiscalReceipt;
                return true;
            default:
                type = default;
                return false;
        }
    }
}

/// <summary>Un renglón de pedido.</summary>
public sealed record OrderItem(string Name, decimal Quantity, string? Unit, decimal? UnitPrice, decimal? Subtotal);

/// <summary>Pedido para comanda o ticket (payload v1). No trae datos personales del cliente.</summary>
public sealed record OrderPayload(
    string BusinessName,
    string Code,
    DateTimeOffset CreatedAt,
    string Fulfillment,
    string? Notes,
    IReadOnlyList<OrderItem> Items,
    decimal? Subtotal,
    decimal? DeliveryFee,
    decimal? Discount,
    decimal? Total,
    string Currency,
    string? PaymentLabel,
    string? RiderName,
    bool Reprint);

public sealed record FiscalItem(string Description, decimal Quantity, decimal UnitPrice);

/// <summary>Comprobante AUTORIZADO (payload v1). Sin CAE válido no se construye.</summary>
public sealed record FiscalPayload(
    string Environment,
    string IssuerName,
    string IssuerCuit,
    string? IssuerTaxCondition,
    string? IssuerAddress,
    string? IssuerGrossIncome,
    string? ReceiverCondition,
    int? ReceiverDocumentType,
    string? ReceiverDocumentNumber,
    int VoucherTypeCode,
    string VoucherLabel,
    int PointOfSale,
    long VoucherNumber,
    DateOnly IssueDate,
    string? AssociatedVoucher,
    IReadOnlyList<FiscalItem> Items,
    decimal Total,
    string Currency,
    decimal CurrencyRate,
    string Cae,
    DateOnly CaeExpiration,
    string QrUrl,
    bool Reprint);

/// <summary>El trabajo no se puede imprimir tal como vino. Nunca se imprime a medias.</summary>
public sealed class MalformedPayloadException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

/// <summary>
/// Lee el payload v1 de print_jobs. Estricto: tipos, largos y rangos. Un campo
/// que falta o viene raro rechaza el trabajo entero con MALFORMED_PAYLOAD.
/// </summary>
public static class PrintPayloadParser
{
    public const int SupportedVersion = 1;
    private const string QrPrefix = "https://www.arca.gob.ar/fe/qr/?p=";

    public static OrderPayload ParseOrder(JsonElement payload)
    {
        Require(payload.ValueKind == JsonValueKind.Object);
        var business = Object(payload, "business");
        var order = Object(payload, "order");
        var items = new List<OrderItem>();
        var array = Array(order, "items");
        Require(array.GetArrayLength() is > 0 and <= 200);
        foreach (var item in array.EnumerateArray())
        {
            Require(item.ValueKind == JsonValueKind.Object);
            var quantity = Decimal(item, "quantity") ?? throw Malformed();
            Require(quantity > 0 && quantity <= 100_000);
            items.Add(new OrderItem(
                Text(item, "name", 120) ?? throw Malformed(),
                quantity,
                Text(item, "unit", 20),
                Decimal(item, "unit_price"),
                Decimal(item, "subtotal")));
        }

        var payment = OptionalObject(order, "payment");
        var rider = OptionalObject(order, "rider");
        return new OrderPayload(
            Text(business, "name", 80) ?? throw Malformed(),
            Text(order, "code", 40) ?? throw Malformed(),
            Timestamp(order, "created_at"),
            Text(order, "fulfillment", 20) ?? "pickup",
            Text(order, "notes", 300),
            items,
            Decimal(order, "subtotal"),
            Decimal(order, "delivery_fee"),
            Decimal(order, "discount"),
            Decimal(order, "total"),
            Text(order, "currency", 3) ?? "ARS",
            payment is { } p ? Text(p, "label", 60) : null,
            rider is { } r ? Text(r, "name", 40) : null,
            Bool(payload, "reprint"));
    }

    public static FiscalPayload ParseFiscal(JsonElement payload)
    {
        Require(payload.ValueKind == JsonValueKind.Object);
        var issuer = Object(payload, "issuer");
        var receiver = OptionalObject(payload, "receiver");
        var voucher = Object(payload, "voucher");
        var totals = Object(payload, "totals");
        var cae = Text(payload, "cae", 14) ?? throw Malformed("FISCAL_WITHOUT_CAE");
        if (cae.Length != 14 || !cae.All(char.IsAsciiDigit))
        {
            throw Malformed("FISCAL_WITHOUT_CAE");
        }

        var qr = Text(payload, "qr_url", 2000) ?? throw Malformed("FISCAL_WITHOUT_QR");
        if (!qr.StartsWith(QrPrefix, StringComparison.Ordinal) || qr.Length <= QrPrefix.Length)
        {
            throw Malformed("FISCAL_QR_INVALID");
        }

        var cuit = Text(issuer, "cuit", 11) ?? throw Malformed();
        Require(cuit.Length == 11 && cuit.All(char.IsAsciiDigit));
        var items = new List<FiscalItem>();
        foreach (var item in Array(payload, "items").EnumerateArray())
        {
            Require(item.ValueKind == JsonValueKind.Object);
            items.Add(new FiscalItem(
                Text(item, "description", 120) ?? throw Malformed(),
                Decimal(item, "quantity") ?? throw Malformed(),
                Decimal(item, "unit_price") ?? throw Malformed()));
        }

        string? associated = null;
        if (voucher.TryGetProperty("associated", out var assoc) && assoc.ValueKind == JsonValueKind.Object)
        {
            var type = Integer(assoc, "document_type");
            var pos = Integer(assoc, "point_of_sale");
            var number = Long(assoc, "document_number");
            if (type is { } t && pos is { } p && number is { } n)
            {
                associated = string.Create(CultureInfo.InvariantCulture, $"{t}:{p:00000}-{n:00000000}");
            }
        }

        var environment = Text(payload, "environment", 20) ?? throw Malformed();
        Require(environment is "homologation" or "production");
        return new FiscalPayload(
            environment,
            Text(issuer, "legal_name", 120) ?? throw Malformed(),
            cuit,
            Text(issuer, "tax_condition", 80),
            Text(issuer, "address", 160),
            Text(issuer, "gross_income_number", 40),
            receiver is { } r ? Text(r, "condition", 80) : null,
            receiver is { } r2 ? Integer(r2, "document_type") : null,
            receiver is { } r3 ? Text(r3, "document_number", 20) : null,
            Integer(voucher, "type_code") ?? throw Malformed(),
            Text(voucher, "label", 60) ?? throw Malformed(),
            Integer(voucher, "point_of_sale") ?? throw Malformed(),
            Long(voucher, "number") ?? throw Malformed(),
            Date(voucher, "issue_date"),
            associated,
            items,
            Decimal(totals, "total") ?? throw Malformed(),
            Text(totals, "currency", 3) ?? "PES",
            Decimal(totals, "currency_rate") ?? 1m,
            cae,
            Date(payload, "cae_expiration"),
            qr,
            Bool(payload, "reprint"));
    }

    private static MalformedPayloadException Malformed(string code = "MALFORMED_PAYLOAD") => new(code);

    private static void Require(bool condition)
    {
        if (!condition)
        {
            throw Malformed();
        }
    }

    private static JsonElement Object(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object ? value : throw Malformed();

    private static JsonElement? OptionalObject(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object ? value : null;

    private static JsonElement Array(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array ? value : throw Malformed();

    private static string? Text(JsonElement parent, string name, int maxLength)
    {
        if (!parent.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        Require(value.ValueKind == JsonValueKind.String);
        var text = value.GetString()!.Trim();
        Require(text.Length <= maxLength);
        // Sin caracteres de control: nada que una impresora pueda interpretar como comando.
        Require(!text.Any(char.IsControl));
        return text.Length == 0 ? null : text;
    }

    private static decimal? Decimal(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        Require(value.ValueKind == JsonValueKind.Number);
        Require(value.TryGetDecimal(out var number) && number is >= -1_000_000_000m and <= 1_000_000_000m);
        return number;
    }

    private static int? Integer(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        Require(value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) && number >= 0);
        return value.GetInt32();
    }

    private static long? Long(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        Require(value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number) && number > 0);
        return value.GetInt64();
    }

    private static bool Bool(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static DateTimeOffset Timestamp(JsonElement parent, string name)
    {
        var text = Text(parent, name, 40) ?? throw Malformed();
        return DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var value)
            ? value
            : throw Malformed();
    }

    private static DateOnly Date(JsonElement parent, string name)
    {
        var text = Text(parent, name, 10) ?? throw Malformed();
        return DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var value)
            ? value
            : throw Malformed();
    }
}
