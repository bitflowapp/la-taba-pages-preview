using System.ComponentModel;
using System.Runtime.InteropServices;
using Taba.LocalAgent.Core.Printing;

namespace Taba.LocalAgent.Windows;

/// <summary>
/// Bytes crudos al spooler de Windows (tipo de dato «RAW»): el camino estándar
/// para ESC/POS con el driver de la impresora instalado.
///
/// Que el spooler acepte los bytes NO prueba que salió el papel: si la
/// impresora está apagada, Windows guarda el trabajo y lo imprime horas después.
/// Por eso, después de entregar, se sigue el trabajo en la cola de Windows: si
/// termina, está impreso; si queda en error o trabado, se cancela para que no
/// salga un ticket sorpresa y el resultado es «desconocido» (decide una persona).
/// </summary>
public sealed class WinSpoolRawTransport(TimeSpan? completionTimeout = null) : IRawPrinterTransport
{
    private readonly TimeSpan _timeout = completionTimeout ?? TimeSpan.FromSeconds(30);

    public Task<PrintOutcome> SendRawAsync(string printerName, ReadOnlyMemory<byte> payload, string documentTitle, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.Run(() => Send(printerName, payload.ToArray(), documentTitle), cancellationToken);
    }

    private PrintOutcome Send(string printerName, byte[] payload, string documentTitle)
    {
        if (!NativeMethods.OpenPrinterW(printerName, out var handle, IntPtr.Zero))
        {
            return PrintOutcome.NotSent(Marshal.GetLastWin32Error() == NativeMethods.ErrorInvalidPrinterName ? "PRINTER_NOT_FOUND" : "PRINTER_OPEN_FAILED");
        }

        try
        {
            var info = new NativeMethods.DocInfo1 { DocName = documentTitle, OutputFile = null, DataType = "RAW" };
            var jobId = NativeMethods.StartDocPrinterW(handle, 1, ref info);
            if (jobId == 0)
            {
                // Los drivers v4 (XPS) no aceptan RAW: la impresora necesita el modo Windows.
                return PrintOutcome.NotSent(Marshal.GetLastWin32Error() == NativeMethods.ErrorInvalidDatatype ? "PRINTER_RAW_UNSUPPORTED" : "PRINTER_START_FAILED");
            }

            var started = NativeMethods.StartPagePrinter(handle);
            var written = 0;
            var ok = started && NativeMethods.WritePrinter(handle, payload, payload.Length, out written) && written == payload.Length;
            if (!ok)
            {
                // Se descarta el trabajo del spooler. Si no se escribió nada, no
                // salió papel; si se escribió una parte, pudo haber salido.
                NativeMethods.AbortPrinter(handle);
                return written > 0 ? PrintOutcome.Unknown("PRINTER_WRITE_PARTIAL") : PrintOutcome.NotSent("PRINTER_WRITE_FAILED");
            }

            NativeMethods.EndPagePrinter(handle);
            if (!NativeMethods.EndDocPrinter(handle))
            {
                return PrintOutcome.Unknown("PRINTER_END_FAILED");
            }

            return SpoolerJobs.WaitForCompletion(handle, jobId, _timeout);
        }
        finally
        {
            NativeMethods.ClosePrinter(handle);
        }
    }
}

/// <summary>Seguimiento de un trabajo en la cola de Windows hasta que termina, falla o se traba.</summary>
internal static class SpoolerJobs
{
    private const int JobStatusError = 0x2;
    private const int JobStatusDeleting = 0x4;
    private const int JobStatusOffline = 0x20;
    private const int JobStatusPaperOut = 0x40;
    private const int JobStatusPrinted = 0x80;
    private const int JobStatusDeleted = 0x100;
    private const int JobStatusBlockedDevq = 0x200;
    private const int JobStatusUserIntervention = 0x400;
    private const int JobStatusComplete = 0x1000;
    private const int JobControlDelete = 5;

    public static PrintOutcome WaitForCompletion(IntPtr printer, int jobId, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (true)
        {
            var status = ReadStatus(printer, jobId);
            if (status is null)
            {
                // El trabajo ya no está en la cola: el spooler lo terminó.
                return PrintOutcome.Sent();
            }

            if ((status.Value & (JobStatusPrinted | JobStatusComplete)) != 0)
            {
                return PrintOutcome.Sent();
            }

            if ((status.Value & (JobStatusError | JobStatusOffline | JobStatusPaperOut | JobStatusBlockedDevq | JobStatusUserIntervention)) != 0)
            {
                Cancel(printer, jobId);
                return PrintOutcome.Unknown((status.Value & (JobStatusOffline | JobStatusPaperOut)) != 0 ? "PRINTER_OFFLINE_DURING_PRINT" : "PRINTER_JOB_ERROR");
            }

            if ((status.Value & (JobStatusDeleting | JobStatusDeleted)) != 0)
            {
                return PrintOutcome.Unknown("PRINTER_JOB_DELETED");
            }

            if (DateTime.UtcNow >= deadline)
            {
                Cancel(printer, jobId);
                return PrintOutcome.Unknown("PRINTER_JOB_STUCK");
            }

            Thread.Sleep(250);
        }
    }

    /// <summary>El id del trabajo que dejó un documento con este nombre (para lo que imprime el driver).</summary>
    public static int? FindJobId(IntPtr printer, string documentName)
    {
        NativeMethods.EnumJobsW(printer, 0, 256, 1, IntPtr.Zero, 0, out var needed, out _);
        if (needed <= 0)
        {
            return null;
        }

        var buffer = Marshal.AllocHGlobal(needed);
        try
        {
            if (!NativeMethods.EnumJobsW(printer, 0, 256, 1, buffer, needed, out _, out var returned))
            {
                return null;
            }

            var size = Marshal.SizeOf<NativeMethods.JobInfo1>();
            for (var i = 0; i < returned; i++)
            {
                var job = Marshal.PtrToStructure<NativeMethods.JobInfo1>(buffer + (i * size));
                if (string.Equals(job.Document, documentName, StringComparison.Ordinal))
                {
                    return job.JobId;
                }
            }

            return null;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static int? ReadStatus(IntPtr printer, int jobId)
    {
        NativeMethods.GetJobW(printer, jobId, 1, IntPtr.Zero, 0, out var needed);
        if (needed <= 0)
        {
            return null;
        }

        var buffer = Marshal.AllocHGlobal(needed);
        try
        {
            if (!NativeMethods.GetJobW(printer, jobId, 1, buffer, needed, out _))
            {
                return null;
            }

            return Marshal.PtrToStructure<NativeMethods.JobInfo1>(buffer).Status;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static void Cancel(IntPtr printer, int jobId) => NativeMethods.SetJobW(printer, jobId, 0, IntPtr.Zero, JobControlDelete);
}

/// <summary>Impresoras locales y conectadas, con la predeterminada marcada y su estado.</summary>
public sealed class WinSpoolPrinterCatalog : IPrinterCatalog
{
    private const int PrinterEnumLocal = 0x2;
    private const int PrinterEnumConnections = 0x4;
    private const int StatusPaused = 0x1;
    private const int StatusErrors = 0x2 | 0x8 | 0x10 | 0x40 | 0x800 | 0x1000 | 0x40000 | 0x100000 | 0x400000;
    private const int StatusOffline = 0x80 | 0x800000;
    private const int AttributeWorkOffline = 0x400;

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
                    printers.Add(new PrinterDescriptor(info.PrinterName, string.Equals(info.PrinterName, defaultName, StringComparison.Ordinal), GetState(info.PrinterName)));
                }
            }

            return printers;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>
    /// Estado según el spooler. Muchas térmicas USB con driver genérico no
    /// informan nada: eso es «Ready», y el seguimiento del trabajo decide.
    /// </summary>
    public PrinterState GetState(string printerName)
    {
        if (string.IsNullOrWhiteSpace(printerName))
        {
            return PrinterState.NotFound;
        }

        if (!NativeMethods.OpenPrinterW(printerName, out var handle, IntPtr.Zero))
        {
            return Marshal.GetLastWin32Error() == NativeMethods.ErrorInvalidPrinterName ? PrinterState.NotFound : PrinterState.Unknown;
        }

        try
        {
            NativeMethods.GetPrinterW(handle, 2, IntPtr.Zero, 0, out var needed);
            if (needed <= 0)
            {
                return PrinterState.Unknown;
            }

            var buffer = Marshal.AllocHGlobal(needed);
            try
            {
                if (!NativeMethods.GetPrinterW(handle, 2, buffer, needed, out _))
                {
                    return PrinterState.Unknown;
                }

                var info = Marshal.PtrToStructure<NativeMethods.PrinterInfo2>(buffer);
                if ((info.Attributes & AttributeWorkOffline) != 0 || (info.Status & StatusOffline) != 0)
                {
                    return PrinterState.Offline;
                }

                if ((info.Status & StatusPaused) != 0)
                {
                    return PrinterState.Paused;
                }

                return (info.Status & StatusErrors) != 0 ? PrinterState.Error : PrinterState.Ready;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        finally
        {
            NativeMethods.ClosePrinter(handle);
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

internal static partial class NativeMethods
{
    public const int ErrorInvalidPrinterName = 1801;
    public const int ErrorInvalidDatatype = 1804;

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

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct PrinterInfo2
    {
        public IntPtr ServerName;
        public IntPtr PrinterName;
        public IntPtr ShareName;
        public IntPtr PortName;
        public IntPtr DriverName;
        public IntPtr Comment;
        public IntPtr Location;
        public IntPtr DevMode;
        public IntPtr SepFile;
        public IntPtr PrintProcessor;
        public IntPtr Datatype;
        public IntPtr Parameters;
        public IntPtr SecurityDescriptor;
        public int Attributes;
        public int Priority;
        public int DefaultPriority;
        public int StartTime;
        public int UntilTime;
        public int Status;
        public int Jobs;
        public int AveragePpm;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct JobInfo1
    {
        public int JobId;
        public IntPtr PrinterName;
        public IntPtr MachineName;
        public IntPtr UserName;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string? Document;
        public IntPtr Datatype;
        public IntPtr StatusText;
        public int Status;
        public int Priority;
        public int Position;
        public int TotalPages;
        public int PagesPrinted;
        public SystemTime Submitted;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct SystemTime
    {
        public ushort Year;
        public ushort Month;
        public ushort DayOfWeek;
        public ushort Day;
        public ushort Hour;
        public ushort Minute;
        public ushort Second;
        public ushort Milliseconds;
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
    internal static extern bool AbortPrinter(IntPtr handle);

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
    internal static extern bool GetPrinterW(IntPtr handle, int level, IntPtr buffer, int bufferSize, out int needed);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool GetJobW(IntPtr handle, int jobId, int level, IntPtr buffer, int bufferSize, out int needed);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool SetJobW(IntPtr handle, int jobId, int level, IntPtr buffer, int command);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool EnumJobsW(IntPtr handle, int firstJob, int count, int level, IntPtr buffer, int bufferSize, out int needed, out int returned);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    internal static extern bool GetDefaultPrinterW(char[]? buffer, ref int size);
}
