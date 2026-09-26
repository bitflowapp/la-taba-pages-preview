namespace Taba.LocalAgent.Core.Fiscal;

public enum ReconciliationDecision
{
    /// <summary>ARCA ya autorizó ESTE comprobante: se recupera el CAE sin reenviar.</summary>
    RecoverAuthorized,

    /// <summary>ARCA no lo recibió y el número sigue libre: se puede reenviar el MISMO pedido.</summary>
    ResendSameNumber,

    /// <summary>Lo que hay en ARCA no coincide o el número ya se usó: revisión humana, nunca reemitir.</summary>
    NeedsReconciliation,
}

public sealed record ReconciliationResult(ReconciliationDecision Decision, string? Cae, DateOnly? CaeExpiration, string Reason);

/// <summary>
/// Qué hacer después de un timeout o una respuesta perdida. Es la regla del
/// manual WSFEv1 («Operatoria con errores de comunicación»): no se sabe si
/// ARCA asignó el CAE, y reenviar un comprobante ya emitido da error de
/// correlatividad. Primero se consulta con el número reservado.
/// </summary>
public static class FiscalReconciler
{
    public static ReconciliationResult Decide(WsfeInvoiceRequest sent, ConsultedVoucher? consulted, long lastAuthorized)
    {
        ArgumentNullException.ThrowIfNull(sent);
        if (consulted is not null)
        {
            var matches = consulted.VoucherType == sent.VoucherType
                && consulted.PointOfSale == sent.PointOfSale
                && consulted.Number == sent.VoucherNumber
                && consulted.IssueDate == sent.IssueDate
                && decimal.Round(consulted.Total, 2) == decimal.Round(sent.Total, 2)
                && consulted.RecipientDocType == sent.RecipientDocType
                && consulted.RecipientDocNumber == sent.RecipientDocNumber;
            if (!matches)
            {
                return new ReconciliationResult(ReconciliationDecision.NeedsReconciliation, null, null, "ARCA_RECONCILIATION_MISMATCH");
            }

            if (consulted.Result == "A" && consulted.Cae is { Length: 14 } cae && cae.All(char.IsAsciiDigit))
            {
                return new ReconciliationResult(ReconciliationDecision.RecoverAuthorized, cae, consulted.CaeExpiration, "RECOVERED_FROM_ARCA");
            }

            return new ReconciliationResult(ReconciliationDecision.NeedsReconciliation, null, null, "ARCA_VOUCHER_WITHOUT_VALID_CAE");
        }

        // No existe en ARCA. Sólo es seguro reenviar si nadie usó ese número
        // (ni nuestro pedido perdido ni otro sistema con el mismo punto de venta).
        return lastAuthorized < sent.VoucherNumber
            ? new ReconciliationResult(ReconciliationDecision.ResendSameNumber, null, null, "NOT_RECEIVED_BY_ARCA")
            : new ReconciliationResult(ReconciliationDecision.NeedsReconciliation, null, null, "NUMBER_ALREADY_USED");
    }
}
