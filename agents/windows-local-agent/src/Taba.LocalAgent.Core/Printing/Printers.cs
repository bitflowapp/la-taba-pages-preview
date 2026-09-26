namespace Taba.LocalAgent.Core.Printing;

/// <summary>
/// Una impresora. La cola no sabe de modelos ni de drivers: sólo manda bytes
/// ya renderizados y recibe un resultado honesto.
/// </summary>
public interface IPrinter
{
    string Name { get; }

    Task<PrintOutcome> SendAsync(ReadOnlyMemory<byte> payload, string documentTitle, CancellationToken cancellationToken);
}

/// <summary>Impresoras visibles para el sistema.</summary>
public interface IPrinterCatalog
{
    IReadOnlyList<PrinterDescriptor> ListPrinters();
}

/// <summary>Resuelve el nombre elegido por el operador a una impresora concreta.</summary>
public interface IPrinterResolver
{
    IPrinter? Resolve(string printerName, PrintFormat format);
}

public sealed record PrinterDescriptor(string Name, bool IsDefault);

/// <summary>
/// Envía bytes ESC/POS crudos a una térmica. El transporte (spooler de Windows,
/// USB, red) lo pone quien la construye: así ningún modelo queda acoplado.
/// </summary>
public sealed class EscPosPrinter(string name, IRawPrinterTransport transport) : IPrinter
{
    public string Name { get; } = name;

    public Task<PrintOutcome> SendAsync(ReadOnlyMemory<byte> payload, string documentTitle, CancellationToken cancellationToken)
        => transport.SendRawAsync(Name, payload, documentTitle, cancellationToken);
}

/// <summary>
/// PDF A4. En el spike, el PDF se entrega tal cual a impresoras que aceptan PDF
/// directo. Para las que no, la versión de producción debe renderizar las
/// páginas (PDFium o Windows.Data.Pdf) antes del spooler: está anotado en el
/// README y no se finge acá.
/// </summary>
public sealed class PdfPrinter(string name, IRawPrinterTransport transport) : IPrinter
{
    private static readonly byte[] PdfMagic = "%PDF-"u8.ToArray();

    public string Name { get; } = name;

    public Task<PrintOutcome> SendAsync(ReadOnlyMemory<byte> payload, string documentTitle, CancellationToken cancellationToken)
    {
        if (payload.Length < PdfMagic.Length || !payload.Span[..PdfMagic.Length].SequenceEqual(PdfMagic))
        {
            return Task.FromResult(PrintOutcome.NotSent("PDF_INVALID"));
        }

        return transport.SendRawAsync(Name, payload, documentTitle, cancellationToken);
    }
}

/// <summary>El camino al dispositivo: spooler de Windows en producción, un doble en las pruebas.</summary>
public interface IRawPrinterTransport
{
    Task<PrintOutcome> SendRawAsync(string printerName, ReadOnlyMemory<byte> payload, string documentTitle, CancellationToken cancellationToken);
}

/// <summary>
/// Resolvedor por formato: térmicas por ESC/POS, A4 por PDF. Es el
/// «WindowsPrinter» del diseño: una impresora de Windows se usa según el
/// formato del trabajo, no según su marca.
/// </summary>
public sealed class FormatPrinterResolver(IPrinterCatalog catalog, IRawPrinterTransport transport) : IPrinterResolver
{
    public IPrinter? Resolve(string printerName, PrintFormat format)
    {
        var known = catalog.ListPrinters().Any(p => string.Equals(p.Name, printerName, StringComparison.Ordinal));
        if (!known)
        {
            return null;
        }

        return format switch
        {
            PrintFormat.PdfA4 => new PdfPrinter(printerName, transport),
            _ => new EscPosPrinter(printerName, transport),
        };
    }
}
