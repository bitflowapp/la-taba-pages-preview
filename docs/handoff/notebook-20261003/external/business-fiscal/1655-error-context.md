[HISTÓRICO REDACTADO PARA HANDOFF: líneas de credenciales/configuración excluidas; original intacto en notebook.]

# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: business-windows-operations.spec.mjs >> panel fiscal usa artefactos privados, descarga, reimpresiÃ³n y nota de crÃ©dito fixture
- Location: tests\e2e\business-windows-operations.spec.mjs:49:1

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: page.waitForEvent: Test timeout of 45000ms exceeded.
=========================== logs ===========================
waiting for event "download"
============================================================
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - button "Ir al inicio del comercio" [ref=e4] [cursor=pointer]:
      - strong [ref=e6]: TABA E2E
    - generic [ref=e8]:
      - generic [ref=e9]:
        - generic [ref=e10]: OPERACIÓN DEL LOCAL
        - strong [ref=e11]: La Taba 2
      - button "Sólo este equipo" [ref=e12] [cursor=pointer]
  - main [ref=e13]:
    - generic [ref=e15]:
      - generic [ref=e16]:
        - generic [ref=e17]:
          - paragraph [ref=e18]: Operación segura
          - heading "Centro operativo del negocio" [level=1] [ref=e19]
          - paragraph [ref=e20]: Empleado · sesión verificada
          - generic [ref=e21]:
            - strong [ref=e22]: Conectado
            - generic [ref=e23]: "Última sincronización: 4/8, 02:49 p. m."
          - generic [ref=e24]:
            - strong [ref=e25]: Conectado
            - generic [ref=e26]: "Última reconciliación: 4/8, 02:49 p. m."
            - generic [ref=e27]: 0 comandos pendientes
        - button "Cerrar sesión" [ref=e28] [cursor=pointer]
      - navigation "Áreas operativas" [ref=e29]:
        - button "Centro de operación" [ref=e30] [cursor=pointer]
        - button "Pedidos" [ref=e31] [cursor=pointer]
        - button "Escáner" [ref=e32] [cursor=pointer]
        - button "Inventario" [ref=e33] [cursor=pointer]
        - button "Preparación" [ref=e34] [cursor=pointer]
        - button "Mostrador" [ref=e35] [cursor=pointer]
        - button "Fiscal" [ref=e36] [cursor=pointer]
        - button "Configuración" [ref=e37] [cursor=pointer]
      - generic [ref=e38]:
        - navigation "Herramientas operativas" [ref=e39]:
          - button "Centro de operación" [ref=e40] [cursor=pointer]
          - button "Escáner rápido" [ref=e41] [cursor=pointer]
          - button "Alta de producto" [ref=e42] [cursor=pointer]
          - button "Recepción" [ref=e43] [cursor=pointer]
          - button "Ajuste" [ref=e44] [cursor=pointer]
          - button "Conteo físico" [ref=e45] [cursor=pointer]
          - button "Preparación" [ref=e46] [cursor=pointer]
          - button "Mostrador" [ref=e47] [cursor=pointer]
          - button "Estado fiscal" [pressed] [ref=e48] [cursor=pointer]
          - button "Configuración fiscal" [ref=e49] [cursor=pointer]
        - status [ref=e50]: Descarga privada iniciada. Si el enlace vence, solicitá uno nuevo.
        - generic [ref=e51]:
          - generic [ref=e53]:
            - paragraph [ref=e54]: Centro operativo
            - heading "Estado fiscal" [level=2] [ref=e55]
            - paragraph [ref=e56]: Autorizado sólo cuando ARCA devolvió CAE válido. La autorización y el PDF se recuperan por separado.
          - generic [ref=e57]:
            - button "Actualizar" [ref=e58] [cursor=pointer]
            - button "Abrir caché de impresión" [ref=e59] [cursor=pointer]
          - generic [ref=e60]:
            - generic [ref=e61]:
              - strong [ref=e62]: Vista previa privada
              - button "Cerrar" [ref=e63] [cursor=pointer]
            - iframe [ref=e64]
            - generic [ref=e65]: El acceso temporal vence automáticamente; el PDF no se guarda en el navegador.
          - article [ref=e66]:
            - generic [ref=e67]:
              - strong [ref=e68]: Factura autorizada
              - generic [ref=e69]: Comprobante 11 42
            - generic [ref=e70]: authorized
            - generic [ref=e71]: PDF disponible
            - generic [ref=e72]:
              - generic "SHA-256" [ref=e73]: SHA-256 aaaaaaaaaaaa…aaaaaaaa
              - button "Vista previa" [ref=e74] [cursor=pointer]
              - button "Descargar PDF" [ref=e75] [cursor=pointer]
              - generic [ref=e76]:
                - generic [ref=e77]:
                  - text: Impresora
                  - combobox "Impresora" [ref=e78]:
                    - option "Printer Fixture (predeterminada)" [selected]
                - generic [ref=e79]:
                  - text: Formato
                  - combobox "Formato" [ref=e80]:
                    - option "A4 (PDF)" [selected]
                    - option "Térmica"
                - generic [ref=e81]:
                  - text: Copias
                  - spinbutton "Copias" [ref=e82]: "1"
                - button "Imprimir / reimprimir" [ref=e83] [cursor=pointer]
            - group [ref=e84]:
              - generic "Solicitar nota de crédito" [ref=e85] [cursor=pointer]
              - option "Total del saldo acreditable" [selected]
              - option "Parcial por ítem/cantidad"
              - option "Ajuste comercial autorizado"
          - article [ref=e86]:
            - generic [ref=e87]:
              - strong [ref=e88]: Factura autorizada
              - generic [ref=e89]: Nota de crédito 13 43
              - generic [ref=e90]: Asociado a comprobante aaaaaaaa
            - generic [ref=e91]: authorized
            - generic [ref=e92]: PDF disponible
            - generic [ref=e93]:
              - generic "SHA-256" [ref=e94]: SHA-256 bbbbbbbbbbbb…bbbbbbbb
              - button "Vista previa" [ref=e95] [cursor=pointer]
              - button "Descargar PDF" [ref=e96] [cursor=pointer]
              - generic [ref=e97]:
                - generic [ref=e98]:
                  - text: Impresora
                  - combobox "Impresora" [ref=e99]:
                    - option "Printer Fixture (predeterminada)" [selected]
                - generic [ref=e100]:
                  - text: Formato
                  - combobox "Formato" [ref=e101]:
                    - option "A4 (PDF)" [selected]
                    - option "Térmica"
                - generic [ref=e102]:
                  - text: Copias
                  - spinbutton "Copias" [ref=e103]: "1"
                - button "Imprimir / reimprimir" [ref=e104] [cursor=pointer]
          - article [ref=e105]:
            - generic [ref=e106]:
              - strong [ref=e107]: Comprobante fiscal pendiente
              - generic [ref=e108]: Comprobante 11 44
            - generic [ref=e109]: ambiguous
            - generic [ref=e110]: PDF fallido
            - generic [ref=e111]: El snapshot autorizado no estÃ¡ completo.
          - article [ref=e112]:
            - generic [ref=e113]:
              - strong [ref=e114]: Factura autorizada
              - generic [ref=e115]: Comprobante 11 45
            - generic [ref=e116]: authorized
            - generic [ref=e117]: PDF pendiente
            - button "Regenerar PDF (permiso)" [ref=e118] [cursor=pointer]
            - group [ref=e119]:
              - generic "Solicitar nota de crédito" [ref=e120] [cursor=pointer]
              - option "Total del saldo acreditable" [selected]
              - option "Parcial por ítem/cantidad"
              - option "Ajuste comercial autorizado"
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | 
  3   | const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
  4   | const STAFF_ID = '22222222-2222-4222-8222-222222222222';
  5   | const PRODUCT_ID = '55555555-5555-4555-8555-555555555555';
  6   | const SUPABASE_URL = 'https://taba-business-windows-e2e.supabase.co';
  7   | 
  8   | test('panel Windows recorre las nueve herramientas, detecta GTIN y conserva la venta si falla fiscal', async ({ page }) => {
  9   |   const session = staffSession();
  10  |   await installRuntime(page, session);
  11  |   await page.goto('/#business');
  12  | 
  13  |   const workspace = page.locator('[data-production-workspace="business"]');
  14  |   await expect(workspace).toBeVisible();
  15  | 
  16  |   await workspace.locator('[data-business-ops-view="scanner"]').first().click();
  17  |   await expect(workspace.locator('[data-business-ops-center="scanner"]')).toBeVisible();
  18  |   await workspace.locator('[data-barcode-input]').fill('4006381333931');
  19  |   await workspace.locator('[data-business-scan-test]').click();
  20  |   await expect(workspace.locator('.business-scan-result')).toContainText('Producto E2E');
  21  |   await expect(workspace.locator('.business-scan-result')).toContainText('EAN-13');
  22  |   await expect(workspace.locator('.business-scan-result')).toContainText('Pack de 6');
  23  | 
  24  |   const views = [
  25  |     ['product-create', 'Alta de producto'],
  26  |     ['inventory-receive', 'Recepción de mercadería'],
  27  |     ['inventory-adjust', 'Ajuste de stock'],
  28  |     ['stock-count', 'Conteo físico'],
  29  |     ['packing', 'Preparación de pedido'],
  30  |     ['fiscal-status', 'Estado fiscal'],
  31  |     ['fiscal-config', 'Configuración fiscal'],
  32  |   ];
  33  |   for (const [view, heading] of views) {
  34  |     await workspace.locator(`[data-business-ops-view="${view}"]`).first().click();
  35  |     await expect(workspace.locator(`[data-business-ops-center="${view}"]`)).toBeVisible();
  36  |     await expect(workspace.getByRole('heading', { name: heading })).toBeVisible();
  37  |   }
  38  | 
  39  |   await workspace.locator('[data-business-ops-view="pos"]').first().click();
  40  |   await expect(workspace.locator('[data-business-ops-center="pos"]')).toBeVisible();
  41  |   await workspace.locator('[data-barcode-input]').fill('7894900011517');
  42  |   await workspace.locator('[data-business-scan-test]').click();
  43  |   await expect(workspace.locator('.business-ops-cart')).toContainText('Producto E2E');
  44  |   await workspace.locator('[name="requestFiscal"]').check();
  45  |   await workspace.locator('[data-pos-checkout]').click();
  46  |   await expect(workspace.locator('.business-ops-feedback')).toContainText('Venta confirmada; la solicitud fiscal requiere revisión.');
  47  | });
  48  | 
  49  | test('panel fiscal usa artefactos privados, descarga, reimpresiÃ³n y nota de crÃ©dito fixture', async ({ page }) => {
  50  |   const invoiceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  51  |   const creditId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  52  |   const pendingId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  53  |   const regenerateId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  54  |   const invoiceArtifactId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  55  |   const creditArtifactId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  56  |   const session = staffSession();
  57  |   await installRuntime(page, session, {
  58  |     desktop: true,
  59  |     profile: { environment: 'homologation', accountant_review_status: 'approved', production_gate_status: 'blocked', is_enabled: true },
  60  |     documents: [
  61  |       fiscalFixture({ id: invoiceId, document_intent: 'invoice', document_type: 11, document_number: 42, state: 'authorized', artifact_state: 'artifact_ready', cae: '12345678901234', fiscal_document_items: [{ id: 'f1111111-1111-4111-8111-111111111111', description: 'Producto fiscal fixture', quantity: 2, unit_price: 50, net_amount: 100, tax_amount: 21, tax_code: '5', exempt_amount: 0, non_taxed_amount: 0, other_taxes_amount: 0 }] }),
  62  |       fiscalFixture({ id: creditId, document_intent: 'credit_note', document_type: 13, document_number: 43, state: 'authorized', artifact_state: 'artifact_ready', cae: '43210987654321', associated_document_id: invoiceId, credit_kind: 'partial' }),
  63  |       fiscalFixture({ id: pendingId, document_intent: 'invoice', document_type: 11, document_number: 44, state: 'ambiguous', artifact_state: 'artifact_failed', artifact_error_code: 'ARTIFACT_SOURCE_INCOMPLETE', artifact_error_message: 'El snapshot autorizado no estÃ¡ completo.' }),
  64  |       fiscalFixture({ id: regenerateId, document_intent: 'invoice', document_type: 11, document_number: 45, state: 'authorized', artifact_state: 'artifact_pending', cae: '98765432101234' }),
  65  |     ],
  66  |     artifacts: [
  67  |       { artifact_id: invoiceArtifactId, fiscal_document_id: invoiceId, artifact_type: 'authorized_pdf', mime_type: 'application/pdf', size_bytes: 42, sha256: 'a'.repeat(64), document_number: 42, generation_version: 'fixture-v1', generated_at: '2026-08-02T12:00:00Z', is_current: true },
  68  |       { artifact_id: creditArtifactId, fiscal_document_id: creditId, artifact_type: 'authorized_pdf', mime_type: 'application/pdf', size_bytes: 42, sha256: 'b'.repeat(64), document_number: 43, generation_version: 'fixture-v1', generated_at: '2026-08-02T12:00:00Z', is_current: true },
  69  |     ],
  70  |     regenerationFailure: 'owner/admin requerido para regenerar',
  71  |   });
  72  |   await page.goto('/#business');
  73  |   const workspace = page.locator('[data-production-workspace="business"]');
  74  |   await workspace.locator('[data-business-ops-view="fiscal-status"]').first().click();
  75  |   const invoice = workspace.locator(`article[data-fiscal-document="${invoiceId}"]`);
  76  |   await expect(invoice).toContainText('PDF disponible');
  77  |   await expect(invoice).toContainText('SHA-256 aaaaaaaa');
  78  |   await expect(workspace.locator(`article[data-fiscal-document="${creditId}"]`)).toContainText(/Nota de cr.dito/);
  79  |   await expect(workspace.locator(`article[data-fiscal-document="${pendingId}"]`)).toContainText('PDF fallido');
  80  | 
  81  |   await invoice.locator(`[data-fiscal-preview="${invoiceArtifactId}"]`).click();
  82  |   await expect(workspace.locator('[data-fiscal-preview-surface]')).toBeVisible();
  83  |   await expect(workspace.locator('[data-fiscal-preview-surface] iframe')).toHaveAttribute('src', 'https://signed.example.invalid/document.pdf');
  84  | 
> 85  |   const downloadPromise = page.waitForEvent('download');
      |                                ^ Error: page.waitForEvent: Test timeout of 45000ms exceeded.
  86  |   await invoice.locator(`[data-fiscal-download="${invoiceArtifactId}"]`).click();
  87  |   const download = await downloadPromise;
  88  |   expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  89  | 
  90  |   page.once('dialog', (dialog) => dialog.accept());
  91  |   await invoice.locator('[name="fiscalPrinter"]').selectOption('Printer Fixture');
  92  |   await invoice.locator('[data-fiscal-print]').click();
  93  |   await expect(workspace.locator('.business-ops-feedback')).toContainText('spooler');
  94  | 
  95  |   await invoice.locator('summary').click();
  96  |   await invoice.locator('[name="creditReason"]').fill('DevoluciÃ³n parcial sintÃ©tica');
  97  |   await invoice.locator('[name="creditKind"]').selectOption('partial');
  98  |   await workspace.locator('[data-fiscal-refresh]').click();
  99  |   await expect(invoice.locator('details.business-fiscal-credit')).toHaveAttribute('open', '');
  100 |   await expect(invoice.locator('[name="creditReason"]')).toHaveValue('DevoluciÃ³n parcial sintÃ©tica');
  101 |   await expect(invoice.locator('[name="creditKind"]')).toHaveValue('partial');
  102 |   await invoice.locator('[data-credit-line] [name="creditQuantity"]').fill('1');
  103 |   await invoice.locator('[data-fiscal-credit-note]').click();
  104 |   await expect(workspace.locator('.business-ops-feedback')).toContainText(/Nota de cr.dito solicitada/);
  105 | 
  106 |   await workspace.locator(`[data-fiscal-regenerate="${regenerateId}"]`).click();
  107 |   await expect(workspace.locator('.business-ops-feedback')).toContainText('owner/admin requerido');
  108 | });
  109 | 
  110 | test('Centro de operación prioriza alertas y finaliza un cierre diario auditable', async ({ page }) => {
  111 |   const session = staffSession('owner');
  112 |   await installRuntime(page, session, { desktop: true, operationCenter: operationCenterFixture() });
  113 |   await page.goto('/#business');
  114 |   const workspace = page.locator('[data-production-workspace="business"]');
  115 |   const center = workspace.locator('[data-business-ops-center="operation-center"]');
  116 |   await expect(center).toBeVisible();
  117 |   await expect(center.getByRole('heading', { name: 'Centro de operación' })).toBeVisible();
  118 |   await expect(center.locator('[data-operation-metric="new_orders"]')).toContainText('2');
  119 |   await expect(center.locator('[data-operation-metric="reconciliations_required"]')).toContainText('1');
  120 |   await expect(center.locator('[data-operational-alert]')).toContainText('Pago aprobado sin pedido operativo');
  121 |   await expect(center.locator('[data-operational-alert]')).toContainText('no cobrar nuevamente');
  122 | 
  123 |   await center.locator('[data-operational-alert-acknowledge]').click();
  124 |   await expect(workspace.locator('.business-ops-feedback')).toContainText('Alerta reconocida');
  125 | 
  126 |   await center.locator('[name="dailyDeclaredCash"]').fill('900');
  127 |   await center.locator('[name="dailyDifferenceNote"]').fill('Diferencia recontada y documentada por caja.');
  128 |   await center.locator('[data-daily-reconciliation-prepare]').click();
  129 |   await expect(workspace.locator('.business-ops-feedback')).toContainText('Conciliación preparada');
  130 | 
  131 |   await center.locator('[data-daily-reconciliation-close]').click();
  132 |   await expect(workspace.locator('.business-ops-feedback')).toContainText('Cierre diario finalizado e inmutable');
  133 | 
  134 |   await center.locator('[data-local-backup-create]').click();
  135 |   await expect(workspace.locator('.business-ops-feedback')).toContainText('Backup local consistente y verificado');
  136 |   await center.locator('[data-support-diagnostic-export]').click();
  137 |   await expect(workspace.locator('.business-ops-feedback')).toContainText('Diagnóstico sanitizado exportado');
  138 |   await center.locator('[data-signed-update-check]').click();
  139 |   await expect(workspace.locator('.business-ops-feedback')).toContainText('no tiene un canal de actualizaciones firmado');
  140 | });
  141 | 
  142 | async function installRuntime(page, session, fiscal = null) {
  143 |   await page.route(`${SUPABASE_URL}/**`, async (route) => {
  144 |     const url = new URL(route.request().url());
  145 |     if (url.pathname.endsWith('/auth/v1/user')) return json(route, session.user);
  146 |     if (url.pathname.includes('/auth/v1/token')) return json(route, session);
  147 |     if (url.pathname.includes('/rest/v1/business_members')) return json(route, { business_id: BUSINESS_ID, user_id: STAFF_ID, role: session.fixtureRole || 'staff', is_active: true });
  148 |     if (url.pathname.includes('/rest/v1/businesses')) return json(route, businessFixture());
  149 |     if (url.pathname.includes('/rest/v1/product_barcodes')) return json(route, barcodeFixture(url.searchParams.get('gtin') || ''));
  150 |     if (url.pathname.includes('/functions/v1/fiscal-artifact-access')) return json(route, fiscal?.artifactAccess || { signedUrl: 'https://signed.example.invalid/document.pdf', expiresAt: '2026-08-02T12:01:00Z', sha256: 'a'.repeat(64) });
  151 |     if (url.pathname.includes('/rest/v1/fiscal_profiles')) return json(route, fiscal?.profile || { environment: 'disabled', accountant_review_status: 'pending', production_gate_status: 'blocked', is_enabled: false });
  152 |     if (url.pathname.includes('/rest/v1/rpc/list_fiscal_document_artifacts')) return json(route, fiscal?.artifacts || []);
  153 |     if (url.pathname.includes('/rest/v1/rpc/request_credit_note')) return fiscal?.creditResponse ? json(route, fiscal.creditResponse) : json(route, { fiscal_document_id: 'credit-queued', state: 'queued' });
  154 |     if (url.pathname.includes('/rest/v1/rpc/request_fiscal_print_job')) return json(route, fiscal?.printResponse || { print_job_id: '99999999-9999-4999-8999-999999999999', status: 'queued' });
  155 |     if (url.pathname.includes('/rest/v1/rpc/update_fiscal_print_job')) return json(route, { print_job_id: '99999999-9999-4999-8999-999999999999', status: 'sent_to_spooler' });
  156 |     if (url.pathname.includes('/rest/v1/rpc/get_production_operation_center')) return json(route, fiscal?.operationCenter || operationCenterFixture({ empty: true }));
  157 |     if (url.pathname.includes('/rest/v1/rpc/transition_operational_alert')) return json(route, { ok: true, status: 'acknowledged' });
  158 |     if (url.pathname.includes('/rest/v1/rpc/prepare_daily_reconciliation')) return json(route, { ok: true, reconciliation: fiscal?.operationCenter?.recent_closures?.[0] || null });
  159 |     if (url.pathname.includes('/rest/v1/rpc/close_daily_reconciliation')) return json(route, { ok: true, reconciliation: { status: 'closed', snapshot_sha256: 'c'.repeat(64) } });
  160 |     if (url.pathname.includes('/rest/v1/rpc/request_fiscal_artifact_regeneration')) return fiscal?.regenerationFailure
  161 |       ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: fiscal.regenerationFailure }) })
  162 |       : json(route, { fiscal_document_id: 'fixture', artifact_state: 'artifact_pending' });
  163 |     if (url.pathname.includes('/rest/v1/fiscal_documents')) return json(route, fiscal?.documents || []);
  164 |     if (url.pathname.includes('/rest/v1/rpc/checkout_pos_sale')) return json(route, { sale_id: '77777777-7777-4777-8777-777777777777', state: 'completed', total: 600 });
  165 |     if (url.pathname.includes('/rest/v1/rpc/request_fiscal_document')) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'fiscalizacion deshabilitada' }) });
  166 |     if (url.pathname.includes('/rest/v1/rpc/list_active_business_riders')) return json(route, []);
  167 |     if (url.pathname.includes('/rest/v1/rpc/get_public_business_contact')) return json(route, []);
  168 |     if (url.pathname.includes('/rest/v1/orders')) return json(route, []);
  169 |     if (url.pathname.includes('/rest/v1/products')) return json(route, []);
  170 |     return json(route, []);
  171 |   });
  172 |   await page.route('https://signed.example.invalid/**', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'content-disposition': 'attachment; filename="fixture.pdf"' }, body: '%PDF-1.4\nfixture\n%%EOF' }));
  173 |   await page.addInitScript(({ businessId, persistedSession, supabaseUrl, desktop }) => {
  174 |     globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
  175 |       mode: 'production',
  176 |       repository: {
  177 |         provider: 'supabase', deploymentEnvironment: 'staging', supabaseUrl,
[EXCLUIDO: credencial/configuración; recrear localmente.]
  179 |       },
  180 |     };
  181 |     localStorage.setItem('sb-taba-business-windows-e2e-auth-token', JSON.stringify(persistedSession));
  182 |     if (desktop) {
  183 |       globalThis.__TAURI__ = { core: { invoke: async (command) => {
  184 |         if (command === 'initialize_business_runtime') return true;
  185 |         if (command === 'outbox_list') return [];
```
