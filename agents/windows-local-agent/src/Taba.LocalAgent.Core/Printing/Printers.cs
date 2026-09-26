using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Printing.EscPos;

namespace Taba.LocalAgent.Core.Printing;

/// <summary>Cómo se le habla a una impresora de Windows.</summary>
public enum PrinterDriverKind
{
    /// <summary>Bytes ESC/POS crudos (tipo RAW) a una térmica.</summary>
    EscPos,

    /// <summary>Dibujado con el driver de Windows: cualquier impresora, incluida una térmica sin modo RAW.</summary>
    Windows,

    /// <summary>PDF tal cual, para impresoras que aceptan PDF directo.</summary>
    Pdf,
}

/// <summary>Tabla de caracteres ESC/POS. ASCII translitera («Neuquén» → «Neuquen») y funciona en cualquier térmica.</summary>
public enum EscPosCodePage
{
    Ascii,
    Pc850,
    Pc858,
    Wpc1252,
}

/// <summary>Cómo se imprime en una impresora concreta. No lleva nada del negocio.</summary>
public sealed record PrinterProfile(
    string PrinterName,
    PrinterDriverKind Driver = PrinterDriverKind.EscPos,
    int PaperWidthMm = 80,
    int? Columns = null,
    EscPosCodePage CodePage = EscPosCodePage.Ascii,
    int Copies = 1)
{
    /// <summary>Columnas en la fuente A: 32 en 58 mm, 48 en 80 mm, salvo que la impresora pida otra cosa.</summary>
    public int EffectiveColumns => Columns ?? (PaperWidthMm <= 58 ? 32 : 48);

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(PrinterName) || PrinterName.Length > 256)
        {
            throw new ArgumentException("PRINTER_NAME_INVALID", nameof(PrinterName));
        }

        if (PaperWidthMm is not (58 or 80) && Driver == PrinterDriverKind.EscPos)
        {
            throw new ArgumentException("PAPER_WIDTH_UNSUPPORTED", nameof(PaperWidthMm));
        }

        if (EffectiveColumns is < 24 or > 64)
        {
            throw new ArgumentException("COLUMNS_OUT_OF_RANGE", nameof(Columns));
        }

        if (Copies is < 1 or > 3)
        {
            throw new ArgumentException("COPIES_OUT_OF_RANGE", nameof(Copies));
        }
    }
}

/// <summary>Resultado que informa una impresora.</summary>
public enum PrintOutcomeStatus
{
    /// <summary>El trabajo completo salió del spooler (o la impresora lo confirmó).</summary>
    Sent,

    /// <summary>No se envió nada: se puede reintentar sin riesgo de ticket doble.</summary>
    NotSent,

    /// <summary>Se cortó a mitad de camino: puede haber salido papel. Decide una persona.</summary>
    Unknown,
}

public sealed record PrintOutcome(PrintOutcomeStatus Status, string? ErrorCode = null)
{
    public static PrintOutcome Sent() => new(PrintOutcomeStatus.Sent);

    public static PrintOutcome NotSent(string errorCode) => new(PrintOutcomeStatus.NotSent, errorCode);

    public static PrintOutcome Unknown(string errorCode) => new(PrintOutcomeStatus.Unknown, errorCode);
}

/// <summary>Qué se manda a imprimir.</summary>
public abstract record PrintContent;

/// <summary>Un ticket en el modelo neutral.</summary>
public sealed record TicketContent(TicketDocument Document) : PrintContent;

/// <summary>Un PDF ya generado (por ejemplo, un comprobante A4).</summary>
public sealed record PdfContent(ReadOnlyMemory<byte> Bytes) : PrintContent;

/// <summary>
/// Una forma de imprimir. La cola no sabe de modelos ni de marcas: le da el
/// contenido y el perfil, y recibe un resultado honesto.
/// </summary>
public interface IPrinter
{
    PrinterDriverKind Kind { get; }

    Task<PrintOutcome> PrintAsync(PrintContent content, PrinterProfile profile, string jobLabel, CancellationToken cancellationToken);
}

/// <summary>El camino al dispositivo: spooler de Windows en producción, un doble en las pruebas.</summary>
public interface IRawPrinterTransport
{
    Task<PrintOutcome> SendRawAsync(string printerName, ReadOnlyMemory<byte> payload, string documentTitle, CancellationToken cancellationToken);
}

public enum PrinterState
{
    Ready,
    Offline,
    Error,
    Paused,
    NotFound,
    Unknown,
}

public sealed record PrinterDescriptor(string Name, bool IsDefault, PrinterState State = PrinterState.Unknown);

/// <summary>Impresoras visibles para el sistema, con su estado.</summary>
public interface IPrinterCatalog
{
    IReadOnlyList<PrinterDescriptor> ListPrinters();

    PrinterState GetState(string printerName);
}

/// <summary>Térmica por ESC/POS: codifica el documento y manda bytes crudos.</summary>
public sealed class EscPosPrinter(IRawPrinterTransport transport) : IPrinter
{
    public PrinterDriverKind Kind => PrinterDriverKind.EscPos;

    public async Task<PrintOutcome> PrintAsync(PrintContent content, PrinterProfile profile, string jobLabel, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);
        if (content is not TicketContent ticket)
        {
            return PrintOutcome.NotSent("CONTENT_NOT_SUPPORTED");
        }

        var bytes = EscPosEncoder.Encode(ticket.Document, profile);
        return await Copies.SendAsync(profile.Copies, () => transport.SendRawAsync(profile.PrinterName, bytes, jobLabel, cancellationToken)).ConfigureAwait(false);
    }
}

/// <summary>
/// PDF tal cual, para impresoras que aceptan PDF directo. Para el resto hay que
/// renderizar páginas antes del spooler (no se finge acá): los comprobantes del
/// mostrador salen como ticket térmico o por el driver de Windows.
/// </summary>
public sealed class PdfPrinter(IRawPrinterTransport transport) : IPrinter
{
    private static readonly byte[] PdfMagic = "%PDF-"u8.ToArray();

    public PrinterDriverKind Kind => PrinterDriverKind.Pdf;

    public async Task<PrintOutcome> PrintAsync(PrintContent content, PrinterProfile profile, string jobLabel, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);
        if (content is not PdfContent pdf)
        {
            return PrintOutcome.NotSent("CONTENT_NOT_SUPPORTED");
        }

        if (pdf.Bytes.Length < PdfMagic.Length || !pdf.Bytes.Span[..PdfMagic.Length].SequenceEqual(PdfMagic))
        {
            return PrintOutcome.NotSent("PDF_INVALID");
        }

        return await Copies.SendAsync(profile.Copies, () => transport.SendRawAsync(profile.PrinterName, pdf.Bytes, jobLabel, cancellationToken)).ConfigureAwait(false);
    }
}

/// <summary>Elige la forma de imprimir según el perfil. Una impresora que Windows no conoce no se toca.</summary>
public sealed class PrinterRouter(IEnumerable<IPrinter> printers, IPrinterCatalog catalog)
{
    private readonly Dictionary<PrinterDriverKind, IPrinter> _printers = printers.ToDictionary(p => p.Kind);

    public async Task<PrintOutcome> PrintAsync(PrintContent content, PrinterProfile profile, string jobLabel, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);
        if (!_printers.TryGetValue(profile.Driver, out var printer))
        {
            return PrintOutcome.NotSent("DRIVER_NOT_AVAILABLE");
        }

        var state = catalog.GetState(profile.PrinterName);
        return state switch
        {
            PrinterState.NotFound => PrintOutcome.NotSent("PRINTER_NOT_FOUND"),
            PrinterState.Offline => PrintOutcome.NotSent("PRINTER_OFFLINE"),
            PrinterState.Paused => PrintOutcome.NotSent("PRINTER_PAUSED"),
            PrinterState.Error => PrintOutcome.NotSent("PRINTER_ERROR"),
            _ => await printer.PrintAsync(content, profile, jobLabel, cancellationToken).ConfigureAwait(false),
        };
    }
}

internal static class Copies
{
    /// <summary>Varias copias: si falla una después de la primera, ya salió papel y el resultado es desconocido.</summary>
    public static async Task<PrintOutcome> SendAsync(int copies, Func<Task<PrintOutcome>> send)
    {
        var outcome = PrintOutcome.Sent();
        for (var copy = 0; copy < copies && outcome.Status == PrintOutcomeStatus.Sent; copy++)
        {
            outcome = await send().ConfigureAwait(false);
            if (copy > 0 && outcome.Status == PrintOutcomeStatus.NotSent)
            {
                outcome = PrintOutcome.Unknown(outcome.ErrorCode ?? "COPY_INTERRUPTED");
            }
        }

        return outcome;
    }
}
