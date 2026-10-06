package com.lataba.rider

import org.json.JSONObject
import java.security.MessageDigest

data class Delivery(val id: String, val code: String, val revision: Long, val status: String,
    val address: String, val pickup: String, val total: String, val location: JSONObject?,
    val pickupLocation: JSONObject? = null, val paymentMethod: String = "", val items: List<String> = emptyList(),
    val reference: String = "", val notes: String = "") {
    val publishable get() = status in setOf("on_the_way", "arrived")
    /** «$ 5.900» / «$ 5.900,50»: what the rider collects, read from the server's total. */
    val totalText: String get() = Money.format(total)
    /**
     * What the rider has to do about the money, from the order's payment method. On cash the rider COLLECTS it and
     * the business registers it when the money reaches the till: the app never marks anything as paid.
     */
    val paymentInstruction: String get() = when (paymentMethod) {
        "cash" -> "Cobrar en efectivo: $totalText"
        "coordinate" -> "Cobro a coordinar con el local ($totalText)"
        "mercadopago" -> "Pagado online · no cobrar"
        else -> ""
    }
    /** What the rider reads; the server status code stays the source of every decision. */
    val statusLabel: String get() = when (status) {
        "assigned" -> "Asignado · retirar en el local"
        "picked_up" -> "Retirado · listo para salir"
        "on_the_way" -> "En camino"
        "arrived" -> "En el destino · pedir el código"
        "delivered" -> "Entregado"
        else -> status
    }
    fun toJson(): JSONObject = JSONObject().put("id", id).put("public_code", code).put("revision", revision)
        .put("status", status).put("customer_street_address", address).put("pickup_summary", pickup)
        .put("total", total).put("customer_location", location ?: JSONObject.NULL)
        .put("business_location", pickupLocation ?: JSONObject.NULL).put("payment_method", paymentMethod)
        .put("item_lines", org.json.JSONArray(items)).put("customer_reference", reference).put("customer_notes", notes)
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
            j.optJSONObject("business_location"), j.optString("payment_method"), itemLines(j),
            j.optString("customer_reference"), j.optString("customer_notes"))
        // The server sends `order_items`; the offline copy keeps the already-rendered `item_lines`.
        private fun itemLines(j: JSONObject): List<String> {
            j.optJSONArray("item_lines")?.let { lines -> return List(lines.length()) { lines.optString(it) }.filter(String::isNotBlank) }
            val items = j.optJSONArray("order_items") ?: return emptyList()
            return List(items.length()) { i ->
                val item = items.optJSONObject(i)
                val name = item?.optString("name").orEmpty()
                val quantity = item?.optString("quantity").orEmpty().toBigDecimalOrNull()?.stripTrailingZeros()?.toPlainString()
                if (name.isBlank()) "" else if (quantity == null) name else "$quantity × $name"
            }.filter(String::isNotBlank)
        }
    }
}

object Money {
    /** Argentine pesos as the rider reads them: «$ 5.900», «$ 5.900,50». Anything unreadable is shown as is. */
    fun format(raw: String): String {
        val amount = raw.trim().toBigDecimalOrNull() ?: return raw
        val cents = amount.setScale(2, java.math.RoundingMode.HALF_UP)
        val whole = cents.toBigInteger().abs().toString().reversed().chunked(3).joinToString(".").reversed()
        val fraction = cents.remainder(java.math.BigDecimal.ONE).abs().movePointRight(2).toInt()
        val sign = if (cents.signum() < 0) "-" else ""
        return "$ $sign$whole" + if (fraction == 0) "" else ",%02d".format(fraction)
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
// Human name of the backend this build talks to. PRODUCTION builds serve
// la-taba.pages.dev, PILOT builds the controlled production rollout; only QA
// builds may say Staging.
object RiderTarget {
    val label: String get() = if (BuildConfig.TARGET_MODE in setOf("pilot", "production")) "La Taba" else "Staging"
    val title: String get() = when (BuildConfig.TARGET_MODE) {
        "production" -> "La Taba · Rider"
        "pilot" -> "La Taba · Rider Piloto"
        else -> "La Taba · Rider QA"
    }
    val deviceLabel: String get() = when (BuildConfig.TARGET_MODE) {
        "production" -> "Android Rider"
        "pilot" -> "Android Rider Piloto"
        else -> "Android Rider QA"
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

// cachedAt != null: the board is the last one the server confirmed at that time, restored from this phone
// after a cold start without network. It is information, not the server's current state.
data class RiderState(val signedIn: Boolean = false, val available: Boolean = false, val board: Board? = null,
    val busy: Boolean = false, val online: Boolean = false, val message: String = "Iniciá sesión en ${RiderTarget.label}",
    val gps: String = "GPS detenido", val refreshedAt: Long? = null, val cachedAt: Long? = null)
