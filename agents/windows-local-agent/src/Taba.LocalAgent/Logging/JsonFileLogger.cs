using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Logging;

/// <summary>
/// Logs estructurados en %ProgramData%\TabaLocalAgent\logs\agent-AAAAMMDD.jsonl:
/// un objeto JSON por renglón con fecha, nivel, evento y los campos del mensaje
/// (trabajo, dispositivo, impresora, acción, duración, resultado, código de
/// error). Todo pasa por <see cref="LogSanitizer"/>: ni credenciales ni claves.
/// Se conservan 14 días.
/// </summary>
public sealed class JsonFileLoggerProvider : ILoggerProvider
{
    private readonly string _directory;
    private readonly object _gate = new();
    private readonly ConcurrentDictionary<string, JsonFileLogger> _loggers = new(StringComparer.Ordinal);
    private readonly TimeProvider _clock;

    public JsonFileLoggerProvider(string directory, TimeProvider? clock = null)
    {
        _directory = directory;
        _clock = clock ?? TimeProvider.System;
        Directory.CreateDirectory(_directory);
        Prune();
    }

    public ILogger CreateLogger(string categoryName) => _loggers.GetOrAdd(categoryName, name => new JsonFileLogger(name, this));

    public void Dispose() => _loggers.Clear();

    internal void Write(string category, LogLevel level, EventId eventId, IReadOnlyList<KeyValuePair<string, object?>>? state, string message, Exception? exception)
    {
        var now = _clock.GetUtcNow();
        using var buffer = new MemoryStream();
        using (var json = new Utf8JsonWriter(buffer))
        {
            json.WriteStartObject();
            json.WriteString("ts", now.ToString("O", CultureInfo.InvariantCulture));
            json.WriteString("level", level.ToString());
            json.WriteString("category", category);
            if (eventId.Id != 0)
            {
                json.WriteNumber("event_id", eventId.Id);
            }

            json.WriteString("message", LogSanitizer.Sanitize(message));
            if (state is not null)
            {
                foreach (var (key, value) in state)
                {
                    if (string.Equals(key, "{OriginalFormat}", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var name = ToSnakeCase(key);
                    switch (value)
                    {
                        case null:
                            json.WriteNull(name);
                            break;
                        case int or long or double or decimal:
                            json.WriteNumber(name, Convert.ToDecimal(value, CultureInfo.InvariantCulture));
                            break;
                        default:
                            json.WriteString(name, LogSanitizer.Sanitize(Convert.ToString(value, CultureInfo.InvariantCulture)));
                            break;
                    }
                }
            }

            if (exception is not null)
            {
                // Sólo el tipo: un mensaje de excepción puede arrastrar datos.
                json.WriteString("exception", exception.GetType().Name);
            }

            json.WriteEndObject();
        }

        buffer.WriteByte((byte)'\n');
        var path = Path.Combine(_directory, $"agent-{now:yyyyMMdd}.jsonl");
        lock (_gate)
        {
            try
            {
                using var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                buffer.WriteTo(stream);
            }
            catch (IOException)
            {
                // Un log que no se pudo escribir no puede frenar la impresión.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    private void Prune()
    {
        var limit = _clock.GetUtcNow().AddDays(-14).UtcDateTime;
        foreach (var file in Directory.EnumerateFiles(_directory, "agent-*.jsonl"))
        {
            try
            {
                if (File.GetLastWriteTimeUtc(file) < limit)
                {
                    File.Delete(file);
                }
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    private static string ToSnakeCase(string name)
    {
        var builder = new StringBuilder(name.Length + 8);
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c))
            {
                if (i > 0)
                {
                    builder.Append('_');
                }

                builder.Append(char.ToLowerInvariant(c));
            }
            else
            {
                builder.Append(c);
            }
        }

        return builder.ToString();
    }

    private sealed class JsonFileLogger(string category, JsonFileLoggerProvider provider) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);
            if (!IsEnabled(logLevel))
            {
                return;
            }

            provider.Write(category, logLevel, eventId, state as IReadOnlyList<KeyValuePair<string, object?>>, formatter(state, exception), exception);
        }
    }
}
