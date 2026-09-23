package com.lataba.rider

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import org.json.JSONObject

class RiderRepository(val api: RiderBackend) {
    private val _state = MutableStateFlow(RiderState(signedIn = api.hasSession))
    val state: StateFlow<RiderState> = _state
    private val commandLock = Mutex()
    private val readLock = Mutex()
    private var lastHeartbeatAt = 0L
    suspend fun login(email: String, password: String) = command {
        api.login(email, password)
        _state.update { it.copy(signedIn = true) }; refresh()
    }
    suspend fun refresh() {
        if (!api.hasSession || !readLock.tryLock()) return
        try {
            var board = api.board()
            val now = System.currentTimeMillis()
            if (board.available && now - lastHeartbeatAt >= 20_000) {
                val business = requireNotNull(api.businessId)
                api.rpc("heartbeat_rider_availability", JSONObject().put("p_business_id", business))
                lastHeartbeatAt = now
                board = api.board()
            }
            if (!api.hasSession) return
            _state.update { it.copy(board = board, signedIn = true, available = board.available,
                online = true, refreshedAt = now, message = if (!it.online || it.refreshedAt == null)
                    "Sincronizado con Staging" else it.message) }
        }
        catch (e: Exception) { failed(e) } finally { readLock.unlock() }
    }
    suspend fun availability(value: Boolean) = command {
        val state = _state.value
        if (state.available == value) return@command
        check(state.online && state.board != null) { "Actualizá la sesión antes de cambiar disponibilidad" }
        val business = requireNotNull(api.businessId)
        val version = state.board.availabilityVersion
        val result = api.rpc("set_rider_availability", JSONObject()
            .put("p_business_id", business).put("p_available", value)
            .put("p_expected_version", version)
            .put("p_idempotency_key", RiderCommands.key("availability", business, version, value.toString())))
        refresh()
        _state.update { it.copy(message = if (result.optBoolean("ok"))
            "Disponibilidad confirmada por el servidor" else "Disponibilidad no confirmada: ${result.optString("code")}") }
    }
    suspend fun offer(offer: Offer, accept: Boolean) = command {
        check(!accept || (_state.value.available && _state.value.online && _state.value.board?.atCapacity == false))
        val rpc = if (accept) "accept_rider_order_offer" else "reject_rider_order_offer"
        val p = JSONObject().put("p_offer_id", offer.id).put("p_expected_version", offer.version)
            .put("p_idempotency_key", RiderCommands.key(rpc, offer.id, offer.version))
        if (!accept) p.put("p_reason_code", JSONObject.NULL)
        checked(rpc, p)
    }
    suspend fun advance(order: Delivery, code: String = "") = command {
        check(_state.value.online)
        val rpc = requireNotNull(RiderCommands.next(order.status))
        if (rpc == "confirm_delivery_code") require(RiderCommands.validCode(code)) { "Código de entrega requerido" }
        val p = JSONObject().put("p_order_id", order.id).put("p_expected_revision", order.revision)
            .put("p_idempotency_key", RiderCommands.key(rpc, order.id, order.revision, code))
        if (rpc == "confirm_delivery_code") p.put("p_delivery_code", code)
        checked(rpc, p)
    }
    private suspend fun checked(rpc: String, p: JSONObject) {
        val result = api.rpc(rpc, p)
        refresh()
        _state.update { it.copy(message = if (result.optBoolean("ok")) "Operación confirmada" else "No confirmado: ${result.optString("code")}") }
    }
    suspend fun logout() = command {
        try {
            val board = _state.value.board
            if (_state.value.online && board?.available == true) {
                val business = requireNotNull(api.businessId)
                api.rpc("set_rider_availability", JSONObject()
                    .put("p_business_id", business).put("p_available", false)
                    .put("p_expected_version", board.availabilityVersion)
                    .put("p_idempotency_key", RiderCommands.key("availability", business,
                        board.availabilityVersion, "false")))
            }
        } finally { api.logout(); _state.value = RiderState() }
    }
    fun gps(message: String) { _state.update { it.copy(gps = message) } }
    private fun failed(e: Exception) {
        if (e is CancellationException) throw e
        val signed = api.hasSession
        _state.update { it.copy(signedIn = signed, online = false, board = if (signed) it.board else null,
            message = when(e) { is ApiFailure -> e.message.orEmpty(); is java.io.IOException -> "Sin conexión. Reintentá al recuperar red."; else -> "Operación no confirmada. Revisá sesión y conexión." }) }
    }
    private suspend fun command(block: suspend () -> Unit) {
        if (!commandLock.tryLock()) return
        _state.update { it.copy(busy = true) }
        try { block() } catch (e: Exception) { failed(e) }
        finally { _state.update { it.copy(busy = false) }; commandLock.unlock() }
    }
}
