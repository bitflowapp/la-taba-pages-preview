using System.Globalization;
using System.Text;

namespace Taba.LocalAgent.Core.Printing.EscPos;

/// <summary>
/// Constructor de bytes ESC/POS con el subconjunto que comparten las térmicas
/// comunes (Epson TM y compatibles): inicializar, alinear, negrita, tamaño doble,
/// avanzar, código QR (modelo 2) y corte.
///
/// El texto se translitera a ASCII por defecto («Neuquén» → «Neuquen»): cada
/// marca numera distinto sus tablas de caracteres y un acento mal mapeado
/// imprime basura. Quien tenga una impresora con tabla conocida puede pasar su
/// codificación explícita.
/// </summary>
public sealed class EscPosBuilder
{
    private const byte Esc = 0x1B;
    private const byte Gs = 0x1D;
    private const byte Lf = 0x0A;

    private readonly List<byte> _bytes = [];
    private readonly Encoding? _encoding;

    public EscPosBuilder(int columns, Encoding? encoding = null)
    {
        if (columns is < 24 or > 64)
        {
            throw new ArgumentOutOfRangeException(nameof(columns), "COLUMNS_OUT_OF_RANGE");
        }

        Columns = columns;
        _encoding = encoding;
        _bytes.AddRange([Esc, (byte)'@']);
    }

    public int Columns { get; }

    public static int ColumnsFor(PrintFormat format) => format switch
    {
        PrintFormat.EscPos58mm => 32,
        PrintFormat.EscPos80mm => 48,
        _ => throw new ArgumentOutOfRangeException(nameof(format), "NOT_A_THERMAL_FORMAT"),
    };

    public EscPosBuilder Align(TextAlign align)
    {
        _bytes.AddRange([Esc, (byte)'a', (byte)align]);
        return this;
    }

    public EscPosBuilder Bold(bool on)
    {
        _bytes.AddRange([Esc, (byte)'E', on ? (byte)1 : (byte)0]);
        return this;
    }

    public EscPosBuilder DoubleSize(bool on)
    {
        _bytes.AddRange([Gs, (byte)'!', on ? (byte)0x11 : (byte)0x00]);
        return this;
    }

    /// <summary>Una línea de texto, cortada a las columnas disponibles (en palabras).</summary>
    public EscPosBuilder Line(string text = "")
    {
        foreach (var line in Wrap(text ?? string.Empty, Columns))
        {
            _bytes.AddRange(Encode(line));
            _bytes.Add(Lf);
        }

        return this;
    }

    /// <summary>Texto a la izquierda y a la derecha en el mismo renglón (por ejemplo «Total» y el importe).</summary>
    public EscPosBuilder Row(string left, string right)
    {
        right ??= string.Empty;
        left ??= string.Empty;
        var space = Columns - right.Length - 1;
        if (space < 1)
        {
            return Line(left).Line(right);
        }

        var head = left.Length > space ? left[..space] : left;
        return Line(head.PadRight(Columns - right.Length) + right);
    }

    public EscPosBuilder Separator(char character = '-') => Line(new string(character, Columns));

    public EscPosBuilder Feed(int lines)
    {
        _bytes.AddRange([Esc, (byte)'d', (byte)Math.Clamp(lines, 0, 10)]);
        return this;
    }

    /// <summary>
    /// Código QR, modelo 2, corrección M. Es el comando GS ( k: se elige el
    /// modelo, el tamaño del módulo, el nivel de corrección, se guarda el dato y
    /// se imprime.
    /// </summary>
    public EscPosBuilder QrCode(string data, int moduleSize = 5)
    {
        ArgumentException.ThrowIfNullOrEmpty(data);
        var payload = Encoding.ASCII.GetBytes(data);
        if (payload.Length > 2000)
        {
            throw new ArgumentOutOfRangeException(nameof(data), "QR_DATA_TOO_LONG");
        }

        var size = (byte)Math.Clamp(moduleSize, 1, 16);
        _bytes.AddRange([Gs, (byte)'(', (byte)'k', 4, 0, 49, 65, 50, 0]);
        _bytes.AddRange([Gs, (byte)'(', (byte)'k', 3, 0, 49, 67, size]);
        _bytes.AddRange([Gs, (byte)'(', (byte)'k', 3, 0, 49, 69, 49]);
        var length = payload.Length + 3;
        _bytes.AddRange([Gs, (byte)'(', (byte)'k', (byte)(length & 0xFF), (byte)((length >> 8) & 0xFF), 49, 80, 48]);
        _bytes.AddRange(payload);
        _bytes.AddRange([Gs, (byte)'(', (byte)'k', 3, 0, 49, 81, 48]);
        return this;
    }

    /// <summary>Avanza y corta (corte parcial, el más compatible).</summary>
    public EscPosBuilder Cut()
    {
        _bytes.AddRange([Gs, (byte)'V', 66, 3]);
        return this;
    }

    public byte[] Build() => [.. _bytes];

    internal static IEnumerable<string> Wrap(string text, int columns)
    {
        if (text.Length == 0)
        {
            yield return string.Empty;
            yield break;
        }

        var current = new StringBuilder();
        foreach (var word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var piece = word;
            while (piece.Length > columns)
            {
                if (current.Length > 0)
                {
                    yield return current.ToString();
                    current.Clear();
                }

                yield return piece[..columns];
                piece = piece[columns..];
            }

            if (current.Length > 0 && current.Length + 1 + piece.Length > columns)
            {
                yield return current.ToString();
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
            yield return current.ToString();
        }
    }

    private byte[] Encode(string text)
    {
        if (_encoding is not null)
        {
            return _encoding.GetBytes(text);
        }

        return Encoding.ASCII.GetBytes(Transliterate(text));
    }

    internal static string Transliterate(string text)
    {
        var decomposed = text.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            // Los signos de apertura no existen en ASCII y no hacen falta para leer.
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark
                || character is '¿' or '¡')
            {
                continue;
            }

            builder.Append(character switch
            {
                'º' or '°' => 'o',
                '·' or '•' => '-',
                '«' or '»' or '“' or '”' => '"',
                '‘' or '’' => '\'',
                '–' or '—' => '-',
                _ when character < 0x80 => character,
                _ => '?',
            });
        }

        return builder.ToString().Normalize(NormalizationForm.FormC);
    }
}

public enum TextAlign : byte
{
    Left = 0,
    Center = 1,
    Right = 2,
}
