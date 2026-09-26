using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Taba.LocalAgent.Core.Printing;

namespace Taba.LocalAgent.Windows;

/// <summary>
/// Bytes crudos al spooler de Windows (tipo de dato «RAW»): el camino estándar
/// para ESC/POS con el driver de la impresora instalado. El spooler aceptando
/// el trabajo NO prueba que salió el papel; por eso un corte a mitad se informa
/// como desconocido.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WinSpoolRawTransport : IRawPrinterTransport
{
    public Task<PrintOutcome> SendRawAsync(string printerName, ReadOnlyMemory<byte> payload, string documentTitle, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.Run(() => Send(printerName, payload.ToArray(), documentTitle), cancellationToken);
    }

    private static PrintOutcome Send(string printerName, byte[] payload, string documentTitle)
    {
        if (!NativeMethods.OpenPrinterW(printerName, out var handle, IntPtr.Zero))
        {
            return PrintOutcome.NotSent("PRINTER_OPEN_FAILED");
        }

        try
        {
            var info = new NativeMethods.DocInfo1 { DocName = documentTitle, OutputFile = null, DataType = "RAW" };
            if (NativeMethods.StartDocPrinterW(handle, 1, ref info) == 0)
            {
                return PrintOutcome.NotSent("PRINTER_START_FAILED");
            }

            var started = NativeMethods.StartPagePrinter(handle);
            var written = 0;
            var ok = started && NativeMethods.WritePrinter(handle, payload, payload.Length, out written) && written == payload.Length;
            if (started)
            {
                NativeMethods.EndPagePrinter(handle);
            }

            NativeMethods.EndDocPrinter(handle);
            return ok ? PrintOutcome.Sent() : PrintOutcome.Unknown(written > 0 ? "PRINTER_WRITE_PARTIAL" : "PRINTER_WRITE_FAILED");
        }
        finally
        {
            NativeMethods.ClosePrinter(handle);
        }
    }
}

/// <summary>Impresoras locales y conectadas, con la predeterminada marcada.</summary>
[SupportedOSPlatform("windows")]
public sealed class WinSpoolPrinterCatalog : IPrinterCatalog
{
    private const int PrinterEnumLocal = 0x2;
    private const int PrinterEnumConnections = 0x4;

    public IReadOnlyList<PrinterDescriptor> ListPrinters()
    {
        var flags = PrinterEnumLocal | PrinterEnumConnections;
        NativeMethods.EnumPrintersW(flags, null, 4, IntPtr.Zero, 0, out var needed, out _);
        if (needed <= 0)
        {
            return [];
        }

        var buffer = Marshal.AllocHGlobal(needed);
        try
        {
            if (!NativeMethods.EnumPrintersW(flags, null, 4, buffer, needed, out _, out var returned))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            var defaultName = DefaultPrinter();
            var size = Marshal.SizeOf<NativeMethods.PrinterInfo4>();
            var printers = new List<PrinterDescriptor>(returned);
            for (var i = 0; i < returned; i++)
            {
                var info = Marshal.PtrToStructure<NativeMethods.PrinterInfo4>(buffer + (i * size));
                if (!string.IsNullOrWhiteSpace(info.PrinterName))
                {
                    printers.Add(new PrinterDescriptor(info.PrinterName, string.Equals(info.PrinterName, defaultName, StringComparison.Ordinal)));
                }
            }

            return printers;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static string? DefaultPrinter()
    {
        var length = 0;
        NativeMethods.GetDefaultPrinterW(null, ref length);
        if (length <= 0)
        {
            return null;
        }

        var chars = new char[length];
        return NativeMethods.GetDefaultPrinterW(chars, ref length) ? new string(chars, 0, Math.Max(0, length - 1)) : null;
    }
}

[SupportedOSPlatform("windows")]
internal static partial class NativeMethods
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct DocInfo1
    {
        public string DocName;
        public string? OutputFile;
        public string DataType;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct PrinterInfo4
    {
        public string PrinterName;
        public string? ServerName;
        public int Attributes;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool OpenPrinterW(string printerName, out IntPtr handle, IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool ClosePrinter(IntPtr handle);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern int StartDocPrinterW(IntPtr handle, int level, ref DocInfo1 info);

    [DllImport("winspool.drv", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool EndDocPrinter(IntPtr handle);

    [DllImport("winspool.drv", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool StartPagePrinter(IntPtr handle);

    [DllImport("winspool.drv", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool EndPagePrinter(IntPtr handle);

    [DllImport("winspool.drv", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool EnumPrintersW(int flags, string? name, int level, IntPtr buffer, int bufferSize, out int needed, out int returned);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool GetDefaultPrinterW(char[]? buffer, ref int size);
}
