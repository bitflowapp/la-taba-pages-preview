using System.Globalization;
using System.Text;
using Taba.LocalAgent.Core.Documents;

namespace Taba.LocalAgent.Core.Printing.EscPos;

/// <summary>
/// Constructor de bytes ESC/POS con el subconjunto que comparten las térmicas
/// comunes (Epson TM y compatibles): inicializar, tabla de caracteres, alinear,
/// negrita, tamaño doble, avanzar, código QR (modelo 2) y corte.
///
/// Texto: por defecto se translitera a ASCII («Neuquén» → «Neuquen»), que se lee
/// bien en cualquier térmica. Con una tabla de caracteres conocida (PC850,
/// PC858, WPC1252) se imprimen los acentos: se elige con ESC t y se codifica con
/// esa tabla; lo que la tabla no tiene sale como «?», nunca como basura.
/// </summary>
public sealed class EscPosBuilder
{
    private const byte Esc = 0x1B;
    private const byte Gs = 0x1D;
    private const byte Lf = 0x0A;

    private readonly List<byte> _bytes = [];
    private readonly Encoding? _encoding;

    static EscPosBuilder() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    public EscPosBuilder(int columns, EscPosCodePage codePage = EscPosCodePage.Ascii)
    {
        if (columns is < 24 or > 64)
        {
            throw new ArgumentOutOfRangeException(nameof(columns), "COLUMNS_OUT_OF_RANGE");
        }

        Columns = columns;
        CodePage = codePage;
        _bytes.AddRange([Esc, (byte)'@']);
        if (codePage != EscPosCodePage.Ascii)
        {
            var (table, codepage) = codePage switch
            {
                EscPosCodePage.Pc850 => ((byte)2, 850),
                EscPosCodePage.Pc858 => ((byte)19, 858),
                _ => ((byte)16, 1252),
            };
            _bytes.AddRange([Esc, (byte)'t', table]);
            _encoding = Encoding.GetEncoding(codepage, new EncoderReplacementFallback("?"), DecoderFallback.ReplacementFallback);
        }
    }

    public int Columns { get; }

    public EscPosCodePage CodePage { get; }

    /// <summary>Columnas en fuente A según el ancho del papel.</summary>
    public static int ColumnsFor(int paperWidthMm) => paperWidthMm <= 58 ? 32 : 48;

    public EscPosBuilder Align(TextAlignment align)
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

    /// <summary>Texto cortado en palabras al ancho indicado (por defecto, las columnas del papel).</summary>
    public EscPosBuilder Line(string text = "", int? width = null)
    {
        foreach (var line in Wrap(text ?? string.Empty, width ?? Columns))
        {
            _bytes.AddRange(Encode(line));
            _bytes.Add(Lf);
        }

        return this;
    }

    /// <summary>
    /// Texto a la izquierda y a la derecha (ítem e importe). Si la izquierda no
    /// entra, se parte en varios renglones y el importe va en el último: nunca
    /// se pierde texto ni se pisa el número.
    /// </summary>
    public EscPosBuilder Row(string left, string right)
    {
        left ??= string.Empty;
        right ??= string.Empty;
        if (right.Length == 0)
        {
            return Line(left);
        }

        var space = Columns - right.Length - 1;
        if (space < 8)
        {
            return Line(left).Line(right.PadLeft(Columns));
        }

        var lines = Wrap(left, space).ToList();
        for (var i = 0; i < lines.Count - 1; i++)
        {
            Line(lines[i]);
        }

        return Line(lines[^1].PadRight(Columns - right.Length) + right);
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
        if (payload.Length > 2000 || data.Any(c => c > 0x7E || c < 0x20))
        {
            throw new ArgumentOutOfRangeException(nameof(data), "QR_DATA_INVALID");
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

    internal static IEnumerable<string> Wrap(string text, int columns) => TextWrap.Wrap(text, columns);

    private byte[] Encode(string text)
    {
        if (_encoding is null)
        {
            return Encoding.ASCII.GetBytes(Transliterate(text));
        }

        return _encoding.GetBytes(Typography(text));
    }

    /// <summary>Signos tipográficos que ninguna tabla de las térmicas trae, a su equivalente simple.</summary>
    internal static string Typography(string text)
    {
        var builder = new StringBuilder(text.Length);
        foreach (var character in text)
        {
            builder.Append(character switch
            {
                '“' or '”' or '«' or '»' => "\"",
                '‘' or '’' => "'",
                '–' or '—' or '•' or '·' => "-",
                '…' => "...",
                _ => character.ToString(),
            });
        }

        return builder.ToString();
    }

    internal static string Transliterate(string text)
    {
        var decomposed = Typography(text).Normalize(NormalizationForm.FormD);
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
                _ when character < 0x80 => character,
                _ => '?',
            });
        }

        return builder.ToString().Normalize(NormalizationForm.FormC);
    }
}

public enum TextAlignment : byte
{
    Left = 0,
    Center = 1,
    Right = 2,
}
