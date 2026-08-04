use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrintRequest {
    pub printer_name: String,
    pub title: String,
    pub content: String,
    pub format: String,
}

/// Lo que Windows realmente informa de una impresora. Sin banderas conocidas se
/// devuelve `reachable: None` para que el panel diga "no verificable" en vez de inventar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterProbe {
    pub name: String,
    pub reachable: Option<bool>,
    pub out_of_paper: bool,
    pub error: bool,
    pub queued_jobs: u32,
}

// Banderas de PRINTER_INFO_2W.Status documentadas por Windows.
const PRINTER_STATUS_PAUSED: u32 = 0x0000_0001;
const PRINTER_STATUS_ERROR: u32 = 0x0000_0002;
const PRINTER_STATUS_PAPER_JAM: u32 = 0x0000_0008;
const PRINTER_STATUS_PAPER_OUT: u32 = 0x0000_0010;
const PRINTER_STATUS_PAPER_PROBLEM: u32 = 0x0000_0040;
const PRINTER_STATUS_OFFLINE: u32 = 0x0000_0080;
const PRINTER_STATUS_OUT_OF_MEMORY: u32 = 0x0000_0200;
const PRINTER_STATUS_DOOR_OPEN: u32 = 0x0000_0400;
const PRINTER_STATUS_NOT_AVAILABLE: u32 = 0x0000_1000;
const PRINTER_STATUS_NO_TONER: u32 = 0x0004_0000;
const PRINTER_STATUS_USER_INTERVENTION: u32 = 0x0010_0000;

const UNREACHABLE_MASK: u32 =
    PRINTER_STATUS_OFFLINE | PRINTER_STATUS_NOT_AVAILABLE | PRINTER_STATUS_PAUSED;
const PAPER_MASK: u32 = PRINTER_STATUS_PAPER_OUT | PRINTER_STATUS_PAPER_PROBLEM;
const ERROR_MASK: u32 = PRINTER_STATUS_ERROR
    | PRINTER_STATUS_PAPER_JAM
    | PRINTER_STATUS_OUT_OF_MEMORY
    | PRINTER_STATUS_DOOR_OPEN
    | PRINTER_STATUS_NO_TONER
    | PRINTER_STATUS_USER_INTERVENTION;

pub fn classify_printer_status(name: &str, status: u32, queued_jobs: u32) -> PrinterProbe {
    let unreachable = status & UNREACHABLE_MASK != 0;
    PrinterProbe {
        name: name.to_string(),
        reachable: Some(!unreachable),
        out_of_paper: !unreachable && status & PAPER_MASK != 0,
        error: !unreachable && status & ERROR_MASK != 0,
        queued_jobs,
    }
}

pub fn validate_print_request(request: &PrintRequest) -> Result<(), String> {
    if request.printer_name.trim().is_empty() || request.printer_name.len() > 260 {
        return Err("Seleccioná una impresora válida.".into());
    }
    if request.title.trim().is_empty() || request.title.len() > 120 {
        return Err("El trabajo de impresión requiere un título válido.".into());
    }
    if request.format != "raw_text" {
        return Err("La impresión nativa directa admite únicamente raw_text para impresoras térmicas comunes.".into());
    }
    if request.content.is_empty() || request.content.len() > 1_000_000 {
        return Err("El contenido de impresión está vacío o excede el límite.".into());
    }
    Ok(())
}

pub fn validate_pdf_print_request(
    path: &Path,
    printer_name: &str,
    title: &str,
    copies: u8,
) -> Result<(), String> {
    if printer_name.trim().is_empty()
        || printer_name.len() > 260
        || title.trim().is_empty()
        || title.len() > 120
        || !(1..=5).contains(&copies)
    {
        return Err("Solicitud de impresión PDF inválida.".into());
    }
    let metadata = std::fs::metadata(path)
        .map_err(|_| "El PDF fiscal local no está disponible.".to_string())?;
    if metadata.len() == 0
        || metadata.len() > 16_777_216
        || path.extension().and_then(|value| value.to_str()) != Some("pdf")
    {
        return Err("El PDF fiscal local no es válido.".into());
    }
    Ok(())
}

#[cfg(windows)]
mod windows_printing {
    use super::{
        classify_printer_status, validate_pdf_print_request, validate_print_request, PrintRequest,
        PrinterInfo, PrinterProbe,
    };
    use std::{ffi::c_void, path::Path, ptr};
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetPrinterW, OpenPrinterW,
        StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS,
        PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_2W, PRINTER_INFO_4W,
    };
    use windows_sys::Win32::UI::Shell::ShellExecuteW;

    pub fn probe_printer(printer_name: &str) -> Result<PrinterProbe, String> {
        if printer_name.trim().is_empty() || printer_name.len() > 260 {
            return Err("Seleccioná una impresora válida.".into());
        }
        let name = wide(printer_name);
        let mut handle = PRINTER_HANDLE::default();
        let opened = unsafe { OpenPrinterW(name.as_ptr(), &mut handle, ptr::null()) };
        if opened == 0 {
            return Ok(PrinterProbe {
                name: printer_name.to_string(),
                reachable: Some(false),
                out_of_paper: false,
                error: false,
                queued_jobs: 0,
            });
        }
        let mut needed = 0_u32;
        unsafe { GetPrinterW(handle, 2, ptr::null_mut(), 0, &mut needed) };
        if needed == 0 {
            unsafe { ClosePrinter(handle) };
            // Windows no informó nada: se devuelve desconocido en lugar de suponer que anda.
            return Ok(PrinterProbe {
                name: printer_name.to_string(),
                reachable: None,
                out_of_paper: false,
                error: false,
                queued_jobs: 0,
            });
        }
        let mut buffer = vec![0_u8; needed as usize];
        let ok = unsafe { GetPrinterW(handle, 2, buffer.as_mut_ptr(), needed, &mut needed) };
        unsafe { ClosePrinter(handle) };
        if ok == 0 {
            return Ok(PrinterProbe {
                name: printer_name.to_string(),
                reachable: None,
                out_of_paper: false,
                error: false,
                queued_jobs: 0,
            });
        }
        let record = unsafe { &*(buffer.as_ptr() as *const PRINTER_INFO_2W) };
        Ok(classify_printer_status(
            printer_name,
            record.Status,
            record.cJobs,
        ))
    }

    pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
        let mut needed = 0_u32;
        let mut returned = 0_u32;
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        unsafe {
            EnumPrintersW(
                flags,
                ptr::null(),
                4,
                ptr::null_mut(),
                0,
                &mut needed,
                &mut returned,
            );
        }
        if needed == 0 {
            return Ok(Vec::new());
        }
        let mut buffer = vec![0_u8; needed as usize];
        let ok = unsafe {
            EnumPrintersW(
                flags,
                ptr::null(),
                4,
                buffer.as_mut_ptr(),
                needed,
                &mut needed,
                &mut returned,
            )
        };
        if ok == 0 {
            return Err("Windows no pudo enumerar las impresoras instaladas.".into());
        }
        let records = unsafe {
            std::slice::from_raw_parts(buffer.as_ptr() as *const PRINTER_INFO_4W, returned as usize)
        };
        let mut printers: Vec<PrinterInfo> = records
            .iter()
            .filter_map(|record| wide_string(record.pPrinterName).ok())
            .filter(|name| !name.trim().is_empty())
            .map(|name| PrinterInfo {
                name,
                is_default: false,
            })
            .collect();
        printers.sort_by_key(|printer| printer.name.to_lowercase());
        printers.dedup_by(|left, right| left.name.eq_ignore_ascii_case(&right.name));
        Ok(printers)
    }

    pub fn print(request: &PrintRequest) -> Result<(), String> {
        validate_print_request(request)?;
        let printer_name = wide(&request.printer_name);
        let document_name = wide(&request.title);
        let data_type = wide("RAW");
        let mut handle = PRINTER_HANDLE::default();
        let opened = unsafe { OpenPrinterW(printer_name.as_ptr(), &mut handle, ptr::null()) };
        if opened == 0 {
            return Err("No se pudo abrir la impresora seleccionada.".into());
        }
        let info = DOC_INFO_1W {
            pDocName: document_name.as_ptr() as *mut u16,
            pOutputFile: ptr::null_mut(),
            pDatatype: data_type.as_ptr() as *mut u16,
        };
        let job = unsafe { StartDocPrinterW(handle, 1, &info) };
        if job == 0 {
            unsafe { ClosePrinter(handle) };
            return Err("La cola de impresión rechazó el trabajo.".into());
        }
        let started = unsafe { StartPagePrinter(handle) };
        if started == 0 {
            unsafe {
                EndDocPrinter(handle);
                ClosePrinter(handle);
            }
            return Err("No se pudo iniciar la página de impresión.".into());
        }
        let bytes = request.content.as_bytes();
        let mut written = 0_u32;
        let wrote = unsafe {
            WritePrinter(
                handle,
                bytes.as_ptr() as *const c_void,
                bytes.len() as u32,
                &mut written,
            )
        };
        unsafe {
            EndPagePrinter(handle);
            EndDocPrinter(handle);
            ClosePrinter(handle);
        }
        if wrote == 0 || written as usize != bytes.len() {
            return Err("La impresora no confirmó todos los bytes del trabajo.".into());
        }
        Ok(())
    }

    pub fn print_pdf(
        path: &Path,
        printer_name: &str,
        title: &str,
        copies: u8,
    ) -> Result<(), String> {
        validate_pdf_print_request(path, printer_name, title, copies)?;
        let operation = wide("printto");
        let file_name = wide(&path.to_string_lossy());
        let printer = wide(printer_name);
        for _ in 0..copies {
            let result = unsafe {
                ShellExecuteW(
                    ptr::null_mut(),
                    operation.as_ptr(),
                    file_name.as_ptr(),
                    printer.as_ptr(),
                    ptr::null(),
                    0,
                )
            };
            if result as isize <= 32 {
                return Err("Windows no pudo entregar el PDF al controlador de impresión.".into());
            }
        }
        Ok(())
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn wide_string(pointer: *mut u16) -> Result<String, String> {
        if pointer.is_null() {
            return Err("Nombre de impresora ausente.".into());
        }
        let mut length = 0_usize;
        unsafe {
            while *pointer.add(length) != 0 && length < 32_768 {
                length += 1;
            }
        }
        if length == 32_768 {
            return Err("Nombre de impresora fuera de rango.".into());
        }
        Ok(String::from_utf16_lossy(unsafe {
            std::slice::from_raw_parts(pointer, length)
        }))
    }
}

#[cfg(windows)]
pub use windows_printing::{list_printers, print, print_pdf, probe_printer};

#[cfg(not(windows))]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    Ok(Vec::new())
}

#[cfg(not(windows))]
pub fn probe_printer(printer_name: &str) -> Result<PrinterProbe, String> {
    if printer_name.trim().is_empty() || printer_name.len() > 260 {
        return Err("Seleccioná una impresora válida.".into());
    }
    Ok(PrinterProbe {
        name: printer_name.to_string(),
        reachable: None,
        out_of_paper: false,
        error: false,
        queued_jobs: 0,
    })
}

#[cfg(not(windows))]
pub fn print(request: &PrintRequest) -> Result<(), String> {
    validate_print_request(request)?;
    Err("La impresión nativa de esta entrega está disponible únicamente en Windows.".into())
}

#[cfg(not(windows))]
pub fn print_pdf(path: &Path, printer_name: &str, title: &str, copies: u8) -> Result<(), String> {
    validate_pdf_print_request(path, printer_name, title, copies)?;
    Err("La impresión PDF nativa de esta entrega está disponible únicamente en Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn print_contract_rejects_unknown_formats() {
        let request = PrintRequest {
            printer_name: "Printer".into(),
            title: "Ticket".into(),
            content: "ok".into(),
            format: "pdf".into(),
        };
        assert!(validate_print_request(&request).is_err());
    }

    #[test]
    fn print_contract_accepts_bounded_raw_text() {
        let request = PrintRequest {
            printer_name: "Printer".into(),
            title: "Ticket".into(),
            content: "TABA".into(),
            format: "raw_text".into(),
        };
        assert!(validate_print_request(&request).is_ok());
    }

    #[test]
    fn printer_probe_reports_ready_printer_with_pending_jobs() {
        let probe = classify_printer_status("EPSON TM-T20", 0, 3);
        assert_eq!(probe.reachable, Some(true));
        assert!(!probe.out_of_paper);
        assert!(!probe.error);
        assert_eq!(probe.queued_jobs, 3);
    }

    #[test]
    fn printer_probe_separates_out_of_paper_from_a_generic_error() {
        let paper = classify_printer_status("EPSON TM-T20", PRINTER_STATUS_PAPER_OUT, 0);
        assert!(paper.out_of_paper);
        assert!(!paper.error);

        let jam = classify_printer_status("EPSON TM-T20", PRINTER_STATUS_PAPER_JAM, 0);
        assert!(jam.error);
        assert!(!jam.out_of_paper);
    }

    #[test]
    fn printer_probe_treats_offline_or_paused_as_unreachable_without_guessing_the_cause() {
        for status in [
            PRINTER_STATUS_OFFLINE,
            PRINTER_STATUS_NOT_AVAILABLE,
            PRINTER_STATUS_PAUSED,
            PRINTER_STATUS_OFFLINE | PRINTER_STATUS_PAPER_OUT,
        ] {
            let probe = classify_printer_status("EPSON TM-T20", status, 0);
            assert_eq!(probe.reachable, Some(false), "status {status:#x}");
            assert!(!probe.out_of_paper, "status {status:#x}");
            assert!(!probe.error, "status {status:#x}");
        }
    }

    #[test]
    fn printer_probe_rejects_an_empty_or_oversized_printer_name() {
        assert!(probe_printer("   ").is_err());
        assert!(probe_printer(&"x".repeat(300)).is_err());
    }
}
