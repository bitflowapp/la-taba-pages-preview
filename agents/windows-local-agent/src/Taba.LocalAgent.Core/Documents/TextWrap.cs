using System.Text;

namespace Taba.LocalAgent.Core.Documents;

/// <summary>Corte de texto en palabras a un ancho en columnas. Una palabra más larga que el ancho se parte, nunca se pierde.</summary>
public static class TextWrap
{
    public static IReadOnlyList<string> Wrap(string? text, int columns)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(columns, 1);

        var lines = new List<string>();
        if (string.IsNullOrEmpty(text))
        {
            lines.Add(string.Empty);
            return lines;
        }

        var current = new StringBuilder();
        foreach (var word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var piece = word;
            while (piece.Length > columns)
            {
                if (current.Length > 0)
                {
                    lines.Add(current.ToString());
                    current.Clear();
                }

                lines.Add(piece[..columns]);
                piece = piece[columns..];
            }

            if (current.Length > 0 && current.Length + 1 + piece.Length > columns)
            {
                lines.Add(current.ToString());
                current.Clear();
            }

            if (current.Length > 0)
            {
                current.Append(' ');
            }

            current.Append(piece);
        }

        if (current.Length > 0)
        {
            lines.Add(current.ToString());
        }

        if (lines.Count == 0)
        {
            lines.Add(string.Empty);
        }

        return lines;
    }
}
