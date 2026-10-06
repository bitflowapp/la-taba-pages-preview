package com.lataba.rider

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ContractTest {
    private fun order(status: String = "assigned") = JSONObject("""{"id":"qa","public_code":"QA-1","revision":7,"status":"$status"}""")
    @Test fun capacityComesFromServer() {
        val json = JSONObject("""{"max_active_orders":3,"orders":[],"offers":[]}""")
        val board = Board.from(json)
        assertEquals(3, board.capacity); assertFalse(board.atCapacity)
        repeat(3) { json.getJSONArray("orders").put(order()) }
        assertTrue(Board.from(json).atCapacity)
    }
    @Test fun missingCapacityFailsClosed() {
        assertThrows(Exception::class.java) { Board.from(JSONObject("""{"orders":[],"offers":[]}""")) }
    }
    @Test fun zeroCapacityRejected() {
        assertThrows(IllegalArgumentException::class.java) { Board.from(JSONObject("""{"max_active_orders":0,"orders":[],"offers":[]}""")) }
    }
    @Test fun duplicateAcceptAndRestartUseSameKey() {
        assertEquals(RiderCommands.key("accept", "offer", 1), RiderCommands.key("accept", "offer", 1))
        assertNotEquals(RiderCommands.key("accept", "offer", 1), RiderCommands.key("accept", "offer", 2))
    }
    @Test fun correctedCodeUsesDifferentIdempotencyKey() {
        assertNotEquals(RiderCommands.key("confirm", "qa", 7, "1234"), RiderCommands.key("confirm", "qa", 7, "5678"))
        assertFalse(RiderCommands.key("confirm", "qa", 7, "1234").contains("1234"))
    }
    @Test fun deliveryCodeMatchesBackendFourDigits() {
        assertTrue(RiderCommands.validCode("1234")); assertFalse(RiderCommands.validCode("123456"))
        assertFalse(RiderCommands.validCode("abcd")); assertFalse(RiderCommands.validCode("123"))
    }
    @Test fun completionOnlyThroughCodeContract() {
        assertEquals("confirm_delivery_code", RiderCommands.next("arrived"))
        assertNull(RiderCommands.next("delivered")); assertNull(RiderCommands.next("cancelled"))
    }
    @Test fun gpsOnlyInBackendPublishableStates() {
        assertFalse(Delivery.from(order()).publishable)
        assertFalse(Delivery.from(order("picked_up")).publishable)
        assertTrue(Delivery.from(order("on_the_way")).publishable)
        assertTrue(Delivery.from(order("arrived")).publishable)
        assertFalse(Delivery.from(order("delivered")).publishable)
    }
    @Test fun offerParsingUsesMinimizedFields() {
        val offer = Offer.from(JSONObject("""{"offer_id":"o","public_code":"QA","version":2,"delivery_summary":"zona"}"""))
        assertEquals("zona", offer.zone); assertEquals(2L, offer.version)
    }
    @Test fun navigationUsesConfirmedCoordinatesBeforeAddressSearch() {
        val assigned = order().put("pickup_summary", "Local")
            .put("business_location", JSONObject().put("latitude", -38.9460616).put("longitude", -68.0533209))
            .put("customer_street_address", "Calle destino")
            .put("customer_location", JSONObject().put("latitude", -38.945584).put("longitude", -68.040579))
        assertEquals("-38.9460616,-68.0533209", Delivery.from(assigned).navigationTarget())
        assigned.put("status", "on_the_way")
        assertEquals("-38.945584,-68.040579", Delivery.from(assigned).navigationTarget())
    }
    @Test fun navigationFallsBackOnlyWhenCoordinateIsAbsentOrInvalid() {
        val delivery = order("on_the_way").put("customer_street_address", "Destino validado")
            .put("customer_location", JSONObject().put("latitude", 900).put("longitude", -68.0))
        assertEquals("Destino validado", Delivery.from(delivery).navigationTarget())
        delivery.put("customer_street_address", "")
        assertNull(Delivery.from(delivery).navigationTarget())
    }
    @Test fun transitionContract() {
        assertEquals("mark_delivery_picked_up", RiderCommands.next("assigned"))
        assertEquals("start_rider_delivery", RiderCommands.next("picked_up"))
        assertEquals("mark_rider_arrived", RiderCommands.next("on_the_way"))
        assertNull(RiderCommands.next("unknown"))
    }
    // The shape get_rider_delivery_board sent for LT-0004 (2026-10-06), personal data replaced: a numeric total,
    // order_items and the payment method. The Rider showed none of it and the rider never learned to collect cash.
    private val cashDelivery = JSONObject("""{"id":"fc2d4711-87c5-4b5b-b91f-9b9a956ac0df","public_code":"LT-0004","revision":10,
        "status":"on_the_way","customer_street_address":"Calle 123","pickup_summary":"Local","payment_method":"cash",
        "subtotal":5900.00,"delivery_fee":0.00,"total":5900.00,"customer_reference":"Portón negro","customer_notes":"Tocar timbre",
        "order_items":[{"name":"Coca-Cola 2,25 L","quantity":1.000,"unit_price":5900.00}]}""")
    @Test fun cashDeliveryTellsTheRiderToCollectTheTotal() {
        val delivery = Delivery.from(cashDelivery)
        assertEquals("Cobrar en efectivo: $ 5.900", delivery.paymentInstruction)
        assertEquals("$ 5.900", delivery.totalText)
        assertEquals(listOf("1 × Coca-Cola 2,25 L"), delivery.items)
        assertEquals("Portón negro", delivery.reference); assertEquals("Tocar timbre", delivery.notes)
    }
    @Test fun eachPaymentMethodSaysWhatTheRiderDoesWithTheMoney() {
        fun instruction(method: String) = Delivery.from(JSONObject(cashDelivery.toString()).put("payment_method", method)).paymentInstruction
        assertEquals("Cobro a coordinar con el local ($ 5.900)", instruction("coordinate"))
        assertEquals("Pagado online · no cobrar", instruction("mercadopago"))
        assertEquals("", instruction("qa_no_charge"))
        assertEquals("", Delivery.from(order()).paymentInstruction)
    }
    @Test fun moneyReadsLikePesos() {
        assertEquals("$ 5.900", Money.format("5900.00"))
        assertEquals("$ 5.900", Money.format("5900.0"))
        assertEquals("$ 5.900,50", Money.format("5900.5"))
        assertEquals("$ 1.234.567,80", Money.format("1234567.8"))
        assertEquals("$ 990", Money.format("990"))
        assertEquals("sin dato", Money.format("sin dato"))
    }
    @Test fun offlineCopyKeepsWhatTheRiderNeedsToCollectAndDeliver() {
        val restored = BoardCodec.decode(BoardCodec.encode(Board(listOf(Delivery.from(cashDelivery)), emptyList(), 3), 1L))!!
        val back = restored.board.orders.single()
        assertEquals("Cobrar en efectivo: $ 5.900", back.paymentInstruction)
        assertEquals(listOf("1 × Coca-Cola 2,25 L"), back.items)
        assertEquals("Portón negro", back.reference); assertEquals("Tocar timbre", back.notes)
    }
}
