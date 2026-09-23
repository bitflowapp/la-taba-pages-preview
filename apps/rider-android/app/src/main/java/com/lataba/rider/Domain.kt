package com.lataba.rider

import org.json.JSONObject
import java.security.MessageDigest

data class Delivery(val id: String, val code: String, val revision: Long, val status: String,
    val address: String, val pickup: String, val total: String, val location: JSONObject?,
    val pickupLocation: JSONObject? = null) {
    val publishable get() = status in setOf("on_the_way", "arrived")
    fun navigationTarget(): String? {
        val point = if (status == "assigned") pickupLocation else location
        val latitude = point?.optDouble("latitude", Double.NaN) ?: Double.NaN
        val longitude = point?.optDouble("longitude", Double.NaN) ?: Double.NaN
        if (latitude.isFinite() && latitude in -90.0..90.0 && longitude.isFinite() && longitude in -180.0..180.0)
            return "$latitude,$longitude"
        return (if (status == "assigned") pickup else address).takeIf { it.isNotBlank() }
    }
    companion object {
        fun from(j: JSONObject) = Delivery(j.getString("id"), j.optString("public_code"), j.getLong("revision"),
            j.getString("status"), j.optString("customer_street_address", j.optString("address_label")),
            j.optString("pickup_summary"), j.optString("total"), j.optJSONObject("customer_location"),
            j.optJSONObject("business_location"))
    }
}
data class Offer(val id: String, val code: String, val version: Long, val zone: String, val pickup: String) {
    companion object { fun from(j: JSONObject) = Offer(j.getString("offer_id"), j.optString("public_code"),
        j.getLong("version"), j.optString("delivery_summary"), j.optString("pickup_summary")) }
}
data class Board(val orders: List<Delivery>, val offers: List<Offer>, val capacity: Int,
    val available: Boolean = false, val availabilityVersion: Long = 0) {
    val atCapacity get() = orders.size >= capacity
    companion object {
        fun from(j: JSONObject): Board {
            val capacity = j.getInt("max_active_orders")
            require(capacity > 0) { "Invalid server capacity" }
            val orders = j.getJSONArray("orders")
            val offers = j.getJSONArray("offers")
            return Board(List(orders.length()) { Delivery.from(orders.getJSONObject(it)) },
                List(offers.length()) { Offer.from(offers.getJSONObject(it)) }, capacity,
                j.optBoolean("available", false), j.optLong("availability_version", 0))
        }
    }
}
object RiderCommands {
    fun key(operation: String, id: String, revision: Long, code: String = ""): String =
        "android-" + MessageDigest.getInstance("SHA-256").digest("$operation:$id:$revision:$code".toByteArray())
            .joinToString("") { "%02x".format(it) }
    fun next(status: String): String? = when (status) {
        "assigned" -> "mark_delivery_picked_up"
        "picked_up" -> "start_rider_delivery"
        "on_the_way" -> "mark_rider_arrived"
        "arrived" -> "confirm_delivery_code"
        else -> null
    }
    const val CODE_LENGTH = 4 // issue_order_delivery_code generates 1000..9999.
    fun validCode(code: String) = code.matches(Regex("[0-9]{$CODE_LENGTH}"))
}

data class RiderState(val signedIn: Boolean = false, val available: Boolean = false, val board: Board? = null,
    val busy: Boolean = false, val online: Boolean = false, val message: String = "Iniciá sesión en Staging",
    val gps: String = "GPS detenido", val refreshedAt: Long? = null)
