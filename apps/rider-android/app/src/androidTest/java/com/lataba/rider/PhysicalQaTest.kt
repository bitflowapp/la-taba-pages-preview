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
import org.junit.Rule
import org.junit.Test
import org.junit.Assume.assumeTrue
import java.io.File

class PhysicalQaTest {
    @get:Rule(order = 0) val permissions: GrantPermissionRule = GrantPermissionRule.grant(
        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<MainActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val repo get() = (context.applicationContext as RiderApplication).repository
    private fun until(timeout: Long = 45000, predicate: () -> Boolean) = compose.waitUntil(timeout) { predicate() }
    @Test fun physicalStagingFlow() {
        val file = File(context.filesDir, "qa-input.json")
        assumeTrue("Requires explicit QA input placed in app-private storage", file.exists())
        val input = JSONObject(file.readText()); file.delete()
        try {
            runBlocking { repo.refresh() }
            until(90000) { !repo.state.value.signedIn ||
                (repo.state.value.online && repo.state.value.board != null) }
            if (!repo.state.value.signedIn) {
                compose.onNodeWithTag("email").performTextInput(input.getString("email"))
                compose.onNodeWithTag("password").performTextInput(input.getString("password"))
                compose.onNodeWithTag("login").performClick()
            }
            until { repo.state.value.signedIn && repo.state.value.online && repo.state.value.board != null }
            assertEquals(3, repo.state.value.board!!.capacity)
            runBlocking { repo.api.refresh(true); repo.refresh() }
            assertTrue(repo.state.value.online)
            if (!repo.state.value.available) compose.onNodeWithTag("available").performClick()
            if (!input.has("publicCode")) return
            val code = input.getString("publicCode")
            until { repo.state.value.board!!.offers.any { it.code == code } || repo.state.value.board!!.orders.any { it.code == code } }
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
            until(120000) { repo.state.value.gps.contains("recibo recibido") }
            if (input.optBoolean("waitForObservers")) {
                File(context.filesDir, "qa-observer-ready").writeText("REAL_GPS_RECEIPT")
                until(300000) { File(context.filesDir, "qa-observer-continue").exists() }
                File(context.filesDir, "qa-observer-continue").delete()
                File(context.filesDir, "qa-observer-ready").delete()
            }
            // Activity recreation (not a process-death claim) restores navigation and server delivery.
            compose.activityRule.scenario.recreate()
            until { repo.state.value.online && repo.state.value.board!!.orders.any { it.code == code } }
            compose.onNodeWithTag("advance").assertExists()
            if (repo.state.value.board!!.orders.any { it.code == code && it.status == "on_the_way" }) {
                compose.onNodeWithTag("advance").performScrollTo().performClick()
                until { repo.state.value.board!!.orders.any { it.code == code && it.status == "arrived" } }
            }
            // Incorrect code must not complete the delivery.
            val wrong = if (input.getString("deliveryCode") == "0000") "1111" else "0000"
            compose.onNodeWithTag("delivery-code").performScrollTo().performTextInput(wrong)
            compose.onNodeWithTag("advance").performScrollTo().performClick()
            until { !repo.state.value.busy && repo.state.value.message.startsWith("No confirmado") }
            assertTrue(repo.state.value.board!!.orders.any { it.code == code && it.status == "arrived" })
            compose.onNodeWithTag("delivery-code").performScrollTo().performTextInput(input.getString("deliveryCode"))
            compose.onNodeWithTag("advance").performScrollTo().performClick()
            until { repo.state.value.board!!.orders.none { it.code == code } }
            assertTrue(repo.state.value.online)
        } finally {
            input.remove("password"); input.remove("deliveryCode")
            file.delete()
        }
    }
}
