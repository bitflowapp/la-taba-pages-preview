using System.Text.Json;
using System.Text.Json.Serialization;
using Taba.LocalAgent.Core.Documents;

namespace Taba.LocalAgent.Core.Agent;

/// <summary>
/// Dónde está cada trabajo en ESTA PC. La fuente de verdad de qué imprimir es el
/// backend; el diario existe para que un corte de luz o un reinicio nunca
/// termine en un ticket doble ni en uno perdido sin aviso.
/// </summary>
public enum JournalState
{
    /// <summary>Reclamado; el backend todavía no confirmó «printing». No salió nada.</summary>
    Claimed,

    /// <summary>El backend confirmó «printing». Todavía no se tocó el spooler.</summary>
    MarkedPrinting,

    /// <summary>Se está entregando al spooler. Si el proceso muere acá, el resultado es desconocido.</summary>
    Sending,

    Sent,
    NotSent,
    Unknown,

    /// <summary>El backend rechazó el reclamo (vencido o ajeno): no se imprime ni se informa.</summary>
    Abandoned,
}

/// <summary>Lo que falta contarle al backend.</summary>
public enum PendingReport
{
    None,
    NotPrinted,
    Printed,
    Unknown,
}

public sealed record JournalEntry
{
    public required Guid JobId { get; init; }

    public required Guid ClaimToken { get; init; }

    public required DocumentType DocumentType { get; init; }

    public string? PrinterName { get; init; }

    public required JournalState State { get; init; }

    public PendingReport PendingReport { get; init; }

    /// <summary>Código saneado. Nunca contiene datos del pedido ni secretos.</summary>
    public string? ErrorCode { get; init; }

    public int? DurationMs { get; init; }

    public int Attempt { get; init; }

    public bool Reprint { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }

    public DateTimeOffset? ReportedAt { get; init; }

    [JsonIgnore]
    public bool IsFinished => PendingReport == PendingReport.None
        && State is JournalState.Sent or JournalState.NotSent or JournalState.Unknown or JournalState.Abandoned;

    /// <summary>¿Pudo haber salido papel para este reclamo?</summary>
    [JsonIgnore]
    public bool MayHavePrinted => State is JournalState.Sending or JournalState.Sent or JournalState.Unknown;
}

public interface IJournalStore
{
    IReadOnlyList<JournalEntry> LoadAll();

    void Save(JournalEntry entry);
}

public sealed class PrintJournal(IJournalStore store, TimeProvider? clock = null)
{
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private readonly object _gate = new();

    public JournalEntry? Find(Guid jobId, Guid claimToken)
    {
        lock (_gate)
        {
            return store.LoadAll().FirstOrDefault(e => e.JobId == jobId && e.ClaimToken == claimToken);
        }
    }

    /// <summary>¿Algún reclamo anterior de este trabajo pudo haber impreso? Entonces no se imprime otra vez.</summary>
    public bool MayHavePrinted(Guid jobId)
    {
        lock (_gate)
        {
            return store.LoadAll().Any(e => e.JobId == jobId && e.MayHavePrinted);
        }
    }

    public JournalEntry Begin(Guid jobId, Guid claimToken, DocumentType type, int attempt, bool reprint)
    {
        lock (_gate)
        {
            var now = _clock.GetUtcNow();
            var entry = new JournalEntry
            {
                JobId = jobId,
                ClaimToken = claimToken,
                DocumentType = type,
                State = JournalState.Claimed,
                Attempt = attempt,
                Reprint = reprint,
                CreatedAt = now,
                UpdatedAt = now,
            };
            store.Save(entry);
            return entry;
        }
    }

    public JournalEntry Update(JournalEntry entry, JournalState state, PendingReport report = PendingReport.None,
        string? errorCode = null, int? durationMs = null, string? printerName = null)
    {
        ArgumentNullException.ThrowIfNull(entry);
        lock (_gate)
        {
            var updated = entry with
            {
                State = state,
                PendingReport = report,
                ErrorCode = errorCode ?? entry.ErrorCode,
                DurationMs = durationMs ?? entry.DurationMs,
                PrinterName = printerName ?? entry.PrinterName,
                UpdatedAt = _clock.GetUtcNow(),
            };
            store.Save(updated);
            return updated;
        }
    }

    public JournalEntry MarkReported(JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        lock (_gate)
        {
            var now = _clock.GetUtcNow();
            var updated = entry with { PendingReport = PendingReport.None, ReportedAt = now, UpdatedAt = now };
            store.Save(updated);
            return updated;
        }
    }

    /// <summary>
    /// Al arrancar, lo que quedó a medias se resuelve sin imprimir nada:
    /// reclamado o confirmado sin tocar el spooler → «no impreso» (vuelve a la
    /// cola del backend); entregándose al spooler → «desconocido» (revisión humana).
    /// </summary>
    public IReadOnlyList<JournalEntry> RecoverAfterRestart()
    {
        lock (_gate)
        {
            var recovered = new List<JournalEntry>();
            foreach (var entry in store.LoadAll())
            {
                var next = entry.State switch
                {
                    JournalState.Claimed or JournalState.MarkedPrinting =>
                        entry with { State = JournalState.NotSent, PendingReport = PendingReport.NotPrinted, ErrorCode = "AGENT_RESTARTED" },
                    JournalState.Sending =>
                        entry with { State = JournalState.Unknown, PendingReport = PendingReport.Unknown, ErrorCode = "AGENT_RESTARTED_DURING_PRINT" },
                    _ => null,
                };
                if (next is not null)
                {
                    next = next with { UpdatedAt = _clock.GetUtcNow() };
                    store.Save(next);
                    recovered.Add(next);
                }
            }

            return recovered;
        }
    }

    public IReadOnlyList<JournalEntry> PendingReports()
    {
        lock (_gate)
        {
            return store.LoadAll().Where(e => e.PendingReport != PendingReport.None).OrderBy(e => e.UpdatedAt).ToList();
        }
    }

    /// <summary>Trabajos en curso o con algo por informar: la «cola» de esta PC.</summary>
    public int Depth()
    {
        lock (_gate)
        {
            return store.LoadAll().Count(e => !e.IsFinished);
        }
    }

    /// <summary>Resultados dudosos de las últimas 24 h: el Panel los muestra para revisión.</summary>
    public int NeedsAttention()
    {
        lock (_gate)
        {
            var since = _clock.GetUtcNow().AddHours(-24);
            return store.LoadAll().Count(e => e.State == JournalState.Unknown && e.UpdatedAt >= since);
        }
    }

    public IReadOnlyList<JournalEntry> List()
    {
        lock (_gate)
        {
            return store.LoadAll();
        }
    }
}

/// <summary>
/// Diario en un archivo JSON con reemplazo atómico: se escribe un temporal y se
/// renombra encima. Un corte de luz deja el archivo anterior o el nuevo, nunca
/// uno a medias. Guarda estados, no el contenido de los tickets.
/// </summary>
public sealed class JsonFileJournalStore : IJournalStore
{
    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = false,
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly string _path;
    private readonly object _gate = new();
    private readonly int _retainFinished;

    public JsonFileJournalStore(string path, int retainFinished = 500)
    {
        _path = Path.GetFullPath(path);
        _retainFinished = retainFinished;
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
    }

    public IReadOnlyList<JournalEntry> LoadAll()
    {
        lock (_gate)
        {
            return Read();
        }
    }

    public void Save(JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        lock (_gate)
        {
            var entries = Read().ToDictionary(e => (e.JobId, e.ClaimToken));
            entries[(entry.JobId, entry.ClaimToken)] = entry;
            var ordered = Trim(entries.Values.OrderBy(e => e.CreatedAt).ToList());
            var temporary = _path + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(ordered, Json));
            ReplaceWithRetry(temporary, _path);
        }
    }

    // En Windows el antivirus o el indexador abren el archivo recién escrito
    // por unos milisegundos y el reemplazo falla con «archivo en uso». Se
    // reintenta antes de dar el error: perder un estado del diario por un
    // escaneo de Defender es exactamente lo que no puede pasar.
    private static void ReplaceWithRetry(string temporary, string destination)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                File.Move(temporary, destination, overwrite: true);
                return;
            }
            catch (IOException) when (attempt < 6)
            {
                Thread.Sleep(15 * attempt);
            }
            catch (UnauthorizedAccessException) when (attempt < 6)
            {
                Thread.Sleep(15 * attempt);
            }
        }
    }

    private List<JournalEntry> Read()
    {
        if (!File.Exists(_path))
        {
            return [];
        }

        var text = File.ReadAllText(_path);
        return string.IsNullOrWhiteSpace(text) ? [] : JsonSerializer.Deserialize<List<JournalEntry>>(text, Json) ?? [];
    }

    // Lo terminado se conserva un tiempo para auditoría local; lo pendiente o
    // dudoso nunca se descarta.
    private List<JournalEntry> Trim(List<JournalEntry> ordered)
    {
        var finished = ordered.Where(e => e.IsFinished).ToList();
        if (finished.Count <= _retainFinished)
        {
            return ordered;
        }

        var drop = finished.Take(finished.Count - _retainFinished).Select(e => (e.JobId, e.ClaimToken)).ToHashSet();
        return ordered.Where(e => !drop.Contains((e.JobId, e.ClaimToken))).ToList();
    }
}

/// <summary>Diario en memoria para pruebas.</summary>
public sealed class InMemoryJournalStore : IJournalStore
{
    private readonly Dictionary<(Guid, Guid), JournalEntry> _entries = [];
    private readonly object _gate = new();

    public IReadOnlyList<JournalEntry> LoadAll()
    {
        lock (_gate)
        {
            return _entries.Values.OrderBy(e => e.CreatedAt).ToList();
        }
    }

    public void Save(JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        lock (_gate)
        {
            _entries[(entry.JobId, entry.ClaimToken)] = entry;
        }
    }
}
