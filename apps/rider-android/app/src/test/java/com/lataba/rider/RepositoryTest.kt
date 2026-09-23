package com.lataba.rider

import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class RepositoryTest {
    private val offer = Offer("offer", "QA", 1, "zone", "shop")
    private val order = Delivery("order", "QA", 1, "assigned", "address", "shop", "10", null)
    private class Backend: RiderBackend {
        override var hasSession = true
        override var available = true
        var snapshot = Board(emptyList(), emptyList(), 3)
        var offline = false
        var rejectLogin = false
        var calls = 0
        var gate: CompletableDeferred<Unit>? = null
        var response = JSONObject().put("ok", true)
        override fun available(value: Boolean) { available = value }
        override suspend fun login(email: String, password: String) {
            if (rejectLogin) { hasSession = false; throw ApiFailure(400, "invalid_credentials") }
            hasSession = true
        }
        override suspend fun refresh(force: Boolean) { if (offline) throw IOException() }
        override suspend fun board(): Board { if (offline) throw IOException(); return snapshot }
        override suspend fun rpc(name: String, params: JSONObject): JSONObject {
            calls++; gate?.await(); if (offline) throw IOException(); return response
        }
        override suspend fun logout() { hasSession = false }
    }
    @Test fun loginRequiresValidSession() = runTest {
        val api = Backend().apply { hasSession = false; rejectLogin = true }
        val repo = RiderRepository(api); repo.login("qa", "invalid")
        assertFalse(repo.state.value.signedIn); assertNull(repo.state.value.board)
        api.rejectLogin = false; repo.login("qa", "valid")
        assertTrue(repo.state.value.signedIn); assertTrue(repo.state.value.online)
    }
    @Test fun unavailableCannotAccept() = runTest {
        val api = Backend(); val repo = RiderRepository(api); repo.refresh(); repo.availability(false)
        repo.offer(offer, true); assertEquals(0, api.calls)
    }
    @Test fun fullCapacityCannotAccept() = runTest {
        val api = Backend().apply { snapshot = Board(List(3) { order }, listOf(offer), 3) }
        val repo = RiderRepository(api); repo.refresh(); repo.offer(offer, true)
        assertEquals(0, api.calls)
    }
    @Test fun duplicateTapsProduceOneInFlightCommand() = runTest {
        val api = Backend().apply { gate = CompletableDeferred() }
        val repo = RiderRepository(api); repo.refresh()
        val first = launch(start = CoroutineStart.UNDISPATCHED) { repo.offer(offer, true) }
        repo.offer(offer, true); assertEquals(1, api.calls); assertTrue(repo.state.value.busy)
        api.gate!!.complete(Unit); first.join(); assertFalse(repo.state.value.busy)
    }
    @Test fun offlinePreservesViewButDisablesActionsAndReconnectRefreshes() = runTest {
        val api = Backend().apply { snapshot = Board(listOf(order), emptyList(), 3) }
        val repo = RiderRepository(api); repo.refresh(); api.offline = true; repo.refresh()
        assertFalse(repo.state.value.online); assertEquals(1, repo.state.value.board!!.orders.size)
        repo.advance(order); assertEquals(0, api.calls)
        api.offline = false; api.snapshot = Board(emptyList(), emptyList(), 3); repo.refresh()
        assertTrue(repo.state.value.online); assertTrue(repo.state.value.board!!.orders.isEmpty())
    }
    @Test fun failedMutationDoesNotOptimisticallyAdvance() = runTest {
        val api = Backend().apply { snapshot = Board(listOf(order), emptyList(), 3); response = JSONObject().put("ok", false).put("code", "stale_revision") }
        val repo = RiderRepository(api); repo.refresh(); repo.advance(order)
        assertEquals("assigned", repo.state.value.board!!.orders.single().status)
        assertTrue(repo.state.value.message.contains("stale_revision")); assertFalse(repo.state.value.busy)
    }
    @Test fun logoutRemovesPrivateBoard() = runTest {
        val api = Backend().apply { snapshot = Board(listOf(order), emptyList(), 3) }
        val repo = RiderRepository(api); repo.refresh(); repo.logout()
        assertFalse(repo.state.value.signedIn); assertNull(repo.state.value.board)
    }
    @Test fun wrongCodeFormatNeverCallsBackend() = runTest {
        val api = Backend(); val repo = RiderRepository(api); repo.refresh()
        repo.advance(order.copy(status = "arrived"), "123456"); assertEquals(0, api.calls)
    }
    @Test fun terminalStateCannotBeAdvanced() = runTest {
        val api = Backend(); val repo = RiderRepository(api); repo.refresh()
        repo.advance(order.copy(status = "delivered")); assertEquals(0, api.calls)
    }
}
