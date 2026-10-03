# Quality Checklist 

## Implementation Requirements

### 1. N/A
- **Description:** Does it send the item quantity?
- **Implementation:** N/A
- **API Name:** `item_quantity`

---

### 2. N/A
- **Description:** Does it send the unit price?
- **Implementation:** N/A
- **API Name:** `item_unit_price`

---

### 3. Descripción-Resumen de tarjeta
- **Description:** Does the integration use a soft descriptor or statement descriptor?
- **Implementation:** Envíanos el campo statement_descriptor en el request de la sección “Preferencias” para disminuir las probabilidades de desconocimientos o contra cargos.
- **API Name:** `statement_descriptor_/_soft_descriptor`

**Translations:**
- 🇺🇸 **English:** Descripción-Resumen de tarjeta - Envíanos el campo statement_descriptor en el request de la sección “Preferencias” para disminuir las probabilidades de desconocimientos o contra cargos.
- 🇪🇸 **Spanish:** Descripción-Resumen de tarjeta - Envíanos el campo statement_descriptor en el request de la sección “Preferencias” para disminuir las probabilidades de desconocimientos o contra cargos.
- 🇧🇷 **Portuguese:** Descrição - Fatura do cartão - Envie-nos o campo statement_descriptor na solicitação da seção "Preferências" para diminuir as chances de contestações.

---

### 4. Back URLs
- **Description:** Does the seller send back urls in the preference?
- **Implementation:** Redirecciona al comprador a tu sitio web al finalizar el proceso de pago.
- **API Name:** `back_urls`

**Translations:**
- 🇺🇸 **English:** Back URLs - Redirecciona al comprador a tu sitio web al finalizar el proceso de pago.
- 🇪🇸 **Spanish:** Back URLs - Redirecciona al comprador a tu sitio web al finalizar el proceso de pago.
- 🇧🇷 **Portuguese:** Back URLs - Redirecione os compradores para seu site ao concluirem o processo de pagamento.

---

### 5. Notificaciones webhooks
- **Description:** Does the integration has notifications enabled?
- **Implementation:** Envíanos el endpoint destinado a recibir las notificaciones webhooks en el campo "notification_url" del request de la preferencia.
- **API Name:** `webhooks_ipn`

**Translations:**
- 🇺🇸 **English:** Notificaciones webhooks - Envíanos el endpoint destinado a recibir las notificaciones webhooks en el campo "notification_url" del request de la preferencia.
- 🇪🇸 **Spanish:** Notificaciones webhooks - Envíanos el endpoint destinado a recibir las notificaciones webhooks en el campo "notification_url" del request de la preferencia.
- 🇧🇷 **Portuguese:** Notificações Webhook - Envie-nos o endpoint destinado ao recebimento de notificações Webhook no campo "notification_url", pelo request da seção "Preferências".

---

### 6. Referencia externa
- **Description:** Does it send an external reference for conciliation?
- **Implementation:** Envíanos en el campo "external_reference" del request de la Preferencia, un código único que te permita correlacionar el payment_id de MercadoPago con el id interno de tu sistema.
- **API Name:** `external_reference`

**Translations:**
- 🇺🇸 **English:** Referencia externa - Envíanos en el campo "external_reference" del request de la Preferencia, un código único que te permita correlacionar el payment_id de MercadoPago con el id interno de tu sistema.
- 🇪🇸 **Spanish:** Referencia externa - Envíanos en el campo "external_reference" del request de la Preferencia, un código único que te permita correlacionar el payment_id de MercadoPago con el id interno de tu sistema.
- 🇧🇷 **Portuguese:** Referência externa - Pelo campo "external_reference", no request da seção "Preferências", envie-nos um código único que te permita correlacionar o payment_id do Mercado Pago com o ID interno do seu sistema.

---

### 7. Email del comprador
- **Description:** Does it send the payer’s email address?
- **Implementation:** Envíanos el campo payer.email en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Esta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.
- **API Name:** `email`

**Translations:**
- 🇺🇸 **English:** Email del comprador - Envíanos el campo payer.email en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Esta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.
- 🇪🇸 **Spanish:** Email del comprador - Envíanos el campo payer.email en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Esta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.
- 🇧🇷 **Portuguese:** E-mail do comprador - Envie-nos o campo "payer.email" pelo request da seção "Preferências" para melhorar o índice de aprovação.
Essa informação nos permite otimizar a validação de segurança dos pagamentos e, assim, reduzir as chances do nosso mecanismo de prevenção de fraudes de recusá-los.

---

### 8. N/A
- **Description:** Does it send the payer’s first name?
- **Implementation:** N/A
- **API Name:** `payer_first_name`

---

### 9. Apellido del comprador
- **Description:** Does it send the payer’s last name?
- **Implementation:** Envíanos el campo payer.last_name en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Esta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.
- **API Name:** `payer_last_name`

**Translations:**
- 🇺🇸 **English:** Apellido del comprador - Envíanos el campo payer.last_name en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Esta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.
- 🇪🇸 **Spanish:** Apellido del comprador - Envíanos el campo payer.last_name en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Esta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.
- 🇧🇷 **Portuguese:** Sobrenome do comprador - Envie-nos o campo "payer.last_name" pelo request da seção "Preferências" para melhorar o índice de aprovação.
Essa informação nos permite otimizar a validação de segurança dos pagamentos e, assim, reduzir as chances do nosso mecanismo de prevenção de fraudes de recusá-los. 

---

### 10. N/A
- **Description:** Sends category id?
- **Implementation:** N/A
- **API Name:** `item_category_id`

---

### 11. Description del item
- **Description:** Sends item description?
- **Implementation:** Envíanos el campo items.description en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Esta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.
- **API Name:** `item_description`

**Translations:**
- 🇺🇸 **English:** Description del item - Envíanos el campo items.description en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Esta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.
- 🇪🇸 **Spanish:** Description del item - Envíanos el campo items.description en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Esta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.
- 🇧🇷 **Portuguese:** Descrição do item - Envie-nos o campo "items.description" pelo request da seção "Preferências" para melhorar o índice de aprovação.
Essa informação nos permite otimizar a validação de segurança dos pagamentos e, assim, reduzir as chances do nosso mecanismo de prevenção de fraudes de recusá-los.

---

### 12. N/A
- **Description:** Sends item id?
- **Implementation:** N/A
- **API Name:** `item_id`

---

### 13. N/A
- **Description:** Does it send the item title?
- **Implementation:** N/A
- **API Name:** `item_title`

---

### 14. Backend SDK
- **Description:** Does the integration use any backend SDK?
- **Implementation:** Use our Backend SDKs to make use of our features easily.
- **API Name:** `back_end_sdk`

**Translations:**
- 🇺🇸 **English:** Backend SDK - Use our Backend SDKs to make use of our features easily.
- 🇪🇸 **Spanish:** SDK de backend - Utiliza nuestras SDKs de Backend y obten las funcionalidades server-side de nuestras soluciones.
- 🇧🇷 **Portuguese:** SDK do backend - Use nossos SDKs de backend e conte com os recursos de server-side das nossas soluções de pagamento on-line.

---

## Good Practices

### 1. Respuesta binaria
- **Description:** Is binary mode configurable for seller?
- **Recommendation:** Envíanos el campo "binary_mode"=true en el request de la prefrencia, si tu negocio requiere que la aprobación del pago sea instántanea.
- **API Name:** `binary_mode`

**Translations:**
- 🇺🇸 **English:** Respuesta binaria - Envíanos el campo "binary_mode"=true en el request de la prefrencia, si tu negocio requiere que la aprobación del pago sea instántanea.
- 🇪🇸 **Spanish:** Respuesta binaria - Envíanos el campo "binary_mode"=true en el request de la prefrencia, si tu negocio requiere que la aprobación del pago sea instántanea.
- 🇧🇷 **Portuguese:** Resposta binária - Se sua loja precisar que o pagamento seja aprovado na hora, por favor, envie-nos o campo "binary_mode"=true pelo request da seção "Preferências".

---

### 2. Expiration date for offline payments
- **Description:** Is date of expiration configurable for seller?
- **Recommendation:** If you allow offline payment methods, make sure to give the sellers the ability to configure an expiration date. Make sure to send the expiration date on the "date_of_expiration" field either on the preference or payment creation request.
- **API Name:** `date_of_expiration`

**Translations:**
- 🇺🇸 **English:** Expiration date for offline payments - If you allow offline payment methods, make sure to give the sellers the ability to configure an expiration date. Make sure to send the expiration date on the "date_of_expiration" field either on the preference or payment creation request.
- 🇪🇸 **Spanish:** Fecha de vencimiento para pagos en efectivo - Si admites medios de pago en efectivo, permite a los vendedores configurar la fecha de vencimiento envíando el campo "date_of_expiration" en el request de la preferencia o pago.
- 🇧🇷 **Portuguese:** Data de vencimento para pagamentos via boleto - Se o seu site aceita pagamentos via boleto, defina a data de vencimento ao enviar o campo "date_of_expiration" pelo request da seção "Preferências".

---

### 3. Ads integration
- **Description:** Uses Facebook Pixel or Google Ads services?
- **Recommendation:** Integrate Checkout Pro with Facebook Ads and Google Ads
- **API Name:** `marketing_information`

**Translations:**
- 🇺🇸 **English:** Ads integration - Integrate Checkout Pro with Facebook Ads and Google Ads
- 🇪🇸 **Spanish:** Integración de anuncios - Integrar Checkout Pro con las plataformas de Facebook Ads y Google Ads.
- 🇧🇷 **Portuguese:** Integração do anúncios - Integrar o Checkout Pro com as plataformas do Facebook Ads e Google Ads.

---

### 4. Term of preference
- **Description:** Sets expiration date?
- **Recommendation:** In the case of a limited time to complete the payment, set a duration to the preference sending the fields "expires=true", "expiration_date_from" and "expiration_date_to" in the preference creation request.
- **API Name:** `expiration`

**Translations:**
- 🇺🇸 **English:** Term of preference - In the case of a limited time to complete the payment, set a duration to the preference sending the fields "expires=true", "expiration_date_from" and "expiration_date_to" in the preference creation request.
- 🇪🇸 **Spanish:** Vigencia de la preferencia - Si requieres habilitar la preferencia durante una ventana de tiempo determinada, establece su vigencia enviando en la preferencia el campo "expires"=true y los parámetros "expiration_date_from" y "expiration_date_to".
- 🇧🇷 **Portuguese:** Vigência de preferência - Se você precisar habilitar a seção "Preferências" durante um determinado intervalo de tempo, estabeleça a vigência ao enviar os dados do campo "expires"=true e os parâmetros "expiration_date_from" e "expiration_date_to".

---

### 5. Máximo de cuotas
- **Description:** Sends max installments?
- **Recommendation:** Envíanos el valor máximo de cuotas a ofrecer en tu checkout, desde el campo "installments" del request de la preferencia.
- **API Name:** `max_installments`

**Translations:**
- 🇺🇸 **English:** Máximo de cuotas - Envíanos el valor máximo de cuotas a ofrecer en tu checkout, desde el campo "installments" del request de la preferencia.
- 🇪🇸 **Spanish:** Máximo de cuotas - Envíanos el valor máximo de cuotas a ofrecer en tu checkout, desde el campo "installments" del request de la preferencia.
- 🇧🇷 **Portuguese:** Número máximo de parcelas - Envie-nos o número máximo de parcelas que você quer oferecer no seu checkout, usando o campo "installments", no request da seção "Preferências".

---

### 6. Esquema de apertura modal
- **Description:** Does the integration open Checkout in modal form?
- **Recommendation:** Abre el checkout en tu sitio.
- **API Name:** `modal`

**Translations:**
- 🇺🇸 **English:** Esquema de apertura modal - Abre el checkout en tu sitio.
- 🇪🇸 **Spanish:** Esquema de apertura modal - Abre el checkout en tu sitio.
- 🇧🇷 **Portuguese:** Esquema de abertura do modal - Abra o checkout no seu site.

---

### 7. Logos oficiales de Mercado Pago
- **Description:** Shows Mercado Pago logo properly in Payment Methods in own website?
- **Recommendation:** Muestra el Logo de Mercado Pago en tu sitio, para brindar más confianza en el comprador y mejorar la intención de pago online.
- **API Name:** `logos`

**Translations:**
- 🇺🇸 **English:** Logos oficiales de Mercado Pago - Muestra el Logo de Mercado Pago en tu sitio, para brindar más confianza en el comprador y mejorar la intención de pago online.
- 🇪🇸 **Spanish:** Logos oficiales de Mercado Pago - Muestra el Logo de Mercado Pago en tu sitio, para brindar más confianza en el comprador y mejorar la intención de pago online.
- 🇧🇷 **Portuguese:** Logotipos oficiais do Mercado Pago - Mostre o logotipo do Mercado Pago no seu site para transmitir mais confiança para os compradores e aumentar suas chances de receber pagamentos on-line.

---

### 8. Response messages
- **Description:** Shows feedback to the payer for rejections or error messages from the API?
- **Recommendation:** Make sure to give adequate feedback to the user regarding transaction status
- **API Name:** `response_messages`

**Translations:**
- 🇺🇸 **English:** Response messages - Make sure to give adequate feedback to the user regarding transaction status
- 🇪🇸 **Spanish:** Mensajes de respuesta - Asegúrate de darle al pagador información clara sobre el resultado del proceso de pago. Esto aumentará la conversión y la satisfacción del usuario
- 🇧🇷 **Portuguese:** Mensagens de resposta - Mostre mensagens claras para os usuários, antes de eles serem direcionados para o checkout e na hora de voltarem para seu site.

---

### 9. Exclusión de medios de pago
- **Description:** Exclusión de Medios de Pago
- **Recommendation:** Excluye desde tu integración los medios de pago que no deseas ofrecer en tu checkout.
- **API Name:** `excluded_payment_methods`

**Translations:**
- 🇺🇸 **English:** Exclusión de medios de pago - Excluye desde tu integración los medios de pago que no deseas ofrecer en tu checkout.
- 🇪🇸 **Spanish:** Exclusión de medios de pago - Excluye desde tu integración los medios de pago que no deseas ofrecer en tu checkout.
- 🇧🇷 **Portuguese:** Exclusão dos meios de pagamento - Na seção "Suas integrações", você pode excluir os meios de pagamento que não quer oferecer no seu Checkout.

---

### 10. Exclusión de tipos de medios de pago
- **Description:** Exclusión de Tipos de Medios de Pago
- **Recommendation:** Excluye desde tu integración los tipos de medios de pago que no deseas ofrecer en tu checkout.
- **API Name:** `excluded_payment_types`

**Translations:**
- 🇺🇸 **English:** Exclusión de tipos de medios de pago - Excluye desde tu integración los tipos de medios de pago que no deseas ofrecer en tu checkout.
- 🇪🇸 **Spanish:** Exclusión de tipos de medios de pago - Excluye desde tu integración los tipos de medios de pago que no deseas ofrecer en tu checkout.
- 🇧🇷 **Portuguese:** Exclusão dos tipos de meio de pagamento - Na seção "Suas integrações", você pode excluir os tipos de meios de pagamento que não quer oferecer no seu Checkout.

---

### 11. Monto del envío
- **Description:** Monto del envío
- **Recommendation:** Muestra el monto del envío, si ya lo tienes estimado desde tu sitio.
- **API Name:** `shipment_amount`

**Translations:**
- 🇺🇸 **English:** Monto del envío - Muestra el monto del envío, si ya lo tienes estimado desde tu sitio.
- 🇪🇸 **Spanish:** Monto del envío - Muestra el monto del envío, si ya lo tienes estimado desde tu sitio.
- 🇧🇷 **Portuguese:** Valor do frete - Mostre o valor do frete, caso ele seja calculado pelo seu site.

---

### 12. Consulta el pago notificado
- **Description:** Does the seller get the order or payment after notification?
- **Recommendation:** Actualiza la información necesaria en tu plataforma, ante los eventos de pagos notificados.
- **API Name:** `payment_get_or_search_api`

**Translations:**
- 🇺🇸 **English:** Consulta el pago notificado - Actualiza la información necesaria en tu plataforma, ante los eventos de pagos notificados.
- 🇪🇸 **Spanish:** Consulta el pago notificado - Actualiza la información necesaria en tu plataforma, ante los eventos de pagos notificados.
- 🇧🇷 **Portuguese:** Consute o pagamento notificado - Por favor, atualize as informações necessárias na sua plataforma em caso de notificação de pagamentos.

---

### 13. Chargebacks
- **Description:** Does the integration use chargebacks API to upload documentation in order to dispute it?
- **Recommendation:** Use chargebacks API to manage disputes.
- **API Name:** `chargebacks_api`

**Translations:**
- 🇺🇸 **English:** Chargebacks - Use chargebacks API to manage disputes.
- 🇪🇸 **Spanish:** Contracargos - Utilizar la API de chargebacks para subir la documentación de disputa
- 🇧🇷 **Portuguese:** Contestações - Gerencie suas contestações pela API.

---

### 14. Cancelaciones
- **Description:** Does the integration cancel payments through the payments API?
- **Recommendation:** Cancela un pago, si éste se encuentra en status "pending" o " in process".
- **API Name:** `cancellation_api`

**Translations:**
- 🇺🇸 **English:** Cancelaciones - Cancela un pago, si éste se encuentra en status "pending" o " in process".
- 🇪🇸 **Spanish:** Cancelaciones - Cancela un pago, si éste se encuentra en status "pending" o " in process".
- 🇧🇷 **Portuguese:** Cancelamentos - É possível cancelar um pagamento que tenha os status "Pending" ou "In process".

---

### 15. Devoluciones
- **Description:** Does the integration use refunds API?
- **Recommendation:** Gestiona las devoluciones parciales o totales, usando nuestra API refund.
- **API Name:** `refunds_api`

**Translations:**
- 🇺🇸 **English:** Devoluciones - Gestiona las devoluciones parciales o totales, usando nuestra API refund.
- 🇪🇸 **Spanish:** Devoluciones - Gestiona las devoluciones parciales o totales, usando nuestra API refund.
- 🇧🇷 **Portuguese:** Devoluções - Gerencie as devoluções parciais ou totais com a nossa "API refund".

---

### 16. Reporte de liquidaciones
- **Description:** Does the integration have a settlement report?
- **Recommendation:** Conoce como está compuesto tu dinero disponible en Mercado Pago.
- **API Name:** `settlement`

**Translations:**
- 🇺🇸 **English:** Reporte de liquidaciones - Conoce como está compuesto tu dinero disponible en Mercado Pago.
- 🇪🇸 **Spanish:** Reporte de liquidaciones - Conoce como está compuesto tu dinero disponible en Mercado Pago.
- 🇧🇷 **Portuguese:** Relatório "Liberações" - Saiba o que compõe seu saldo disponível no Mercado Pago.

---

### 17. Reporte de todas las transacciones
- **Description:** Does the integration have a release report?
- **Recommendation:** Conoce las operaciones que afectaron el balance de tu dinero.
- **API Name:** `release`

**Translations:**
- 🇺🇸 **English:** Reporte de todas las transacciones - Conoce las operaciones que afectaron el balance de tu dinero.
- 🇪🇸 **Spanish:** Reporte de todas las transacciones - Conoce las operaciones que afectaron el balance de tu dinero.
- 🇧🇷 **Portuguese:** Relatório "Todas as transações" - Confira as transações que afetaram seu saldo.

---

### 18. Dirección del comprador
- **Description:** Sends payer's address?
- **Recommendation:** Si cuentas con esta información, envíanos el dato en el campo payer.address en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Cuanto más completa sea la información en el objeto "payer" más optima será la validación de seguridad de los pagos y con esto, disminuirán las probabilidades 
de rechazos por parte de nuestro motor de prevención de fraude.
- **API Name:** `address`

**Translations:**
- 🇺🇸 **English:** Dirección del comprador - Si cuentas con esta información, envíanos el dato en el campo payer.address en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Cuanto más completa sea la información en el objeto "payer" más optima será la validación de seguridad de los pagos y con esto, disminuirán las probabilidades 
de rechazos por parte de nuestro motor de prevención de fraude.
- 🇪🇸 **Spanish:** Dirección del comprador - Si cuentas con esta información, envíanos el dato en el campo payer.address en el request de la sección "Preferencias" para mejorar la tasa de aprobación.
Cuanto más completa sea la información en el objeto "payer" más optima será la validación de seguridad de los pagos y con esto, disminuirán las probabilidades 
de rechazos por parte de nuestro motor de prevención de fraude.
- 🇧🇷 **Portuguese:** Endereço do comprador - Se você tiver esta informação, por favor, envie-nos o dado do campo "payer.address" pelo request da seção "Preferências" para melhorar o índice de aprovação.
Quanto mais informações a opção "Payer" tiver, melhor será a validação de segurança dos pagamentos e, assim, as chances do nosso mecanismo de prevenção de fraudes recusá-los diminui.

---

### 19. N/A
- **Description:** Does the integration send the payer’s identification type and number?
- **Recommendation:** N/A
- **API Name:** `payer_identification`

---

### 20. N/A
- **Description:** Sends payer's phone number?
- **Recommendation:** N/A
- **API Name:** `payer_phone`

---

### 21. N/A
- **Description:** Does the integration send the payer’s identification type and number?
- **Recommendation:** N/A
- **API Name:** `payer_identification_mlm`

---

### 22. SDK de back end
- **Description:** sdk .js para checkout pro
- **Recommendation:** Agrega la SDK MercadoPago.js V2 a tu integración.
- **API Name:** `front_end_sdk_pro`

**Translations:**
- 🇺🇸 **English:** SDK de back end - Agrega la SDK MercadoPago.js V2 a tu integración.
- 🇪🇸 **Spanish:** SDK de frontend - Agrega la SDK MercadoPago.js V2 a tu integración.
- 🇧🇷 **Portuguese:** SDK de front end - Adicione o SDK MercadoPago.js V2 à sua integração.

---


```json
{
  "implement": [
    {
      "name": "item_quantity",
      "description": "Does it send the item quantity?",
      "description_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      },
      "remedy_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      }
    },
    {
      "name": "item_unit_price",
      "description": "Does it send the unit price?",
      "description_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      },
      "remedy_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      }
    },
    {
      "name": "statement_descriptor_/_soft_descriptor",
      "description": "Does the integration use a soft descriptor or statement descriptor?",
      "description_field": {
        "id_management_field": 107,
        "product_id": 0,
        "es": "Descripción-Resumen de tarjeta",
        "pt": "Descrição - Fatura do cartão",
        "en": "Descripción-Resumen de tarjeta"
      },
      "remedy_field": {
        "id_management_field": 107,
        "product_id": 0,
        "es": "Envíanos el campo statement_descriptor en el request de la sección “Preferencias” para disminuir las probabilidades de desconocimientos o contra cargos.",
        "pt": "Envie-nos o campo statement_descriptor na solicitação da seção \"Preferências\" para diminuir as chances de contestações.",
        "en": "Envíanos el campo statement_descriptor en el request de la sección “Preferencias” para disminuir las probabilidades de desconocimientos o contra cargos."
      }
    },
    {
      "name": "back_urls",
      "description": "Does the seller send back urls in the preference?",
      "description_field": {
        "id_management_field": 119,
        "product_id": 0,
        "es": "Back URLs",
        "pt": "Back URLs",
        "en": "Back URLs"
      },
      "remedy_field": {
        "id_management_field": 119,
        "product_id": 0,
        "es": "Redirecciona al comprador a tu sitio web al finalizar el proceso de pago.",
        "pt": "Redirecione os compradores para seu site ao concluirem o processo de pagamento.",
        "en": "Redirecciona al comprador a tu sitio web al finalizar el proceso de pago."
      }
    },
    {
      "name": "webhooks_ipn",
      "description": "Does the integration has notifications enabled?",
      "description_field": {
        "id_management_field": 58,
        "product_id": 0,
        "es": "Notificaciones webhooks",
        "pt": "Notificações Webhook",
        "en": "Notificaciones webhooks"
      },
      "remedy_field": {
        "id_management_field": 58,
        "product_id": 0,
        "es": "Envíanos el endpoint destinado a recibir las notificaciones webhooks en el campo \"notification_url\" del request de la preferencia.",
        "pt": "Envie-nos o endpoint destinado ao recebimento de notificações Webhook no campo \"notification_url\", pelo request da seção \"Preferências\".",
        "en": "Envíanos el endpoint destinado a recibir las notificaciones webhooks en el campo \"notification_url\" del request de la preferencia."
      }
    },
    {
      "name": "external_reference",
      "description": "Does it send an external reference for conciliation?",
      "description_field": {
        "id_management_field": 125,
        "product_id": 0,
        "es": "Referencia externa",
        "pt": "Referência externa",
        "en": "Referencia externa"
      },
      "remedy_field": {
        "id_management_field": 125,
        "product_id": 0,
        "es": "Envíanos en el campo \"external_reference\" del request de la Preferencia, un código único que te permita correlacionar el payment_id de MercadoPago con el id interno de tu sistema.",
        "pt": "Pelo campo \"external_reference\", no request da seção \"Preferências\", envie-nos um código único que te permita correlacionar o payment_id do Mercado Pago com o ID interno do seu sistema.",
        "en": "Envíanos en el campo \"external_reference\" del request de la Preferencia, un código único que te permita correlacionar el payment_id de MercadoPago con el id interno de tu sistema."
      }
    },
    {
      "name": "email",
      "description": "Does it send the payer’s email address?",
      "description_field": {
        "id_management_field": 61,
        "product_id": 0,
        "es": "Email del comprador",
        "pt": "E-mail do comprador",
        "en": "Email del comprador"
      },
      "remedy_field": {
        "id_management_field": 61,
        "product_id": 0,
        "es": "Envíanos el campo payer.email en el request de la sección \"Preferencias\" para mejorar la tasa de aprobación.\nEsta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.",
        "pt": "Envie-nos o campo \"payer.email\" pelo request da seção \"Preferências\" para melhorar o índice de aprovação.\nEssa informação nos permite otimizar a validação de segurança dos pagamentos e, assim, reduzir as chances do nosso mecanismo de prevenção de fraudes de recusá-los.",
        "en": "Envíanos el campo payer.email en el request de la sección \"Preferencias\" para mejorar la tasa de aprobación.\nEsta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude."
      }
    },
    {
      "name": "payer_first_name",
      "description": "Does it send the payer’s first name?",
      "description_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      },
      "remedy_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      }
    },
    {
      "name": "payer_last_name",
      "description": "Does it send the payer’s last name?",
      "description_field": {
        "id_management_field": 64,
        "product_id": 0,
        "es": "Apellido del comprador",
        "pt": "Sobrenome do comprador",
        "en": "Apellido del comprador"
      },
      "remedy_field": {
        "id_management_field": 64,
        "product_id": 0,
        "es": "Envíanos el campo payer.last_name en el request de la sección \"Preferencias\" para mejorar la tasa de aprobación.\nEsta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.",
        "pt": "Envie-nos o campo \"payer.last_name\" pelo request da seção \"Preferências\" para melhorar o índice de aprovação.\nEssa informação nos permite otimizar a validação de segurança dos pagamentos e, assim, reduzir as chances do nosso mecanismo de prevenção de fraudes de recusá-los. ",
        "en": "Envíanos el campo payer.last_name en el request de la sección \"Preferencias\" para mejorar la tasa de aprobación.\nEsta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude."
      }
    },
    {
      "name": "item_category_id",
      "description": "Sends category id?",
      "description_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      },
      "remedy_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      }
    },
    {
      "name": "item_description",
      "description": "Sends item description?",
      "description_field": {
        "id_management_field": 67,
        "product_id": 0,
        "es": "Description del item",
        "pt": "Descrição do item",
        "en": "Description del item"
      },
      "remedy_field": {
        "id_management_field": 67,
        "product_id": 0,
        "es": "Envíanos el campo items.description en el request de la sección \"Preferencias\" para mejorar la tasa de aprobación.\nEsta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude.",
        "pt": "Envie-nos o campo \"items.description\" pelo request da seção \"Preferências\" para melhorar o índice de aprovação.\nEssa informação nos permite otimizar a validação de segurança dos pagamentos e, assim, reduzir as chances do nosso mecanismo de prevenção de fraudes de recusá-los.",
        "en": "Envíanos el campo items.description en el request de la sección \"Preferencias\" para mejorar la tasa de aprobación.\nEsta información nos permite optimizar la validación de seguridad de los pagos y con esto, disminuir las probabilidades de rechazos por parte de nuestro motor de prevención de fraude."
      }
    },
    {
      "name": "item_id",
      "description": "Sends item id?",
      "description_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      },
      "remedy_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      }
    },
    {
      "name": "item_title",
      "description": "Does it send the item title?",
      "description_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      },
      "remedy_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      }
    },
    {
      "name": "back_end_sdk",
      "description": "Does the integration use any backend SDK?",
      "description_field": {
        "id_management_field": 81,
        "product_id": 0,
        "es": "SDK de backend",
        "pt": "SDK do backend",
        "en": "Backend SDK"
      },
      "remedy_field": {
        "id_management_field": 81,
        "product_id": 0,
        "es": "Utiliza nuestras SDKs de Backend y obten las funcionalidades server-side de nuestras soluciones.",
        "pt": "Use nossos SDKs de backend e conte com os recursos de server-side das nossas soluções de pagamento on-line.",
        "en": "Use our Backend SDKs to make use of our features easily."
      }
    }
  ],
  "good_practices": [
    {
      "name": "binary_mode",
      "description": "Is binary mode configurable for seller?",
      "description_field": {
        "id_management_field": 101,
        "product_id": 0,
        "es": "Respuesta binaria",
        "pt": "Resposta binária",
        "en": "Respuesta binaria"
      },
      "remedy_field": {
        "id_management_field": 101,
        "product_id": 0,
        "es": "Envíanos el campo \"binary_mode\"=true en el request de la prefrencia, si tu negocio requiere que la aprobación del pago sea instántanea.",
        "pt": "Se sua loja precisar que o pagamento seja aprovado na hora, por favor, envie-nos o campo \"binary_mode\"=true pelo request da seção \"Preferências\".",
        "en": "Envíanos el campo \"binary_mode\"=true en el request de la prefrencia, si tu negocio requiere que la aprobación del pago sea instántanea."
      }
    },
    {
      "name": "date_of_expiration",
      "description": "Is date of expiration configurable for seller?",
      "description_field": {
        "id_management_field": 102,
        "product_id": 0,
        "es": "Fecha de vencimiento para pagos en efectivo",
        "pt": "Data de vencimento para pagamentos via boleto",
        "en": "Expiration date for offline payments"
      },
      "remedy_field": {
        "id_management_field": 102,
        "product_id": 0,
        "es": "Si admites medios de pago en efectivo, permite a los vendedores configurar la fecha de vencimiento envíando el campo \"date_of_expiration\" en el request de la preferencia o pago.",
        "pt": "Se o seu site aceita pagamentos via boleto, defina a data de vencimento ao enviar o campo \"date_of_expiration\" pelo request da seção \"Preferências\".",
        "en": "If you allow offline payment methods, make sure to give the sellers the ability to configure an expiration date. Make sure to send the expiration date on the \"date_of_expiration\" field either on the preference or payment creation request."
      }
    },
    {
      "name": "marketing_information",
      "description": "Uses Facebook Pixel or Google Ads services?",
      "description_field": {
        "id_management_field": 104,
        "product_id": 0,
        "es": "Integración de anuncios",
        "pt": "Integração do anúncios",
        "en": "Ads integration"
      },
      "remedy_field": {
        "id_management_field": 104,
        "product_id": 0,
        "es": "Integrar Checkout Pro con las plataformas de Facebook Ads y Google Ads.",
        "pt": "Integrar o Checkout Pro com as plataformas do Facebook Ads e Google Ads.",
        "en": "Integrate Checkout Pro with Facebook Ads and Google Ads"
      }
    },
    {
      "name": "expiration",
      "description": "Sets expiration date?",
      "description_field": {
        "id_management_field": 124,
        "product_id": 0,
        "es": "Vigencia de la preferencia",
        "pt": "Vigência de preferência",
        "en": "Term of preference"
      },
      "remedy_field": {
        "id_management_field": 124,
        "product_id": 0,
        "es": "Si requieres habilitar la preferencia durante una ventana de tiempo determinada, establece su vigencia enviando en la preferencia el campo \"expires\"=true y los parámetros \"expiration_date_from\" y \"expiration_date_to\".",
        "pt": "Se você precisar habilitar a seção \"Preferências\" durante um determinado intervalo de tempo, estabeleça a vigência ao enviar os dados do campo \"expires\"=true e os parâmetros \"expiration_date_from\" e \"expiration_date_to\".",
        "en": "In the case of a limited time to complete the payment, set a duration to the preference sending the fields \"expires=true\", \"expiration_date_from\" and \"expiration_date_to\" in the preference creation request."
      }
    },
    {
      "name": "max_installments",
      "description": "Sends max installments?",
      "description_field": {
        "id_management_field": 126,
        "product_id": 0,
        "es": "Máximo de cuotas",
        "pt": "Número máximo de parcelas",
        "en": "Máximo de cuotas"
      },
      "remedy_field": {
        "id_management_field": 126,
        "product_id": 0,
        "es": "Envíanos el valor máximo de cuotas a ofrecer en tu checkout, desde el campo \"installments\" del request de la preferencia.",
        "pt": "Envie-nos o número máximo de parcelas que você quer oferecer no seu checkout, usando o campo \"installments\", no request da seção \"Preferências\".",
        "en": "Envíanos el valor máximo de cuotas a ofrecer en tu checkout, desde el campo \"installments\" del request de la preferencia."
      }
    },
    {
      "name": "modal",
      "description": "Does the integration open Checkout in modal form?",
      "description_field": {
        "id_management_field": 127,
        "product_id": 0,
        "es": "Esquema de apertura modal",
        "pt": "Esquema de abertura do modal",
        "en": "Esquema de apertura modal"
      },
      "remedy_field": {
        "id_management_field": 127,
        "product_id": 0,
        "es": "Abre el checkout en tu sitio.",
        "pt": "Abra o checkout no seu site.",
        "en": "Abre el checkout en tu sitio."
      }
    },
    {
      "name": "logos",
      "description": "Shows Mercado Pago logo properly in Payment Methods in own website?",
      "description_field": {
        "id_management_field": 131,
        "product_id": 0,
        "es": "Logos oficiales de Mercado Pago",
        "pt": "Logotipos oficiais do Mercado Pago",
        "en": "Logos oficiales de Mercado Pago"
      },
      "remedy_field": {
        "id_management_field": 131,
        "product_id": 0,
        "es": "Muestra el Logo de Mercado Pago en tu sitio, para brindar más confianza en el comprador y mejorar la intención de pago online.",
        "pt": "Mostre o logotipo do Mercado Pago no seu site para transmitir mais confiança para os compradores e aumentar suas chances de receber pagamentos on-line.",
        "en": "Muestra el Logo de Mercado Pago en tu sitio, para brindar más confianza en el comprador y mejorar la intención de pago online."
      }
    },
    {
      "name": "response_messages",
      "description": "Shows feedback to the payer for rejections or error messages from the API?",
      "description_field": {
        "id_management_field": 132,
        "product_id": 0,
        "es": "Mensajes de respuesta",
        "pt": "Mensagens de resposta",
        "en": "Response messages"
      },
      "remedy_field": {
        "id_management_field": 132,
        "product_id": 0,
        "es": "Asegúrate de darle al pagador información clara sobre el resultado del proceso de pago. Esto aumentará la conversión y la satisfacción del usuario",
        "pt": "Mostre mensagens claras para os usuários, antes de eles serem direcionados para o checkout e na hora de voltarem para seu site.",
        "en": "Make sure to give adequate feedback to the user regarding transaction status"
      }
    },
    {
      "name": "excluded_payment_methods",
      "description": "Exclusión de Medios de Pago",
      "description_field": {
        "id_management_field": 413,
        "product_id": 0,
        "es": "Exclusión de medios de pago",
        "pt": "Exclusão dos meios de pagamento",
        "en": "Exclusión de medios de pago"
      },
      "remedy_field": {
        "id_management_field": 413,
        "product_id": 0,
        "es": "Excluye desde tu integración los medios de pago que no deseas ofrecer en tu checkout.",
        "pt": "Na seção \"Suas integrações\", você pode excluir os meios de pagamento que não quer oferecer no seu Checkout.",
        "en": "Excluye desde tu integración los medios de pago que no deseas ofrecer en tu checkout."
      }
    },
    {
      "name": "excluded_payment_types",
      "description": "Exclusión de Tipos de Medios de Pago",
      "description_field": {
        "id_management_field": 414,
        "product_id": 0,
        "es": "Exclusión de tipos de medios de pago",
        "pt": "Exclusão dos tipos de meio de pagamento",
        "en": "Exclusión de tipos de medios de pago"
      },
      "remedy_field": {
        "id_management_field": 414,
        "product_id": 0,
        "es": "Excluye desde tu integración los tipos de medios de pago que no deseas ofrecer en tu checkout.",
        "pt": "Na seção \"Suas integrações\", você pode excluir os tipos de meios de pagamento que não quer oferecer no seu Checkout.",
        "en": "Excluye desde tu integración los tipos de medios de pago que no deseas ofrecer en tu checkout."
      }
    },
    {
      "name": "shipment_amount",
      "description": "Monto del envío",
      "description_field": {
        "id_management_field": 415,
        "product_id": 0,
        "es": "Monto del envío",
        "pt": "Valor do frete",
        "en": "Monto del envío"
      },
      "remedy_field": {
        "id_management_field": 415,
        "product_id": 0,
        "es": "Muestra el monto del envío, si ya lo tienes estimado desde tu sitio.",
        "pt": "Mostre o valor do frete, caso ele seja calculado pelo seu site.",
        "en": "Muestra el monto del envío, si ya lo tienes estimado desde tu sitio."
      }
    },
    {
      "name": "payment_get_or_search_api",
      "description": "Does the seller get the order or payment after notification?",
      "description_field": {
        "id_management_field": 57,
        "product_id": 0,
        "es": "Consulta el pago notificado",
        "pt": "Consute o pagamento notificado",
        "en": "Consulta el pago notificado"
      },
      "remedy_field": {
        "id_management_field": 57,
        "product_id": 0,
        "es": "Actualiza la información necesaria en tu plataforma, ante los eventos de pagos notificados.",
        "pt": "Por favor, atualize as informações necessárias na sua plataforma em caso de notificação de pagamentos.",
        "en": "Actualiza la información necesaria en tu plataforma, ante los eventos de pagos notificados."
      }
    },
    {
      "name": "chargebacks_api",
      "description": "Does the integration use chargebacks API to upload documentation in order to dispute it?",
      "description_field": {
        "id_management_field": 99,
        "product_id": 0,
        "es": "Contracargos",
        "pt": "Contestações",
        "en": "Chargebacks"
      },
      "remedy_field": {
        "id_management_field": 99,
        "product_id": 0,
        "es": "Utilizar la API de chargebacks para subir la documentación de disputa",
        "pt": "Gerencie suas contestações pela API.",
        "en": "Use chargebacks API to manage disputes."
      }
    },
    {
      "name": "cancellation_api",
      "description": "Does the integration cancel payments through the payments API?",
      "description_field": {
        "id_management_field": 116,
        "product_id": 0,
        "es": "Cancelaciones",
        "pt": "Cancelamentos",
        "en": "Cancelaciones"
      },
      "remedy_field": {
        "id_management_field": 116,
        "product_id": 0,
        "es": "Cancela un pago, si éste se encuentra en status \"pending\" o \" in process\".",
        "pt": "É possível cancelar um pagamento que tenha os status \"Pending\" ou \"In process\".",
        "en": "Cancela un pago, si éste se encuentra en status \"pending\" o \" in process\"."
      }
    },
    {
      "name": "refunds_api",
      "description": "Does the integration use refunds API?",
      "description_field": {
        "id_management_field": 117,
        "product_id": 0,
        "es": "Devoluciones",
        "pt": "Devoluções",
        "en": "Devoluciones"
      },
      "remedy_field": {
        "id_management_field": 117,
        "product_id": 0,
        "es": "Gestiona las devoluciones parciales o totales, usando nuestra API refund.",
        "pt": "Gerencie as devoluções parciais ou totais com a nossa \"API refund\".",
        "en": "Gestiona las devoluciones parciales o totales, usando nuestra API refund."
      }
    },
    {
      "name": "settlement",
      "description": "Does the integration have a settlement report?",
      "description_field": {
        "id_management_field": 303,
        "product_id": 0,
        "es": "Reporte de liquidaciones",
        "pt": "Relatório \"Liberações\"",
        "en": "Reporte de liquidaciones"
      },
      "remedy_field": {
        "id_management_field": 303,
        "product_id": 0,
        "es": "Conoce como está compuesto tu dinero disponible en Mercado Pago.",
        "pt": "Saiba o que compõe seu saldo disponível no Mercado Pago.",
        "en": "Conoce como está compuesto tu dinero disponible en Mercado Pago."
      }
    },
    {
      "name": "release",
      "description": "Does the integration have a release report?",
      "description_field": {
        "id_management_field": 304,
        "product_id": 0,
        "es": "Reporte de todas las transacciones",
        "pt": "Relatório \"Todas as transações\"",
        "en": "Reporte de todas las transacciones"
      },
      "remedy_field": {
        "id_management_field": 304,
        "product_id": 0,
        "es": "Conoce las operaciones que afectaron el balance de tu dinero.",
        "pt": "Confira as transações que afetaram seu saldo.",
        "en": "Conoce las operaciones que afectaron el balance de tu dinero."
      }
    },
    {
      "name": "address",
      "description": "Sends payer's address?",
      "description_field": {
        "id_management_field": 59,
        "product_id": 0,
        "es": "Dirección del comprador",
        "pt": "Endereço do comprador",
        "en": "Dirección del comprador"
      },
      "remedy_field": {
        "id_management_field": 59,
        "product_id": 0,
        "es": "Si cuentas con esta información, envíanos el dato en el campo payer.address en el request de la sección \"Preferencias\" para mejorar la tasa de aprobación.\nCuanto más completa sea la información en el objeto \"payer\" más optima será la validación de seguridad de los pagos y con esto, disminuirán las probabilidades \nde rechazos por parte de nuestro motor de prevención de fraude.",
        "pt": "Se você tiver esta informação, por favor, envie-nos o dado do campo \"payer.address\" pelo request da seção \"Preferências\" para melhorar o índice de aprovação.\nQuanto mais informações a opção \"Payer\" tiver, melhor será a validação de segurança dos pagamentos e, assim, as chances do nosso mecanismo de prevenção de fraudes recusá-los diminui.",
        "en": "Si cuentas con esta información, envíanos el dato en el campo payer.address en el request de la sección \"Preferencias\" para mejorar la tasa de aprobación.\nCuanto más completa sea la información en el objeto \"payer\" más optima será la validación de seguridad de los pagos y con esto, disminuirán las probabilidades \nde rechazos por parte de nuestro motor de prevención de fraude."
      }
    },
    {
      "name": "payer_identification",
      "description": "Does the integration send the payer’s identification type and number?",
      "description_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      },
      "remedy_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      }
    },
    {
      "name": "payer_phone",
      "description": "Sends payer's phone number?",
      "description_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      },
      "remedy_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      }
    },
    {
      "name": "payer_identification_mlm",
      "description": "Does the integration send the payer’s identification type and number?",
      "description_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      },
      "remedy_field": {
        "id_management_field": 0,
        "product_id": 0,
        "es": "",
        "pt": "",
        "en": ""
      }
    },
    {
      "name": "front_end_sdk_pro",
      "description": "sdk .js para checkout pro",
      "description_field": {
        "id_management_field": 420,
        "product_id": 0,
        "es": "SDK de frontend",
        "pt": "SDK de front end",
        "en": "SDK de back end"
      },
      "remedy_field": {
        "id_management_field": 420,
        "product_id": 0,
        "es": "Agrega la SDK MercadoPago.js V2 a tu integración.",
        "pt": "Adicione o SDK MercadoPago.js V2 à sua integração.",
        "en": "Agrega la SDK MercadoPago.js V2 a tu integración."
      }
    }
  ]
}
```