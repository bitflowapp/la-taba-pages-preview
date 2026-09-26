using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Core.Backend;

/// <summary>
/// Cliente de la Edge Function print-agent-gateway. Una sola URL, POST con JSON
/// y la credencial del dispositivo en Authorization. La clave pública
/// (publishable) viaja en «apikey» como en la web; ningún secreto de Supabase
/// vive en la PC del local.
/// </summary>
public sealed class GatewayBackendClient : IBackendClient
{
    private readonly HttpClient _http;
    private readonly Uri _gateway;
    private readonly string? _publishableKey;

    public GatewayBackendClient(HttpClient http, Uri gateway, string? publishableKey)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(gateway);
        if (gateway.Scheme != Uri.UriSchemeHttps && !gateway.IsLoopback)
        {
            throw new ArgumentException("GATEWAY_MUST_BE_HTTPS", nameof(gateway));
        }

        _http = http;
        _gateway = gateway;
        _publishableKey = string.IsNullOrWhiteSpace(publishableKey) ? null : publishableKey.Trim();
    }

    public async Task<RegistrationResult> RegisterAsync(string pairingCode, string secretHash, string deviceName, CancellationToken cancellationToken)
    {
        var body = new JsonObject
        {
            ["action"] = "register",
            ["pairing_code"] = pairingCode,
            ["secret_hash"] = secretHash,
            ["device_name"] = deviceName,
            ["platform"] = "windows",
            ["agent_version"] = AgentInfo.Version,
        };
        var result = await PostAsync(body, null, cancellationToken).ConfigureAwait(false);
        return new RegistrationResult(
            Guid.Parse(String(result, "device_id")),
            Guid.Parse(String(result, "business_id")),
            OptionalString(result, "business_name") ?? string.Empty,
            OptionalString(result, "device_name") ?? deviceName);
    }

    public async Task<HeartbeatResult> HeartbeatAsync(DeviceCredential credential, HeartbeatReport report, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(report);
        var printers = new JsonArray();
        foreach (var printer in report.Printers)
        {
            printers.Add(new JsonObject { ["name"] = printer.Name, ["role"] = printer.Role, ["status"] = printer.Status });
        }

        var body = new JsonObject
        {
            ["action"] = "heartbeat",
            ["report"] = new JsonObject
            {
                ["agent_version"] = report.AgentVersion,
                ["queue_depth"] = report.QueueDepth,
                ["printers"] = printers,
            },
        };
        var result = await PostAsync(body, credential, cancellationToken).ConfigureAwait(false);
        return new HeartbeatResult(PollSeconds(result));
    }

    public async Task<ClaimResult> ClaimAsync(DeviceCredential credential, IReadOnlyCollection<DocumentType> types, int limit, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(types);
        var wireTypes = new JsonArray();
        foreach (var type in types)
        {
            wireTypes.Add(type.ToWire());
        }

        var body = new JsonObject { ["action"] = "claim", ["document_types"] = wireTypes, ["limit"] = limit };
        var result = await PostAsync(body, credential, cancellationToken).ConfigureAwait(false);
        var jobs = new List<ClaimedJob>();
        if (result.TryGetProperty("jobs", out var array) && array.ValueKind == JsonValueKind.Array)
        {
            foreach (var job in array.EnumerateArray())
            {
                if (!DocumentTypes.TryParse(OptionalString(job, "document_type"), out var type))
                {
                    throw new BackendException(BackendErrorKind.Invalid, "UNKNOWN_DOCUMENT_TYPE");
                }

                jobs.Add(new ClaimedJob(
                    Guid.Parse(String(job, "id")),
                    type,
                    job.TryGetProperty("payload", out var payload) ? payload.Clone() : default,
                    job.TryGetProperty("payload_version", out var version) && version.TryGetInt32(out var v) ? v : 0,
                    Guid.Parse(String(job, "claim_token")),
                    job.TryGetProperty("attempt", out var attempt) && attempt.TryGetInt32(out var a) ? a : 1,
                    OptionalString(job, "reprint_of") is { } reprint ? Guid.Parse(reprint) : null));
            }
        }

        return new ClaimResult(jobs, PollSeconds(result));
    }

    public async Task<JobUpdateResult> UpdateJobAsync(DeviceCredential credential, Guid jobId, Guid claimToken, JobTransition transition,
        string? errorCode, int? durationMs, CancellationToken cancellationToken)
    {
        var body = new JsonObject
        {
            ["action"] = "update",
            ["job_id"] = jobId.ToString("D"),
            ["claim_token"] = claimToken.ToString("D"),
            ["transition"] = transition switch
            {
                JobTransition.Printing => "printing",
                JobTransition.Printed => "printed",
                JobTransition.NotPrinted => "not_printed",
                _ => "unknown",
            },
        };
        if (errorCode is not null)
        {
            body["error_code"] = errorCode;
        }

        if (durationMs is not null)
        {
            body["duration_ms"] = durationMs.Value;
        }

        var result = await PostAsync(body, credential, cancellationToken).ConfigureAwait(false);
        return new JobUpdateResult(OptionalString(result, "status") ?? string.Empty,
            result.TryGetProperty("idempotent_replay", out var replay) && replay.ValueKind == JsonValueKind.True);
    }

    public async Task<Guid> RequestReprintAsync(DeviceCredential credential, Guid jobId, string reason, string? operatorLabel,
        string idempotencyKey, CancellationToken cancellationToken)
    {
        var body = new JsonObject
        {
            ["action"] = "reprint",
            ["job_id"] = jobId.ToString("D"),
            ["reason"] = reason,
            ["operator_label"] = operatorLabel,
            ["idempotency_key"] = idempotencyKey,
        };
        var result = await PostAsync(body, credential, cancellationToken).ConfigureAwait(false);
        return Guid.Parse(String(result, "print_job_id"));
    }

    public async Task RotateSecretAsync(DeviceCredential credential, string newSecretHash, CancellationToken cancellationToken)
    {
        var body = new JsonObject { ["action"] = "rotate", ["new_secret_hash"] = newSecretHash };
        await PostAsync(body, credential, cancellationToken).ConfigureAwait(false);
    }

    private async Task<JsonElement> PostAsync(JsonObject body, DeviceCredential? credential, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, _gateway)
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        if (credential is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential.BearerToken);
        }

        if (_publishableKey is not null)
        {
            request.Headers.Add("apikey", _publishableKey);
        }

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (HttpRequestException)
        {
            throw new BackendException(BackendErrorKind.Unavailable, "BACKEND_UNREACHABLE");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new BackendException(BackendErrorKind.Unavailable, "BACKEND_TIMEOUT");
        }

        using (response)
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (response.IsSuccessStatusCode)
            {
                try
                {
                    using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
                    return document.RootElement.Clone();
                }
                catch (JsonException)
                {
                    throw new BackendException(BackendErrorKind.Unavailable, "BACKEND_BAD_RESPONSE");
                }
            }

            var code = ReadErrorCode(text) ?? string.Create(CultureInfo.InvariantCulture, $"HTTP_{(int)response.StatusCode}");
            throw new BackendException(response.StatusCode switch
            {
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => BackendErrorKind.Unauthorized,
                HttpStatusCode.Conflict => BackendErrorKind.Conflict,
                HttpStatusCode.NotFound => BackendErrorKind.NotFound,
                HttpStatusCode.UnprocessableEntity => BackendErrorKind.NotAllowed,
                HttpStatusCode.BadRequest or HttpStatusCode.RequestEntityTooLarge or HttpStatusCode.UnsupportedMediaType => BackendErrorKind.Invalid,
                _ => BackendErrorKind.Unavailable,
            }, code);
        }
    }

    private static string? ReadErrorCode(string text)
    {
        try
        {
            using var document = JsonDocument.Parse(text);
            var code = document.RootElement.TryGetProperty("code", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
            return code is not null && code.Length <= 60 && code.All(c => char.IsAsciiLetterUpper(c) || char.IsAsciiDigit(c) || c == '_') ? code : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static int PollSeconds(JsonElement result) =>
        result.TryGetProperty("poll_seconds", out var value) && value.TryGetInt32(out var seconds) ? Math.Clamp(seconds, 2, 300) : 10;

    private static string String(JsonElement element, string name) =>
        OptionalString(element, name) ?? throw new BackendException(BackendErrorKind.Unavailable, "BACKEND_BAD_RESPONSE");

    private static string? OptionalString(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
