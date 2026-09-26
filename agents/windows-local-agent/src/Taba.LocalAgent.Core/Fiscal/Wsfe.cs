using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace Taba.LocalAgent.Core.Fiscal;

/// <summary>Una alícuota de IVA del comprobante (Id según <c>FEParamGetTiposIva</c>).</summary>
public sealed record VatLine(int Id, decimal TaxableBase, decimal Amount);

/// <summary>Comprobante asociado (una nota de crédito apunta a su factura).</summary>
public sealed record AssociatedVoucher(int VoucherType, int PointOfSale, long Number, string IssuerCuit, DateOnly IssueDate);

/// <summary>
/// Pedido de CAE para UN comprobante. Todos los códigos (tipo, documento,
/// condición frente al IVA, alícuotas) vienen de la política fiscal aprobada y
/// de los parámetros oficiales sincronizados: este modelo no infiere ninguno.
/// </summary>
public sealed record WsfeInvoiceRequest
{
    public required string IssuerCuit { get; init; }

    public required int PointOfSale { get; init; }

    public required int VoucherType { get; init; }

    /// <summary>1 Productos, 2 Servicios, 3 Productos y Servicios.</summary>
    public required int Concept { get; init; }

    public required int RecipientDocType { get; init; }

    public required long RecipientDocNumber { get; init; }

    /// <summary>Número reservado localmente antes de llamar a ARCA.</summary>
    public required long VoucherNumber { get; init; }

    public required DateOnly IssueDate { get; init; }

    public required decimal Total { get; init; }

    public decimal NonTaxed { get; init; }

    public required decimal Net { get; init; }

    public decimal Exempt { get; init; }

    public decimal OtherTaxes { get; init; }

    public required decimal Vat { get; init; }

    public string Currency { get; init; } = "PES";

    public decimal CurrencyRate { get; init; } = 1m;

    /// <summary>
    /// Condición frente al IVA del receptor (manual 4.0, RG 5616). Se valida
    /// contra <c>FEParamGetCondicionIvaReceptor</c>; ARCA rechaza con 10246 cuando falta.
    /// </summary>
    public required int ReceiverVatConditionId { get; init; }

    public IReadOnlyList<VatLine> VatLines { get; init; } = [];

    public AssociatedVoucher? Associated { get; init; }

    public DateOnly? ServiceFrom { get; init; }

    public DateOnly? ServiceTo { get; init; }

    public DateOnly? PaymentDue { get; init; }
}

/// <summary>Arma los sobres SOAP de WSFEv1 con XmlWriter: ningún dato se concatena como texto.</summary>
public static class WsfeSoap
{
    public const string Namespace = "http://ar.gov.afip.dif.FEV1/";
    private const string SoapNamespace = "http://schemas.xmlsoap.org/soap/envelope/";

    public static string SoapAction(string operation) => Namespace + operation;

    public static void Validate(WsfeInvoiceRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var errors = new List<string>();
        if (request.IssuerCuit.Length != 11 || !request.IssuerCuit.All(char.IsAsciiDigit))
        {
            errors.Add("ISSUER_CUIT_INVALID");
        }

        if (request.PointOfSale is < 1 or > 99999)
        {
            errors.Add("POINT_OF_SALE_INVALID");
        }

        if (request.VoucherType <= 0)
        {
            errors.Add("VOUCHER_TYPE_REQUIRED");
        }

        if (request.Concept is < 1 or > 3)
        {
            errors.Add("CONCEPT_INVALID");
        }

        if (request.VoucherNumber is < 1 or > 99_999_999)
        {
            errors.Add("VOUCHER_NUMBER_INVALID");
        }

        if (request.ReceiverVatConditionId <= 0)
        {
            errors.Add("RECEIVER_VAT_CONDITION_REQUIRED");
        }

        if (request.Concept is 2 or 3 && (request.ServiceFrom is null || request.ServiceTo is null || request.PaymentDue is null))
        {
            errors.Add("SERVICE_DATES_REQUIRED");
        }

        // ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA (regla del manual).
        var sum = request.NonTaxed + request.Net + request.Exempt + request.OtherTaxes + request.Vat;
        if (decimal.Round(sum, 2, MidpointRounding.ToEven) != decimal.Round(request.Total, 2, MidpointRounding.ToEven))
        {
            errors.Add("TOTAL_MISMATCH");
        }

        var vatSum = request.VatLines.Sum(v => v.Amount);
        if (request.VatLines.Count > 0 && decimal.Round(vatSum, 2, MidpointRounding.ToEven) != decimal.Round(request.Vat, 2, MidpointRounding.ToEven))
        {
            errors.Add("VAT_LINES_MISMATCH");
        }

        if (errors.Count > 0)
        {
            throw new ArgumentException(string.Join(",", errors), nameof(request));
        }
    }

    public static string FeCaeSolicitar(AccessTicket ticket, WsfeInvoiceRequest request)
    {
        Validate(request);
        return Envelope("FECAESolicitar", ticket, request.IssuerCuit, w =>
        {
            w.WriteStartElement("ar", "FeCAEReq", Namespace);
            w.WriteStartElement("ar", "FeCabReq", Namespace);
            Element(w, "CantReg", 1);
            Element(w, "PtoVta", request.PointOfSale);
            Element(w, "CbteTipo", request.VoucherType);
            w.WriteEndElement();
            w.WriteStartElement("ar", "FeDetReq", Namespace);
            w.WriteStartElement("ar", "FECAEDetRequest", Namespace);
            Element(w, "Concepto", request.Concept);
            Element(w, "DocTipo", request.RecipientDocType);
            Element(w, "DocNro", request.RecipientDocNumber);
            Element(w, "CbteDesde", request.VoucherNumber);
            Element(w, "CbteHasta", request.VoucherNumber);
            Element(w, "CbteFch", Date(request.IssueDate));
            Element(w, "ImpTotal", Amount(request.Total));
            Element(w, "ImpTotConc", Amount(request.NonTaxed));
            Element(w, "ImpNeto", Amount(request.Net));
            Element(w, "ImpOpEx", Amount(request.Exempt));
            Element(w, "ImpTrib", Amount(request.OtherTaxes));
            Element(w, "ImpIVA", Amount(request.Vat));
            if (request.Concept is 2 or 3)
            {
                Element(w, "FchServDesde", Date(request.ServiceFrom!.Value));
                Element(w, "FchServHasta", Date(request.ServiceTo!.Value));
                Element(w, "FchVtoPago", Date(request.PaymentDue!.Value));
            }

            Element(w, "MonId", request.Currency);
            Element(w, "MonCotiz", request.CurrencyRate.ToString("0.######", CultureInfo.InvariantCulture));
            // En el orden del WSDL: CanMisMonExt (no aplica a PES) y la condición del receptor.
            Element(w, "CondicionIVAReceptorId", request.ReceiverVatConditionId);
            if (request.Associated is { } associated)
            {
                w.WriteStartElement("ar", "CbtesAsoc", Namespace);
                w.WriteStartElement("ar", "CbteAsoc", Namespace);
                Element(w, "Tipo", associated.VoucherType);
                Element(w, "PtoVta", associated.PointOfSale);
                Element(w, "Nro", associated.Number);
                Element(w, "Cuit", associated.IssuerCuit);
                Element(w, "CbteFch", Date(associated.IssueDate));
                w.WriteEndElement();
                w.WriteEndElement();
            }

            if (request.VatLines.Count > 0)
            {
                w.WriteStartElement("ar", "Iva", Namespace);
                foreach (var vat in request.VatLines)
                {
                    w.WriteStartElement("ar", "AlicIva", Namespace);
                    Element(w, "Id", vat.Id);
                    Element(w, "BaseImp", Amount(vat.TaxableBase));
                    Element(w, "Importe", Amount(vat.Amount));
                    w.WriteEndElement();
                }

                w.WriteEndElement();
            }

            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteEndElement();
        });
    }

    public static string FeCompConsultar(AccessTicket ticket, string cuit, int voucherType, int pointOfSale, long number) =>
        Envelope("FECompConsultar", ticket, cuit, w =>
        {
            w.WriteStartElement("ar", "FeCompConsReq", Namespace);
            Element(w, "CbteTipo", voucherType);
            Element(w, "CbteNro", number);
            Element(w, "PtoVta", pointOfSale);
            w.WriteEndElement();
        });

    public static string FeCompUltimoAutorizado(AccessTicket ticket, string cuit, int pointOfSale, int voucherType) =>
        Envelope("FECompUltimoAutorizado", ticket, cuit, w =>
        {
            Element(w, "PtoVta", pointOfSale);
            Element(w, "CbteTipo", voucherType);
        });

    private static string Envelope(string operation, AccessTicket ticket, string cuit, Action<XmlWriter> body)
    {
        ArgumentNullException.ThrowIfNull(ticket);
        var builder = new StringBuilder();
        var settings = new XmlWriterSettings { OmitXmlDeclaration = true, Encoding = Encoding.UTF8 };
        using (var w = XmlWriter.Create(builder, settings))
        {
            w.WriteStartElement("soapenv", "Envelope", SoapNamespace);
            w.WriteAttributeString("xmlns", "ar", null, Namespace);
            w.WriteElementString("soapenv", "Header", SoapNamespace, string.Empty);
            w.WriteStartElement("soapenv", "Body", SoapNamespace);
            w.WriteStartElement("ar", operation, Namespace);
            w.WriteStartElement("ar", "Auth", Namespace);
            Element(w, "Token", ticket.Token);
            Element(w, "Sign", ticket.Sign);
            Element(w, "Cuit", cuit);
            w.WriteEndElement();
            body(w);
            w.WriteEndElement();
            w.WriteEndElement();
            w.WriteEndElement();
        }

        return builder.ToString();
    }

    private static void Element(XmlWriter writer, string name, object value) =>
        writer.WriteElementString("ar", name, Namespace, Convert.ToString(value, CultureInfo.InvariantCulture));

    private static string Date(DateOnly date) => date.ToString("yyyyMMdd", CultureInfo.InvariantCulture);

    // Redondeo half-even a dos decimales, como declara el manual.
    private static string Amount(decimal value) =>
        decimal.Round(value, 2, MidpointRounding.ToEven).ToString("0.00", CultureInfo.InvariantCulture);
}

public enum CaeOutcome
{
    Approved,
    Rejected,
}

public sealed record ArcaMessage(int Code, string Message);

/// <summary>El resultado de FECAESolicitar para un comprobante.</summary>
public sealed record CaeResult(
    CaeOutcome Outcome,
    long VoucherNumber,
    string? Cae,
    DateOnly? CaeExpiration,
    IReadOnlyList<ArcaMessage> Observations,
    IReadOnlyList<ArcaMessage> Errors);

/// <summary>Un comprobante tal como lo devuelve FECompConsultar.</summary>
public sealed record ConsultedVoucher(
    int VoucherType,
    int PointOfSale,
    long Number,
    DateOnly IssueDate,
    decimal Total,
    int RecipientDocType,
    long RecipientDocNumber,
    string Result,
    string? Cae,
    DateOnly? CaeExpiration);

/// <summary>Lectura de las respuestas de WSFEv1. Una aprobación sin CAE válido es un error de protocolo.</summary>
public static class WsfeResponses
{
    private static readonly XNamespace Ns = WsfeSoap.Namespace;

    public const int NotFoundCode = 602;

    public static CaeResult ParseCaeResponse(string soapXml)
    {
        var result = Result(soapXml, "FECAESolicitarResult");
        var errors = Messages(result.Element(Ns + "Errors"), "Err");
        var detail = result.Element(Ns + "FeDetResp")?.Element(Ns + "FEDetResponse");
        if (detail is null)
        {
            if (errors.Count == 0)
            {
                throw new FormatException("WSFE_RESPONSE_WITHOUT_DETAIL");
            }

            return new CaeResult(CaeOutcome.Rejected, 0, null, null, [], errors);
        }

        var observations = Messages(detail.Element(Ns + "Obs"), "Observaciones");
        var number = long.Parse(detail.Element(Ns + "CbteDesde")?.Value ?? "0", CultureInfo.InvariantCulture);
        var outcome = detail.Element(Ns + "Resultado")?.Value;
        if (outcome == "A")
        {
            var cae = detail.Element(Ns + "CAE")?.Value?.Trim();
            if (cae is null || cae.Length != 14 || !cae.All(char.IsAsciiDigit))
            {
                throw new FormatException("WSFE_APPROVED_WITHOUT_VALID_CAE");
            }

            return new CaeResult(CaeOutcome.Approved, number, cae, ParseDate(detail.Element(Ns + "CAEFchVto")?.Value), observations, errors);
        }

        return new CaeResult(CaeOutcome.Rejected, number, null, null, observations, errors);
    }

    /// <summary>El comprobante consultado, o null si ARCA contesta 602 (no existe).</summary>
    public static ConsultedVoucher? ParseConsultResponse(string soapXml)
    {
        var result = Result(soapXml, "FECompConsultarResult");
        var errors = Messages(result.Element(Ns + "Errors"), "Err");
        var get = result.Element(Ns + "ResultGet");
        if (get is null)
        {
            if (errors.Any(e => e.Code == NotFoundCode))
            {
                return null;
            }

            throw new FormatException(errors.Count > 0 ? $"WSFE_ERROR_{errors[0].Code}" : "WSFE_CONSULT_WITHOUT_RESULT");
        }

        var number = long.Parse(get.Element(Ns + "CbteDesde")?.Value ?? "0", CultureInfo.InvariantCulture);
        var cae = get.Element(Ns + "CodAutorizacion")?.Value?.Trim();
        return new ConsultedVoucher(
            int.Parse(get.Element(Ns + "CbteTipo")?.Value ?? "0", CultureInfo.InvariantCulture),
            int.Parse(get.Element(Ns + "PtoVta")?.Value ?? "0", CultureInfo.InvariantCulture),
            number,
            ParseDate(get.Element(Ns + "CbteFch")?.Value) ?? throw new FormatException("WSFE_CONSULT_WITHOUT_DATE"),
            decimal.Parse(get.Element(Ns + "ImpTotal")?.Value ?? "0", CultureInfo.InvariantCulture),
            int.Parse(get.Element(Ns + "DocTipo")?.Value ?? "0", CultureInfo.InvariantCulture),
            long.Parse(get.Element(Ns + "DocNro")?.Value ?? "0", CultureInfo.InvariantCulture),
            get.Element(Ns + "Resultado")?.Value ?? string.Empty,
            string.IsNullOrEmpty(cae) ? null : cae,
            ParseDate(get.Element(Ns + "FchVto")?.Value));
    }

    public static long ParseLastAuthorized(string soapXml)
    {
        var result = Result(soapXml, "FECompUltimoAutorizadoResult");
        var errors = Messages(result.Element(Ns + "Errors"), "Err");
        var number = result.Element(Ns + "CbteNro")?.Value;
        if (number is null)
        {
            throw new FormatException(errors.Count > 0 ? $"WSFE_ERROR_{errors[0].Code}" : "WSFE_LAST_WITHOUT_NUMBER");
        }

        return long.Parse(number, CultureInfo.InvariantCulture);
    }

    private static XElement Result(string soapXml, string resultName) =>
        SafeXml.Parse(soapXml).Descendants(Ns + resultName).FirstOrDefault()
        ?? throw new FormatException($"WSFE_MISSING_{resultName}");

    private static List<ArcaMessage> Messages(XElement? container, string item) =>
        container?.Elements(Ns + item)
            .Select(e => new ArcaMessage(
                int.Parse(e.Element(Ns + "Code")?.Value ?? "0", CultureInfo.InvariantCulture),
                e.Element(Ns + "Msg")?.Value ?? string.Empty))
            .ToList() ?? [];

    private static DateOnly? ParseDate(string? value) =>
        DateOnly.TryParseExact(value?.Trim(), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date : null;
}
