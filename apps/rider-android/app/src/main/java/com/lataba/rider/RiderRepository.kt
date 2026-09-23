package com.lataba.rider

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import org.json.JSONObject

class RiderRepository(val api: RiderBackend) {
    private val _state = MutableStateFlow(RiderState(signedIn = api.hasSession, available = api.available))
    val state: StateFlow<RiderState> = _state
    private val commandLock = Mutex()
    private val readLock = Mutex()
    suspend fun login(email: String, password: String) = command {
        api.login(email, password)
        _state.update { it.copy(signedIn = true) }; refresh()
    }
    suspend fun refresh() {
        if (!api.hasSession || !readLock.tryLock()) return
        try { val board = api.board(); if (!api.hasSession) return; _state.update { it.copy(board = board, signedIn = true, online = true,
            refreshedAt = System.currentTimeMillis(), message = "Sincronizado con Staging") } }
        catch (e: Exception) { failed(e) } finally { readLock.unlock() }
    }
    fun availability(value: Boolean) { api.available(value); _state.update { it.copy(available = value) } }
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
    suspend fun logout() = command { api.logout(); _state.value = RiderState() }
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
