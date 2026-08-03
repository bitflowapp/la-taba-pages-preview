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
    use super::{validate_pdf_print_request, validate_print_request, PrintRequest, PrinterInfo};
    use std::{ffi::c_void, path::Path, ptr};
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, OpenPrinterW, StartDocPrinterW,
        StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
        PRINTER_HANDLE, PRINTER_INFO_4W,
    };
    use windows_sys::Win32::UI::Shell::ShellExecuteW;

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
pub use windows_printing::{list_printers, print, print_pdf};

#[cfg(not(windows))]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    Ok(Vec::new())
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
}
