package com.lataba.rider

import android.Manifest
import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.net.InetSocketAddress
import java.net.Socket

/** Full QA delivery through the signed, non-debuggable pilot APK. */
class PilotReleasePhysicalTest {
    @get:Rule(order = 0) val permissions = GrantPermissionRule.grant(
        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<MainActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val repo get() = (context.applicationContext as RiderApplication).repository
    private fun until(timeout: Long = 45_000, predicate: () -> Boolean) = compose.waitUntil(timeout) { predicate() }

    @Test fun signedPilotAcceptsTracksAndCompletesQaOrder() {
        val arguments = InstrumentationRegistry.getArguments()
        val qaStaging = arguments.getString("qaStaging") == "true"
        val qaPilot = arguments.getString("qaPilot") == "true"
        assumeTrue(qaStaging != qaPilot)
        assumeTrue(context.packageName == "com.lataba.rider.pilot")
        val port = arguments.getString("qaPort")?.toIntOrNull()
        assertTrue("One-time QA bridge port required", port != null && port in 40_000..60_000)
        val input = Socket().use { socket ->
            socket.connect(InetSocketAddress("127.0.0.1", port!!), 5_000)
            socket.soTimeout = 5_000
            JSONObject(requireNotNull(socket.getInputStream().bufferedReader().readLine()))
        }
        try {
            runBlocking { repo.refresh() }
            until(90_000) { !repo.state.value.signedIn ||
                (repo.state.value.online && repo.state.value.board != null) }
            if (!repo.state.value.signedIn) {
                compose.onNodeWithTag("email").performTextInput(input.getString("email"))
                compose.onNodeWithTag("password").performTextInput(input.getString("password"))
                compose.onNodeWithTag("login").performClick()
            }
            until(90_000) { repo.state.value.signedIn && repo.state.value.online && repo.state.value.board != null }
            input.remove("password")
            val expectedBusiness = if (qaPilot) input.getString("businessId")
                else "a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0"
            assertEquals(expectedBusiness, repo.api.businessId)
            assertEquals(3, repo.state.value.board!!.capacity)
            if (!repo.state.value.available) {
                compose.onNodeWithTag("available").performClick()
                until(90_000) { repo.state.value.available && repo.state.value.online && !repo.state.value.busy }
            }
            val code = input.getString("publicCode")
            until(180_000) { repo.state.value.board!!.offers.any { it.code == code } ||
                repo.state.value.board!!.orders.any { it.code == code } }
            if (repo.state.value.board!!.orders.none { it.code == code }) {
                compose.onNodeWithTag("accept-$code").performScrollTo().performClick()
                until { repo.state.value.board!!.orders.any { it.code == code && it.status == "assigned" } }
            }
            compose.onNodeWithTag("detail-$code").performScrollTo().performClick()
            if (repo.state.value.board!!.orders.any { it.code == code && it.status == "assigned" }) {
                compose.onNodeWithTag("advance").performScrollTo().performClick()
                until { repo.state.value.board!!.orders.any { it.code == code && it.status == "picked_up" } }
            }
            if (repo.state.value.board!!.orders.any { it.code == code && it.status == "picked_up" }) {
                compose.onNodeWithTag("advance").performScrollTo().performClick()
                until { repo.state.value.board!!.orders.any { it.code == code && it.status == "on_the_way" } }
            }
            compose.onNodeWithTag("gps-start").performScrollTo().performClick()
            until(120_000) { repo.state.value.gps.contains("recibo recibido") }
            // Keep the real GPS receipt observable while the independent web
            // contexts poll both public tracking and the business panel.
            Thread.sleep(90_000)
            assertTrue(repo.state.value.board!!.orders.any { it.code == code })
            if (repo.state.value.board!!.orders.any { it.code == code && it.status == "on_the_way" }) {
                compose.onNodeWithTag("advance").performScrollTo().performClick()
                until { repo.state.value.board!!.orders.any { it.code == code && it.status == "arrived" } }
            }
            val correct = input.getString("deliveryCode")
            val wrong = if (correct == "0000") "1111" else "0000"
            compose.onNodeWithTag("delivery-code").performScrollTo().performTextInput(wrong)
            compose.onNodeWithTag("advance").performScrollTo().performClick()
            until { !repo.state.value.busy && repo.state.value.message.startsWith("No confirmado") }
            assertTrue(repo.state.value.board!!.orders.any { it.code == code && it.status == "arrived" })
            compose.onNodeWithTag("delivery-code").performScrollTo().performTextInput(correct)
            compose.onNodeWithTag("advance").performScrollTo().performClick()
            until { repo.state.value.board!!.orders.none { it.code == code } }
        } finally {
            input.remove("password")
            input.remove("deliveryCode")
            context.stopService(Intent(context, RiderLocationService::class.java))
            runBlocking { if (repo.state.value.signedIn) repo.logout() }
        }
    }
}
