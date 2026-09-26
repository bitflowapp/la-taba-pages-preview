using Taba.LocalAgent.Core.Printing;

namespace Taba.LocalAgent.Tests;

internal sealed class ManualClock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;

    public void Advance(TimeSpan span) => Now += span;
}

/// <summary>Una impresora de mentira que registra lo que recibió y contesta lo que se le pida.</summary>
internal sealed class FakeTransport : IRawPrinterTransport
{
    public List<(string Printer, byte[] Payload)> Sent { get; } = [];

    public Queue<PrintOutcome> Script { get; } = new();

    public Task<PrintOutcome> SendRawAsync(string printerName, ReadOnlyMemory<byte> payload, string documentTitle, CancellationToken cancellationToken)
    {
        var outcome = Script.Count > 0 ? Script.Dequeue() : PrintOutcome.Sent();
        if (outcome.Status == PrintOutcomeStatus.Sent)
        {
            Sent.Add((printerName, payload.ToArray()));
        }

        return Task.FromResult(outcome);
    }
}

internal sealed class FakeCatalog(params string[] names) : IPrinterCatalog
{
    public IReadOnlyList<PrinterDescriptor> ListPrinters() =>
        names.Select((name, index) => new PrinterDescriptor(name, index == 0)).ToList();
}

internal static class TestFiles
{
    /// <summary>Borra la carpeta temporal tolerando que Windows la tenga abierta unos milisegundos.</summary>
    public static async Task DeleteDirectoryAsync(string directory)
    {
        for (var attempt = 0; attempt < 20 && Directory.Exists(directory); attempt++)
        {
            try
            {
                Directory.Delete(directory, recursive: true);
            }
            catch (IOException)
            {
                await Task.Delay(50);
            }
            catch (UnauthorizedAccessException)
            {
                await Task.Delay(50);
            }
        }
    }
}
