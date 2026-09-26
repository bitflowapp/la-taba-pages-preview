using Taba.LocalAgent.Core.Documents;

namespace Taba.LocalAgent.Core.Printing.EscPos;

/// <summary>Convierte el documento neutral en bytes ESC/POS para el perfil de una térmica.</summary>
public static class EscPosEncoder
{
    public static byte[] Encode(TicketDocument document, PrinterProfile profile)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(profile);
        var columns = profile.EffectiveColumns;
        var builder = new EscPosBuilder(columns, profile.CodePage);
        foreach (var element in document.Elements)
        {
            switch (element)
            {
                case TextLine text:
                    builder.Align(Map(text.Align));
                    if (text.Bold)
                    {
                        builder.Bold(true);
                    }

                    if (text.Large)
                    {
                        // Doble ancho: entra la mitad de columnas por renglón.
                        builder.DoubleSize(true).Line(text.Text, columns / 2).DoubleSize(false);
                    }
                    else
                    {
                        builder.Line(text.Text);
                    }

                    if (text.Bold)
                    {
                        builder.Bold(false);
                    }

                    builder.Align(TextAlignment.Left);
                    break;
                case SplitLine split:
                    builder.Bold(split.Bold).Row(split.Left, split.Right).Bold(false);
                    break;
                case SeparatorLine separator:
                    builder.Separator(separator.Character);
                    break;
                case QrElement qr:
                    builder.Align(TextAlignment.Center)
                        .QrCode(qr.Data, profile.PaperWidthMm <= 58 ? 4 : 6)
                        .Feed(1)
                        .Align(TextAlignment.Left);
                    break;
                case FeedLines feed:
                    builder.Feed(feed.Lines);
                    break;
                default:
                    throw new ArgumentException("TICKET_ELEMENT_UNSUPPORTED", nameof(document));
            }
        }

        return builder.Cut().Build();
    }

    private static TextAlignment Map(TicketAlign align) => align switch
    {
        TicketAlign.Center => TextAlignment.Center,
        TicketAlign.Right => TextAlignment.Right,
        _ => TextAlignment.Left,
    };
}
