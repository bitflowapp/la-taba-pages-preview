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
        override val businessId: String? = "qa-business"
        var snapshot = Board(emptyList(), emptyList(), 3)
        var offline = false
        var rejectLogin = false
        var calls = 0
        var gate: CompletableDeferred<Unit>? = null
        var response = JSONObject().put("ok", true)
        override suspend fun login(email: String, password: String) {
            if (rejectLogin) { hasSession = false; throw ApiFailure(400, "invalid_credentials") }
            hasSession = true
        }
        override suspend fun refresh(force: Boolean) { if (offline) throw IOException() }
        override suspend fun board(): Board { if (offline) throw IOException(); return snapshot }
        override suspend fun rpc(name: String, params: JSONObject): JSONObject {
            if (name == "heartbeat_rider_availability") return JSONObject().put("ok", true)
            calls++; gate?.await(); if (offline) throw IOException()
            if (name == "set_rider_availability") {
                val value = params.getBoolean("p_available")
                snapshot = snapshot.copy(available = value, availabilityVersion = snapshot.availabilityVersion + 1)
                return JSONObject().put("ok", true)
            }
            return response
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
        val api = Backend().apply { snapshot = Board(List(3) { order }, listOf(offer), 3, true, 1) }
        val repo = RiderRepository(api); repo.refresh(); repo.offer(offer, true)
        assertEquals(0, api.calls)
    }
    @Test fun duplicateTapsProduceOneInFlightCommand() = runTest {
        val api = Backend().apply { gate = CompletableDeferred(); snapshot = Board(emptyList(), listOf(offer), 3, true, 1) }
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
    // Mirrors EncryptedBoardStore: what is kept is exactly what the codec keeps.
    private class MemoryStore: BoardStore {
        var cached: CachedBoard? = null
        override fun save(board: Board, confirmedAt: Long) {
            cached = if (board.orders.isEmpty()) null else BoardCodec.decode(BoardCodec.encode(board, confirmedAt))
        }
        override fun load() = cached
        override fun clear() { cached = null }
    }
    private val onTheWay = order.copy(status = "on_the_way", revision = 5)
    @Test fun coldStartWithoutNetworkShowsLastConfirmedMissionAsOfflineInformation() = runTest {
        val store = MemoryStore()
        val api = Backend().apply { snapshot = Board(listOf(onTheWay), listOf(offer), 3, true, 4) }
        RiderRepository(api, store) { 1_000L }.refresh()
        api.offline = true
        val restarted = RiderRepository(api, store) { 2_000L }
        val state = restarted.state.value
        assertEquals(1_000L, state.cachedAt); assertFalse(state.online); assertTrue(state.signedIn)
        assertEquals(listOf("on_the_way"), state.board!!.orders.map { it.status })
        assertTrue("an offer is never restored", state.board!!.offers.isEmpty())
        assertFalse("availability is the server's to say", state.available)
        restarted.refresh()
        assertEquals(1_000L, restarted.state.value.cachedAt); assertFalse(restarted.state.value.online)
        restarted.advance(restarted.state.value.board!!.orders.single())
        assertEquals("offline information never becomes a command", 0, api.calls)
    }
    @Test fun reconnectReconcilesWithTheServerAndForgetsTheOfflineCopy() = runTest {
        val store = MemoryStore()
        val api = Backend().apply { snapshot = Board(listOf(onTheWay), emptyList(), 3) }
        RiderRepository(api, store) { 1_000L }.refresh()
        api.offline = true
        val restarted = RiderRepository(api, store) { 2_000L }
        api.offline = false; api.snapshot = Board(emptyList(), emptyList(), 3)
        restarted.refresh()
        assertTrue(restarted.state.value.online); assertNull(restarted.state.value.cachedAt)
        assertTrue(restarted.state.value.board!!.orders.isEmpty()); assertNull(store.cached)
    }
    @Test fun serverStateReplacesTheOfflineCopyEvenWhenItAdvanced() = runTest {
        val store = MemoryStore()
        val api = Backend().apply { snapshot = Board(listOf(onTheWay), emptyList(), 3) }
        RiderRepository(api, store) { 1_000L }.refresh()
        api.snapshot = Board(listOf(onTheWay.copy(status = "arrived", revision = 6)), emptyList(), 3)
        val restarted = RiderRepository(api, store) { 2_000L }
        assertEquals("on_the_way", restarted.state.value.board!!.orders.single().status)
        restarted.refresh()
        assertEquals("arrived", restarted.state.value.board!!.orders.single().status)
        assertEquals(6L, store.cached!!.board.orders.single().revision)
    }
    @Test fun withoutASessionNoStoredMissionIsShownAndItIsForgotten() = runTest {
        val store = MemoryStore().apply { cached = BoardCodec.decode(BoardCodec.encode(Board(listOf(onTheWay), emptyList(), 3), 7L)) }
        val api = Backend().apply { hasSession = false }
        val repo = RiderRepository(api, store)
        assertNull(repo.state.value.board); assertFalse(repo.state.value.signedIn); assertNull(store.cached)
    }
    @Test fun logoutForgetsTheOfflineCopy() = runTest {
        val store = MemoryStore()
        val api = Backend().apply { snapshot = Board(listOf(onTheWay), emptyList(), 3) }
        val repo = RiderRepository(api, store); repo.refresh(); assertNotNull(store.cached)
        repo.logout(); assertNull(store.cached)
    }
    @Test fun codecKeepsWhatTheMissionNeedsAndNothingElse() {
        val location = JSONObject().put("latitude", -38.95).put("longitude", -68.06)
        val pickup = JSONObject().put("latitude", -38.96).put("longitude", -68.05)
        val delivery = Delivery("o1", "LT-0004", 9, "arrived", "Mendoza 851", "La Taba", "4990.00", location, pickup)
        val restored = BoardCodec.decode(BoardCodec.encode(Board(listOf(delivery), listOf(offer), 3, true, 8), 42L))!!
        val back = restored.board.orders.single()
        assertEquals(42L, restored.confirmedAt); assertEquals(3, restored.board.capacity)
        assertEquals(listOf("o1", "LT-0004", "arrived", "Mendoza 851", "La Taba", "4990.00"),
            listOf(back.id, back.code, back.status, back.address, back.pickup, back.total))
        assertEquals(9L, back.revision); assertEquals(location.toString(), back.location.toString())
        assertEquals(pickup.toString(), back.pickupLocation.toString())
        assertTrue(restored.board.offers.isEmpty()); assertFalse(restored.board.available)
        assertNull(BoardCodec.decode("{\"v\":2}")); assertNull(BoardCodec.decode("not json"))
    }
    @Test fun availabilityComesFromSharedBoardAndPersistsAcrossRepositories() = runTest {
        val api = Backend();val first = RiderRepository(api);val second = RiderRepository(api)
        first.refresh();second.refresh();assertFalse(second.state.value.available)
        first.availability(true);second.refresh()
        assertTrue(first.state.value.available);assertTrue(second.state.value.available)
        second.availability(false);first.refresh()
        assertFalse(first.state.value.available);assertFalse(second.state.value.available)
    }
}
