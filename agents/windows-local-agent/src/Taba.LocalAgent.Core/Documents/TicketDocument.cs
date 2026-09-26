namespace Taba.LocalAgent.Core.Documents;

/// <summary>Alineación de un renglón.</summary>
public enum TicketAlign
{
    Left,
    Center,
    Right,
}

/// <summary>
/// Un elemento de un ticket, independiente de la impresora. El mismo documento
/// se codifica en ESC/POS para una térmica o se dibuja con el driver de Windows
/// para cualquier otra impresora: el negocio no se acopla a una marca.
/// </summary>
public abstract record TicketElement;

/// <summary>Un renglón de texto. <paramref name="Large"/> es doble alto y ancho.</summary>
public sealed record TextLine(string Text, TicketAlign Align = TicketAlign.Left, bool Bold = false, bool Large = false) : TicketElement;

/// <summary>Texto a la izquierda y a la derecha en el mismo renglón (ítem e importe).</summary>
public sealed record SplitLine(string Left, string Right, bool Bold = false) : TicketElement;

/// <summary>Una línea separadora de ancho completo.</summary>
public sealed record SeparatorLine(char Character = '-') : TicketElement;

/// <summary>Un código QR (por ejemplo, el QR fiscal de ARCA).</summary>
public sealed record QrElement(string Data) : TicketElement;

/// <summary>Avance de papel en renglones.</summary>
public sealed record FeedLines(int Lines) : TicketElement;

/// <summary>Un ticket listo para imprimir.</summary>
public sealed record TicketDocument(string Title, IReadOnlyList<TicketElement> Elements);

/// <summary>Arma un <see cref="TicketDocument"/> renglón por renglón.</summary>
public sealed class TicketBuilder(string title)
{
    private readonly List<TicketElement> _elements = [];

    public TicketBuilder Text(string text, TicketAlign align = TicketAlign.Left, bool bold = false, bool large = false)
    {
        _elements.Add(new TextLine(text ?? string.Empty, align, bold, large));
        return this;
    }

    public TicketBuilder Split(string left, string right, bool bold = false)
    {
        _elements.Add(new SplitLine(left ?? string.Empty, right ?? string.Empty, bold));
        return this;
    }

    public TicketBuilder Separator(char character = '-')
    {
        _elements.Add(new SeparatorLine(character));
        return this;
    }

    public TicketBuilder Qr(string data)
    {
        ArgumentException.ThrowIfNullOrEmpty(data);
        _elements.Add(new QrElement(data));
        return this;
    }

    public TicketBuilder Feed(int lines)
    {
        _elements.Add(new FeedLines(Math.Clamp(lines, 0, 10)));
        return this;
    }

    public TicketDocument Build() => new(title, [.. _elements]);
}
