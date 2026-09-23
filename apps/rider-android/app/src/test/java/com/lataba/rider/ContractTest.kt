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
    @Test fun transitionContract() {
        assertEquals("mark_delivery_picked_up", RiderCommands.next("assigned"))
        assertEquals("start_rider_delivery", RiderCommands.next("picked_up"))
        assertEquals("mark_rider_arrived", RiderCommands.next("on_the_way"))
        assertNull(RiderCommands.next("unknown"))
    }
}
