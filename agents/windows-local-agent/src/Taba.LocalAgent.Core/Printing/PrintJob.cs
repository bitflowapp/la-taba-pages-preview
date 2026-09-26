namespace Taba.LocalAgent.Core.Printing;

/// <summary>Qué se imprime. Son documentos distintos y no se mezclan.</summary>
public enum PrintDocumentKind
{
    /// <summary>Comanda de cocina o preparación: ítems y notas, sin precios.</summary>
    KitchenTicket,

    /// <summary>Ticket de pedido o entrega. No es comprobante fiscal.</summary>
    OrderTicket,

    /// <summary>Comprobante fiscal. Sólo existe con CAE autorizado.</summary>
    FiscalReceipt,

    /// <summary>Página de prueba de la impresora.</summary>
    TestPage,
}

/// <summary>Formato físico de salida.</summary>
public enum PrintFormat
{
    /// <summary>Térmica de 58 mm, 32 columnas en la fuente A.</summary>
    EscPos58mm,

    /// <summary>Térmica de 80 mm, 48 columnas en la fuente A.</summary>
    EscPos80mm,

    /// <summary>A4 en PDF.</summary>
    PdfA4,
}

/// <summary>
/// Estados de un trabajo. <see cref="Unknown"/> existe porque un spooler que
/// aceptó los bytes no prueba que haya salido el papel: un reinicio en medio de
/// la impresión deja el trabajo así, y NUNCA se reimprime solo.
/// </summary>
public enum PrintJobState
{
    Queued,
    Printing,
    Printed,
    Failed,
    Unknown,
}

/// <summary>Un trabajo de impresión tal como se persiste en la cola local.</summary>
public sealed record PrintJob
{
    public required string JobId { get; init; }

    /// <summary>
    /// Identidad de negocio del trabajo (por ejemplo «order:LT-2044:kitchen:v3»).
    /// Dos pedidos de impresión con la misma clave son el MISMO trabajo.
    /// </summary>
    public required string IdempotencyKey { get; init; }

    public required PrintDocumentKind Kind { get; init; }

    public required PrintFormat Format { get; init; }

    public required string PrinterName { get; init; }

    /// <summary>Bytes listos para el spooler (ESC/POS o PDF), en Base64.</summary>
    public required string PayloadBase64 { get; init; }

    public required int Copies { get; init; }

    /// <summary>Si es una reimpresión, el trabajo original. Queda auditado.</summary>
    public string? ReprintOf { get; init; }

    /// <summary>Quién lo pidió (operador o «auto»), para la auditoría.</summary>
    public required string RequestedBy { get; init; }

    public required PrintJobState State { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }

    public int Attempts { get; init; }

    /// <summary>Código de error saneado. Nunca contiene datos de la impresora ni secretos.</summary>
    public string? LastErrorCode { get; init; }
}

/// <summary>Pedido de impresión que llega a la cola.</summary>
public sealed record PrintRequest(
    string IdempotencyKey,
    PrintDocumentKind Kind,
    PrintFormat Format,
    string PrinterName,
    ReadOnlyMemory<byte> Payload,
    int Copies,
    string RequestedBy);

/// <summary>Resultado que informa una impresora.</summary>
public enum PrintOutcomeStatus
{
    /// <summary>El spooler aceptó el trabajo completo.</summary>
    Sent,

    /// <summary>No se envió nada (impresora inexistente u offline antes de empezar): se puede reintentar.</summary>
    NotSent,

    /// <summary>Se cortó a mitad de camino: puede haber salido papel. Decide el operador.</summary>
    Unknown,
}

public sealed record PrintOutcome(PrintOutcomeStatus Status, string? ErrorCode = null)
{
    public static PrintOutcome Sent() => new(PrintOutcomeStatus.Sent);

    public static PrintOutcome NotSent(string errorCode) => new(PrintOutcomeStatus.NotSent, errorCode);

    public static PrintOutcome Unknown(string errorCode) => new(PrintOutcomeStatus.Unknown, errorCode);
}
