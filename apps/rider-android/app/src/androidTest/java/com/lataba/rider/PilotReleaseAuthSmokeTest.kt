package com.lataba.rider

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.net.InetSocketAddress
import java.net.Socket

/** Exercises the actual signed .pilot package, not a debug lookalike. */
class PilotReleaseAuthSmokeTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val target get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val repo get() = (target.applicationContext as RiderApplication).repository

    @Test fun signedPilotLogsInToStagingWithRiderRole() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaStaging") == "true")
        assumeTrue(target.packageName == "com.lataba.rider.pilot")
        val port = InstrumentationRegistry.getArguments().getString("qaPort")?.toIntOrNull()
        assertTrue("One-time QA bridge port required", port != null && port in 40_000..60_000)
        val input = Socket().use { socket ->
            socket.connect(InetSocketAddress("127.0.0.1", port!!), 5_000)
            socket.soTimeout = 5_000
            JSONObject(requireNotNull(socket.getInputStream().bufferedReader().readLine()))
        }
        try {
            runBlocking { repo.refresh() }
            compose.waitUntil(30_000) { !repo.state.value.signedIn || repo.state.value.board != null }
            if (!repo.state.value.signedIn) {
                compose.onNodeWithTag("email").performTextInput(input.getString("email"))
                compose.onNodeWithTag("password").performTextInput(input.getString("password"))
                compose.onNodeWithTag("login").performClick()
            }
            try {
                compose.waitUntil(60_000) {
                    repo.state.value.signedIn && repo.state.value.online && repo.state.value.board != null
                }
            } catch (error: Exception) {
                val state = repo.state.value
                throw AssertionError("PILOT_LOGIN_NOT_READY signed=${state.signedIn} online=${state.online} " +
                    "board=${state.board != null} message=${state.message.take(80)}", error)
            }
            assertEquals("a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0", repo.api.businessId)
            assertEquals(3, repo.state.value.board!!.capacity)
            assertTrue(repo.state.value.online)
        } finally {
            input.remove("password")
            runBlocking { if (repo.state.value.signedIn) repo.logout() }
        }
    }
}
