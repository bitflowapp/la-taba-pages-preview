using System.Text;
using Taba.LocalAgent.Core.Security;
using Taba.LocalAgent.Windows;

namespace Taba.LocalAgent.Tests;

public sealed class SecurityTests
{
    private const string Panel = "https://la-taba-commercial-pilot.pages.dev";
    private const int Port = 17872;
    private static readonly string Token = LocalApiToken.Generate();

    private static LocalApiGate Gate() => new(new OriginPolicy([Panel]), Token, Port);

    [Theory]
    [InlineData("https://la-taba-commercial-pilot.pages.dev", true)]
    [InlineData("https://LA-TABA-commercial-pilot.pages.dev", true)]
    [InlineData("https://la-taba-commercial-pilot.pages.dev:443", true)]
    [InlineData("http://la-taba-commercial-pilot.pages.dev", false)]
    [InlineData("https://la-taba-commercial-pilot.pages.dev.evil.example", false)]
    [InlineData("https://evil.la-taba-commercial-pilot.pages.dev", false)]
    [InlineData("https://la-taba-commercial-pilot.pages.dev:8443", false)]
    [InlineData("https://user@la-taba-commercial-pilot.pages.dev", false)]
    [InlineData("null", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Solo_el_origen_exacto_del_panel_pasa(string? origin, bool allowed)
    {
        Assert.Equal(allowed, new OriginPolicy([Panel]).IsAllowed(origin));
    }

    [Fact]
    public void Un_origen_http_publico_no_se_puede_ni_configurar()
    {
        Assert.Throws<ArgumentException>(() => new OriginPolicy(["http://panel.example"]));
        Assert.True(new OriginPolicy(["http://localhost:8080"]).IsAllowed("http://localhost:8080"));
    }

    [Theory]
    [InlineData("127.0.0.1:17872", true)]
    [InlineData("localhost:17872", true)]
    [InlineData("evil.example:17872", false)]
    [InlineData("127.0.0.1.nip.io:17872", false)]
    [InlineData("127.0.0.1:80", false)]
    [InlineData("", false)]
    public void El_host_frena_el_dns_rebinding(string host, bool allowed)
    {
        var decision = Gate().Evaluate(new LocalApiRequest(host, Panel, Token, IsHealthProbe: false));
        Assert.Equal(allowed ? GateDecision.Allowed : GateDecision.RejectedHost, decision);
    }

    [Fact]
    public void Sin_token_valido_no_se_imprime_aunque_el_origen_sea_el_panel()
    {
        var gate = Gate();
        Assert.Equal(GateDecision.RejectedToken, gate.Evaluate(new LocalApiRequest("127.0.0.1:17872", Panel, null, false)));
        Assert.Equal(GateDecision.RejectedToken, gate.Evaluate(new LocalApiRequest("127.0.0.1:17872", Panel, Token + "x", false)));
        Assert.Equal(GateDecision.RejectedToken, gate.Evaluate(new LocalApiRequest("127.0.0.1:17872", null, "otro", false)));
        Assert.Equal(GateDecision.Allowed, gate.Evaluate(new LocalApiRequest("127.0.0.1:17872", null, Token, false)));
    }

    [Fact]
    public void Salud_no_pide_token_pero_si_host_y_origen_validos()
    {
        var gate = Gate();
        Assert.Equal(GateDecision.Allowed, gate.Evaluate(new LocalApiRequest("localhost:17872", Panel, null, true)));
        Assert.Equal(GateDecision.RejectedOrigin, gate.Evaluate(new LocalApiRequest("localhost:17872", "https://evil.example", null, true)));
        Assert.Equal(GateDecision.RejectedHost, gate.Evaluate(new LocalApiRequest("evil.example:17872", Panel, null, true)));
    }

    [Fact]
    public void El_token_de_instalacion_es_largo_y_distinto_cada_vez()
    {
        var a = LocalApiToken.Generate();
        var b = LocalApiToken.Generate();
        Assert.NotEqual(a, b);
        Assert.True(a.Length >= 43);
        Assert.DoesNotContain('+', a);
        Assert.DoesNotContain('/', a);
        Assert.False(LocalApiToken.Verify("", a));
        Assert.True(LocalApiToken.Verify(a, a));
    }

    [Fact]
    public void Los_logs_nunca_llevan_credenciales_ni_claves()
    {
        // Se arma en tiempo de ejecución: un bloque PEM literal en el repo lo
        // frena (con razón) el escáner de secretos, aunque sea de mentira.
        var marker = string.Concat("PRIVATE", " KEY");
        var pem = $"-----BEGIN {marker}-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END {marker}-----";
        var raw = $"<ar:Token>PD94bWwgdm</ar:Token><ar:Sign>c2lnbmF0dXJl</ar:Sign> {pem} Authorization: Bearer abc.def X-Taba-Agent-Token: {Token} {{\"token\":\"secreto\",\"cae\":\"74123456789012\"}}";

        var safe = LogSanitizer.Sanitize(raw);

        Assert.DoesNotContain("PD94bWwgdm", safe, StringComparison.Ordinal);
        Assert.DoesNotContain("c2lnbmF0dXJl", safe, StringComparison.Ordinal);
        Assert.DoesNotContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", safe, StringComparison.Ordinal);
        Assert.DoesNotContain("abc.def", safe, StringComparison.Ordinal);
        Assert.DoesNotContain(Token, safe, StringComparison.Ordinal);
        Assert.DoesNotContain("secreto", safe, StringComparison.Ordinal);
        // Lo que no es secreto sigue legible para soporte.
        Assert.Contains("74123456789012", safe, StringComparison.Ordinal);
    }

    [Fact]
    public void La_credencial_del_dispositivo_nunca_sale_en_logs()
    {
        var credential = new DeviceCredential(Guid.NewGuid(), DeviceCredential.NewSecret());
        var raw = $"POST gateway Authorization: Bearer {credential.BearerToken} body {{\"secret_hash\":\"{credential.SecretHash}\",\"pairing_code\":\"ABCDE-12345\"}} token suelto {credential.BearerToken}";
        var safe = LogSanitizer.Sanitize(raw);
        Assert.DoesNotContain(credential.Secret, safe, StringComparison.Ordinal);
        Assert.DoesNotContain(credential.SecretHash, safe, StringComparison.Ordinal);
        Assert.DoesNotContain("ABCDE-12345", safe, StringComparison.Ordinal);
        // El id del dispositivo no es secreto: sirve para soporte.
        Assert.Contains(credential.DeviceId.ToString("D"), safe, StringComparison.Ordinal);
    }

    [Fact]
    public void La_credencial_no_se_muestra_ni_en_el_depurador()
    {
        var credential = new DeviceCredential(Guid.NewGuid(), DeviceCredential.NewSecret());
        var stored = new StoredCredential(credential, credential, Guid.NewGuid(), "A", "Mostrador", DateTimeOffset.UtcNow);
        Assert.DoesNotContain(credential.Secret, credential.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain(credential.Secret, stored.ToString(), StringComparison.Ordinal);
        Assert.StartsWith($"tla1.{credential.DeviceId:D}.", credential.BearerToken, StringComparison.Ordinal);
        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", DeviceCredential.Hash("abc"));
        Assert.Equal(43, DeviceCredential.NewSecret().Length);
        Assert.NotEqual(DeviceCredential.NewSecret(), DeviceCredential.NewSecret());
    }

    [Fact]
    public async Task La_credencial_se_guarda_protegida_con_DPAPI_y_nunca_en_claro()
    {
        var directory = Path.Combine(Path.GetTempPath(), "taba-credential-" + Guid.NewGuid().ToString("N"));
        try
        {
            var protector = new DpapiSecretProtector();
            var store = new ProtectedCredentialStore(directory, protector);
            var credential = new DeviceCredential(Guid.NewGuid(), DeviceCredential.NewSecret());
            store.Save(new StoredCredential(credential, null, Guid.NewGuid(), "TABA", "Mostrador", DateTimeOffset.UtcNow));

            var onDisk = await File.ReadAllBytesAsync(Path.Combine(directory, ProtectedCredentialStore.FileName));
            Assert.DoesNotContain(credential.Secret, Encoding.UTF8.GetString(onDisk), StringComparison.Ordinal);
            Assert.DoesNotContain(credential.Secret, Encoding.Unicode.GetString(onDisk), StringComparison.Ordinal);
            Assert.Equal(credential.Secret, new ProtectedCredentialStore(directory, protector).Load()!.Current.Secret);
            // Con otro propósito (entropía) DPAPI no abre el blob.
            Assert.ThrowsAny<System.Security.Cryptography.CryptographicException>(() => new ProtectedCredentialStore(directory, new DpapiSecretProtector("otro")).Load());
            store.Delete();
            Assert.Null(store.Load());
        }
        finally
        {
            await TestFiles.DeleteDirectoryAsync(directory);
        }
    }

    [Fact]
    public async Task El_token_de_la_api_local_se_crea_una_vez_y_queda_protegido()
    {
        var directory = Path.Combine(Path.GetTempPath(), "taba-token-" + Guid.NewGuid().ToString("N"));
        try
        {
            var protector = new DpapiSecretProtector();
            var first = InstallationToken.LoadOrCreate(directory, protector);
            Assert.Equal(first, InstallationToken.LoadOrCreate(directory, protector));
            Assert.DoesNotContain(first, Encoding.UTF8.GetString(await File.ReadAllBytesAsync(Path.Combine(directory, InstallationToken.FileName))), StringComparison.Ordinal);
        }
        finally
        {
            await TestFiles.DeleteDirectoryAsync(directory);
        }
    }
}
