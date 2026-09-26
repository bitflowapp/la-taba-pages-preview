package com.lataba.rider

import android.content.Intent
import android.os.ParcelFileDescriptor
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Explicitly opted-in physical QA. Restores the device's original network switches in finally. */
class PhysicalResilienceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val repo get() = (context.applicationContext as RiderApplication).repository
    private fun shell(command: String): String = ParcelFileDescriptor.AutoCloseInputStream(
        instrumentation.uiAutomation.executeShellCommand(command)).bufferedReader().use { it.readText().trim() }
    @Test fun persistedSessionOfflineAndForegroundRecovery() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaStaging") == "true")
        assertTrue("Existing encrypted QA session must survive host force-stop", repo.api.hasSession)
        runBlocking { repo.refresh() }
        assertTrue(repo.state.value.online)
        val ids = repo.state.value.board!!.orders.map { it.id }.toSet()
        assertEquals(3, ids.size)
        compose.activityRule.scenario.recreate()
        compose.waitUntil(45000) { repo.state.value.online }
        assertEquals(ids, repo.state.value.board!!.orders.map { it.id }.toSet())
        val wifi = shell("settings get global wifi_on")
        val data = shell("settings get global mobile_data")
        try {
            shell("svc wifi disable"); shell("svc data disable")
            runBlocking { repo.refresh() }
            assertFalse("The device really must be offline", repo.state.value.online)
            assertTrue(repo.state.value.signedIn)
            assertEquals(ids, repo.state.value.board!!.orders.map { it.id }.toSet())
        } finally {
            shell("svc wifi ${if(wifi == "1") "enable" else "disable"}")
            shell("svc data ${if(data == "1") "enable" else "disable"}")
        }
        compose.waitUntil(90000) { runBlocking { repo.refresh() }; repo.state.value.online }
        assertEquals(ids, repo.state.value.board!!.orders.map { it.id }.toSet())
        runBlocking { repo.api.refresh(true); repo.refresh() }
        assertTrue(repo.state.value.online)
        shell("input keyevent 3")
        context.startActivity(Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        compose.waitUntil(45000) { compose.activityRule.scenario.state == Lifecycle.State.RESUMED }
        assertEquals(ids, repo.state.value.board!!.orders.map { it.id }.toSet())
        File(context.filesDir,"qa-resilience-result.json").writeText(JSONObject()
            .put("sessionAfterProcessRestart","PASS").put("offlineRetainsActiveDeliveries","PASS")
            .put("networkRecovery","PASS").put("refreshToken","PASS")
            .put("backgroundForeground","PASS").put("activityRecreation","PASS")
            .put("activeOrders",ids.size).put("stagingOnly",true).toString())
    }
}
