using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using QRCoder;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Printing;

namespace Taba.LocalAgent.Windows;

/// <summary>
/// «WindowsPrinter»: dibuja el ticket con el driver de Windows. Sirve para
/// cualquier impresora (láser, chorro de tinta, «Microsoft Print to PDF») y para
/// térmicas cuyo driver no acepta RAW. El camino recomendado para una térmica
/// sigue siendo ESC/POS: GDI+ desde un servicio de Windows tiene soporte
/// limitado de Microsoft.
/// </summary>
public sealed class GdiTicketPrinter(TimeSpan? completionTimeout = null) : IPrinter
{
    private readonly TimeSpan _timeout = completionTimeout ?? TimeSpan.FromSeconds(30);

    public PrinterDriverKind Kind => PrinterDriverKind.Windows;

    /// <summary>Sólo para validación: imprime a un archivo en vez de a la impresora.</summary>
    public string? OutputFile { get; init; }

    public Task<PrintOutcome> PrintAsync(PrintContent content, PrinterProfile profile, string jobLabel, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);
        if (content is not TicketContent ticket)
        {
            return Task.FromResult(PrintOutcome.NotSent("CONTENT_NOT_SUPPORTED"));
        }

        return Task.Run(() => Print(ticket.Document, profile, jobLabel), cancellationToken);
    }

    private PrintOutcome Print(TicketDocument document, PrinterProfile profile, string jobLabel)
    {
        using var printDocument = new PrintDocument { DocumentName = jobLabel, PrintController = new StandardPrintController() };
        printDocument.PrinterSettings.PrinterName = profile.PrinterName;
        if (!printDocument.PrinterSettings.IsValid)
        {
            return PrintOutcome.NotSent("PRINTER_NOT_FOUND");
        }

        if (OutputFile is not null)
        {
            printDocument.PrinterSettings.PrintToFile = true;
            printDocument.PrinterSettings.PrintFileName = OutputFile;
        }

        using var renderer = new GdiTicketRenderer(document, profile);
        printDocument.PrintPage += renderer.PrintPage;
        for (var copy = 0; copy < profile.Copies; copy++)
        {
            renderer.Reset();
            try
            {
                printDocument.Print();
            }
            catch (InvalidPrinterException)
            {
                return copy == 0 ? PrintOutcome.NotSent("PRINTER_NOT_FOUND") : PrintOutcome.Unknown("COPY_INTERRUPTED");
            }
            catch (Win32Exception)
            {
                return copy == 0 ? PrintOutcome.NotSent("PRINTER_START_FAILED") : PrintOutcome.Unknown("COPY_INTERRUPTED");
            }

            if (OutputFile is null)
            {
                var outcome = Follow(profile.PrinterName, jobLabel);
                if (outcome.Status != PrintOutcomeStatus.Sent)
                {
                    return outcome;
                }
            }
        }

        return PrintOutcome.Sent();
    }

    private PrintOutcome Follow(string printerName, string documentName)
    {
        if (!NativeMethods.OpenPrinterW(printerName, out var handle, IntPtr.Zero))
        {
            return PrintOutcome.Sent();
        }

        try
        {
            var jobId = SpoolerJobs.FindJobId(handle, documentName);
            return jobId is null ? PrintOutcome.Sent() : SpoolerJobs.WaitForCompletion(handle, jobId.Value, _timeout);
        }
        finally
        {
            NativeMethods.ClosePrinter(handle);
        }
    }
}

/// <summary>Dibuja el documento neutral en milímetros, con una fuente monoespaciada del ancho del papel.</summary>
internal sealed class GdiTicketRenderer : IDisposable
{
    private readonly TicketDocument _document;
    private readonly PrinterProfile _profile;
    private readonly Font _regular;
    private readonly Font _bold;
    private readonly Font _large;
    private readonly float _contentWidthMm;
    private int _next;

    public GdiTicketRenderer(TicketDocument document, PrinterProfile profile)
    {
        _document = document;
        _profile = profile;
        // Ancho útil: el papel menos unos márgenes; en hojas grandes, una columna de ticket de 76 mm.
        _contentWidthMm = profile.PaperWidthMm > 100 ? 76f : profile.PaperWidthMm - 6f;
        var size = FontSizeFor(profile.EffectiveColumns, _contentWidthMm);
        _regular = new Font("Consolas", size, FontStyle.Regular, GraphicsUnit.Point);
        _bold = new Font("Consolas", size, FontStyle.Bold, GraphicsUnit.Point);
        _large = new Font("Consolas", size * 2f, FontStyle.Bold, GraphicsUnit.Point);
    }

    public void Reset() => _next = 0;

    public void PrintPage(object? sender, PrintPageEventArgs e)
    {
        ArgumentNullException.ThrowIfNull(e);
        var graphics = e.Graphics!;
        graphics.PageUnit = GraphicsUnit.Millimeter;
        graphics.SmoothingMode = SmoothingMode.None;
        var left = e.PageSettings.PaperSize.Width > 400 ? e.MarginBounds.Left * 0.254f : 2f;
        var top = 2f;
        var bottom = Math.Max(20f, (e.PageSettings.PaperSize.Height * 0.254f) - 4f);
        var y = top;
        var line = _regular.GetHeight(graphics);
        while (_next < _document.Elements.Count)
        {
            var element = _document.Elements[_next];
            var height = Measure(graphics, element, line);
            if (y + height > bottom && y > top)
            {
                e.HasMorePages = true;
                return;
            }

            Draw(graphics, element, left, y, line);
            y += height;
            _next++;
        }

        e.HasMorePages = false;
    }

    public void Dispose()
    {
        _regular.Dispose();
        _bold.Dispose();
        _large.Dispose();
    }

    private float Measure(Graphics graphics, TicketElement element, float line) => element switch
    {
        TextLine text => TextWrap.Wrap(text.Text, text.Large ? _profile.EffectiveColumns / 2 : _profile.EffectiveColumns).Count
            * (text.Large ? _large.GetHeight(graphics) : line),
        SplitLine split => SplitLines(split).Count * line,
        SeparatorLine => line,
        QrElement => QrSizeMm() + line,
        FeedLines feed => feed.Lines * line,
        _ => 0,
    };

    private void Draw(Graphics graphics, TicketElement element, float left, float y, float line)
    {
        switch (element)
        {
            case TextLine text:
            {
                var font = text.Large ? _large : text.Bold ? _bold : _regular;
                var height = font.GetHeight(graphics);
                using var format = Typographic(text.Align switch
                {
                    TicketAlign.Center => StringAlignment.Center,
                    TicketAlign.Right => StringAlignment.Far,
                    _ => StringAlignment.Near,
                });
                foreach (var piece in TextWrap.Wrap(text.Text, text.Large ? _profile.EffectiveColumns / 2 : _profile.EffectiveColumns))
                {
                    graphics.DrawString(piece, font, Brushes.Black, new RectangleF(left, y, _contentWidthMm, height), format);
                    y += height;
                }

                break;
            }

            case SplitLine split:
            {
                var font = split.Bold ? _bold : _regular;
                using var right = Typographic(StringAlignment.Far);
                using var near = Typographic(StringAlignment.Near);
                var lines = SplitLines(split);
                for (var i = 0; i < lines.Count; i++)
                {
                    graphics.DrawString(lines[i], font, Brushes.Black, new RectangleF(left, y, _contentWidthMm, line), near);
                    if (i == lines.Count - 1)
                    {
                        graphics.DrawString(split.Right, font, Brushes.Black, new RectangleF(left, y, _contentWidthMm, line), right);
                    }

                    y += line;
                }

                break;
            }

            case SeparatorLine:
            {
                using var pen = new Pen(Color.Black, 0.2f) { DashStyle = DashStyle.Dash };
                graphics.DrawLine(pen, left, y + (line / 2), left + _contentWidthMm, y + (line / 2));
                break;
            }

            case QrElement qr:
            {
                using var data = QRCodeGenerator.GenerateQrCode(qr.Data, QRCodeGenerator.ECCLevel.M);
                var png = new PngByteQRCode(data).GetGraphic(10);
                using var stream = new MemoryStream(png);
                using var image = Image.FromStream(stream);
                var size = QrSizeMm();
                graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
                graphics.DrawImage(image, left + ((_contentWidthMm - size) / 2), y, size, size);
                break;
            }
        }
    }

    private List<string> SplitLines(SplitLine split)
    {
        var width = Math.Max(8, _profile.EffectiveColumns - split.Right.Length - 1);
        return TextWrap.Wrap(split.Left, width).ToList();
    }

    private float QrSizeMm() => Math.Min(40f, _contentWidthMm * 0.6f);

    // Consolas: cada carácter mide 0,55 em; con un 5 % de aire entran las columnas completas.
    private static float FontSizeFor(int columns, float widthMm) =>
        Math.Clamp(widthMm / 25.4f * 72f / (columns * 0.58f), 5f, 12f);

    // Sin el relleno que GDI+ agrega a cada renglón: si no, la última columna se corta.
    private static StringFormat Typographic(StringAlignment alignment)
    {
        var format = (StringFormat)StringFormat.GenericTypographic.Clone();
        format.Alignment = alignment;
        format.FormatFlags |= StringFormatFlags.NoWrap | StringFormatFlags.MeasureTrailingSpaces;
        return format;
    }
}
