using System.Text.Json;
using System.Text.Json.Serialization;

namespace Taba.LocalAgent.Core.Printing;

/// <summary>Persistencia de la cola local. La fuente de verdad del negocio sigue siendo el backend.</summary>
public interface IPrintJobStore
{
    IReadOnlyList<PrintJob> LoadAll();

    void Save(PrintJob job);
}

/// <summary>
/// Cola en un archivo JSON con reemplazo atómico: se escribe un temporal y se
/// renombra encima. Un corte de luz deja el archivo anterior o el nuevo, nunca
/// uno a medias. Para el volumen de un mostrador (decenas de trabajos por
/// turno) no hace falta una base de datos.
/// </summary>
public sealed class JsonFilePrintJobStore : IPrintJobStore
{
    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = false,
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly string _path;
    private readonly object _gate = new();
    private readonly int _retainCompleted;

    public JsonFilePrintJobStore(string path, int retainCompleted = 500)
    {
        _path = Path.GetFullPath(path);
        _retainCompleted = retainCompleted;
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
    }

    public IReadOnlyList<PrintJob> LoadAll()
    {
        lock (_gate)
        {
            return Read();
        }
    }

    public void Save(PrintJob job)
    {
        ArgumentNullException.ThrowIfNull(job);
        lock (_gate)
        {
            var jobs = Read().ToDictionary(j => j.JobId, StringComparer.Ordinal);
            jobs[job.JobId] = job;
            var ordered = Trim(jobs.Values.OrderBy(j => j.CreatedAt).ToList());
            var temporary = _path + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(ordered, Json));
            ReplaceWithRetry(temporary, _path);
        }
    }

    // En Windows el antivirus o el indexador abren el archivo recién escrito
    // por unos milisegundos y el reemplazo falla con «archivo en uso». Se
    // reintenta un par de veces antes de dar el error: perder un estado de la
    // cola por un escaneo de Defender es exactamente lo que no puede pasar.
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

    private List<PrintJob> Read()
    {
        if (!File.Exists(_path))
        {
            return [];
        }

        var text = File.ReadAllText(_path);
        return string.IsNullOrWhiteSpace(text) ? [] : JsonSerializer.Deserialize<List<PrintJob>>(text, Json) ?? [];
    }

    // Lo impreso se conserva un tiempo para auditoría y para responder a un
    // reintento con la misma clave; lo pendiente o dudoso nunca se descarta.
    private List<PrintJob> Trim(List<PrintJob> ordered)
    {
        var done = ordered.Where(j => j.State == PrintJobState.Printed).ToList();
        if (done.Count <= _retainCompleted)
        {
            return ordered;
        }

        var drop = done.Take(done.Count - _retainCompleted).Select(j => j.JobId).ToHashSet(StringComparer.Ordinal);
        return ordered.Where(j => !drop.Contains(j.JobId)).ToList();
    }
}

/// <summary>Cola en memoria para pruebas.</summary>
public sealed class InMemoryPrintJobStore : IPrintJobStore
{
    private readonly Dictionary<string, PrintJob> _jobs = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public IReadOnlyList<PrintJob> LoadAll()
    {
        lock (_gate)
        {
            return _jobs.Values.OrderBy(j => j.CreatedAt).ToList();
        }
    }

    public void Save(PrintJob job)
    {
        lock (_gate)
        {
            _jobs[job.JobId] = job;
        }
    }
}
