using System.Security.Cryptography.X509Certificates;

namespace Taba.LocalAgent.Core.Fiscal;

/// <summary>El transporte SOAP. En producción es HTTPS; en las pruebas, un doble.</summary>
public interface IArcaTransport
{
    /// <summary>Envía el sobre y devuelve el cuerpo de la respuesta, o lanza <see cref="ArcaCommunicationException"/>.</summary>
    Task<string> PostAsync(Uri endpoint, string soapAction, string envelope, CancellationToken cancellationToken);
}

/// <summary>
/// Se cortó la comunicación. <see cref="MayHaveReachedArca"/> es verdadero cuando
/// el pedido pudo haber llegado (timeout, conexión cortada después de enviar):
/// ese caso NUNCA se trata como un rechazo.
/// </summary>
public sealed class ArcaCommunicationException(string code, bool mayHaveReachedArca, Exception? inner = null)
    : Exception(code, inner)
{
    public string Code { get; } = code;

    public bool MayHaveReachedArca { get; } = mayHaveReachedArca;
}

/// <summary>De dónde sale el certificado. En el agente: almacén de Windows, clave no exportable.</summary>
public interface IArcaCertificateSource
{
    X509Certificate2 GetSigningCertificate(string cuit);
}

public enum FiscalAuthorizationState
{
    Authorized,
    Rejected,
    NeedsReconciliation,
    RetryLater,
}

public sealed record FiscalAuthorizationResult(
    FiscalAuthorizationState State,
    string? Cae,
    DateOnly? CaeExpiration,
    IReadOnlyList<ArcaMessage> Observations,
    IReadOnlyList<ArcaMessage> Errors,
    string Reason);

/// <summary>
/// Frontera ARCA del agente. En la arquitectura recomendada ARCA se opera en el
/// servidor; esta frontera existe para el comercio que exija custodia local del
/// certificado y queda deshabilitada por defecto. Producción exige habilitación
/// explícita: no se llega por accidente.
/// </summary>
public sealed class ArcaGateway(
    ArcaEnvironment environment,
    IArcaTransport transport,
    IArcaCertificateSource certificates,
    AccessTicketCache tickets,
    TimeProvider? clock = null,
    bool productionEnabled = false)
{
    private const string Service = "wsfe";
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    public async Task<AccessTicket> AuthenticateAsync(string cuit, CancellationToken cancellationToken = default)
    {
        EnsureEnvironmentAllowed();
        return await tickets.GetAsync(AccessTicketCache.Key(environment, cuit, Service), async ct =>
        {
            var tra = LoginTicketRequest.Build(Service, _clock.GetUtcNow(), (uint)Random.Shared.NextInt64(1, uint.MaxValue));
            using var certificate = certificates.GetSigningCertificate(cuit);
            var cms = CmsLoginTicketSigner.SignToBase64(tra, certificate);
            var envelope = WsaaSoap.LoginCms(cms);
            string response;
            try
            {
                response = await transport.PostAsync(environment.WsaaLoginCms, string.Empty, envelope, ct).ConfigureAwait(false);
            }
            catch (ArcaCommunicationException error)
            {
                throw new WsaaException("wsaa.unavailable", error.Code);
            }

            return WsaaSoap.ParseLoginResponse(response);
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Pide el CAE de un comprobante cuyo número ya se reservó. Ante una
    /// comunicación cortada, consulta antes de decidir: nunca emite dos veces.
    /// </summary>
    public async Task<FiscalAuthorizationResult> AuthorizeAsync(WsfeInvoiceRequest request, CancellationToken cancellationToken = default)
    {
        WsfeSoap.Validate(request);
        var ticket = await AuthenticateAsync(request.IssuerCuit, cancellationToken).ConfigureAwait(false);
        try
        {
            var response = await transport.PostAsync(
                environment.Wsfe, WsfeSoap.SoapAction("FECAESolicitar"), WsfeSoap.FeCaeSolicitar(ticket, request), cancellationToken).ConfigureAwait(false);
            var cae = WsfeResponses.ParseCaeResponse(response);
            return cae.Outcome == CaeOutcome.Approved
                ? new FiscalAuthorizationResult(FiscalAuthorizationState.Authorized, cae.Cae, cae.CaeExpiration, cae.Observations, cae.Errors, "AUTHORIZED")
                : new FiscalAuthorizationResult(FiscalAuthorizationState.Rejected, null, null, cae.Observations, cae.Errors, "REJECTED_BY_ARCA");
        }
        catch (ArcaCommunicationException error) when (!error.MayHaveReachedArca)
        {
            return new FiscalAuthorizationResult(FiscalAuthorizationState.RetryLater, null, null, [], [], error.Code);
        }
        catch (Exception error) when (error is ArcaCommunicationException or FormatException)
        {
            return await ReconcileAsync(ticket, request, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task<FiscalAuthorizationResult> ReconcileAsync(AccessTicket ticket, WsfeInvoiceRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var consulted = WsfeResponses.ParseConsultResponse(await transport.PostAsync(
                environment.Wsfe,
                WsfeSoap.SoapAction("FECompConsultar"),
                WsfeSoap.FeCompConsultar(ticket, request.IssuerCuit, request.VoucherType, request.PointOfSale, request.VoucherNumber),
                cancellationToken).ConfigureAwait(false));
            var last = WsfeResponses.ParseLastAuthorized(await transport.PostAsync(
                environment.Wsfe,
                WsfeSoap.SoapAction("FECompUltimoAutorizado"),
                WsfeSoap.FeCompUltimoAutorizado(ticket, request.IssuerCuit, request.PointOfSale, request.VoucherType),
                cancellationToken).ConfigureAwait(false));
            var decision = FiscalReconciler.Decide(request, consulted, last);
            return decision.Decision switch
            {
                ReconciliationDecision.RecoverAuthorized => new FiscalAuthorizationResult(FiscalAuthorizationState.Authorized, decision.Cae, decision.CaeExpiration, [], [], decision.Reason),
                ReconciliationDecision.ResendSameNumber => new FiscalAuthorizationResult(FiscalAuthorizationState.RetryLater, null, null, [], [], decision.Reason),
                _ => new FiscalAuthorizationResult(FiscalAuthorizationState.NeedsReconciliation, null, null, [], [], decision.Reason),
            };
        }
        catch (Exception error) when (error is ArcaCommunicationException or FormatException)
        {
            // Tampoco se pudo consultar: sigue ambiguo. No se reenvía.
            return new FiscalAuthorizationResult(FiscalAuthorizationState.NeedsReconciliation, null, null, [], [], "AMBIGUOUS_UNRESOLVED");
        }
    }

    private void EnsureEnvironmentAllowed()
    {
        if (ReferenceEquals(environment, ArcaEnvironment.Production) && !productionEnabled)
        {
            throw new InvalidOperationException("ARCA_PRODUCTION_DISABLED_BY_DESIGN");
        }
    }
}

/// <summary>El sobre de LoginCms y la lectura de su respuesta.</summary>
public static class WsaaSoap
{
    public static string LoginCms(string cmsBase64) =>
        "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:wsaa=\"http://wsaa.view.sua.dvadac.desein.afip.gov\">"
        + "<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>"
        + System.Security.SecurityElement.Escape(cmsBase64)
        + "</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>";

    /// <summary>La respuesta trae el TA escapado dentro de <c>loginCmsReturn</c>; un fault trae el código oficial.</summary>
    public static AccessTicket ParseLoginResponse(string soapXml)
    {
        var document = SafeXml.Parse(soapXml);
        var fault = document.Descendants().FirstOrDefault(e => e.Name.LocalName == "Fault");
        if (fault is not null)
        {
            var code = fault.Descendants().FirstOrDefault(e => e.Name.LocalName == "faultcode")?.Value ?? "wsaa.internalError";
            var localCode = code.Contains(':', StringComparison.Ordinal) ? code[(code.IndexOf(':', StringComparison.Ordinal) + 1)..] : code;
            throw new WsaaException(localCode, fault.Descendants().FirstOrDefault(e => e.Name.LocalName == "faultstring")?.Value ?? "WSAA_FAULT");
        }

        var ticketXml = document.Descendants().FirstOrDefault(e => e.Name.LocalName == "loginCmsReturn")?.Value
            ?? throw new FormatException("WSAA_RESPONSE_WITHOUT_TICKET");
        return AccessTicket.Parse(ticketXml);
    }
}
