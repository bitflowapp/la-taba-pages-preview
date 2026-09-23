package com.lataba.rider

import android.Manifest
import android.content.Intent
import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File

/** One continuous real-device hour. Host may turn screen/network off, but never supplies GPS. */
class PhysicalSoakTest {
    @get:Rule(order = 0) val permissions = GrantPermissionRule.grant(
        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<MainActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val repo get() = (context.applicationContext as RiderApplication).repository
    private fun until(timeout: Long = 45000, predicate: () -> Boolean) = compose.waitUntil(timeout) { predicate() }
    @Test fun oneHourForegroundBackgroundAndDelivery() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaStaging") == "true")
        val inputFile = File(context.filesDir, "qa-input.json")
        assumeTrue("Explicit private QA input required", inputFile.exists())
        val input = JSONObject(inputFile.readText()); inputFile.delete()
        val progress = File(context.filesDir, "qa-soak-progress.json")
        try {
            // A cached token may be revoked by another QA login. Resolve it before choosing UI.
            runBlocking { repo.refresh() }
            until(90000){!repo.state.value.signedIn ||
                (repo.state.value.online && repo.state.value.board!=null)}
            if(!repo.state.value.signedIn){
                compose.onNodeWithTag("email").performTextInput(input.getString("email"))
                compose.onNodeWithTag("password").performTextInput(input.getString("password"))
                compose.onNodeWithTag("login").performClick()
            }
            until(90000){repo.state.value.signedIn&&repo.state.value.online&&repo.state.value.board!=null}
            val code=input.getString("publicCode")
            if(!repo.state.value.available){
                compose.onNodeWithTag("available").performClick()
                until(90000){repo.state.value.available&&repo.state.value.online&&!repo.state.value.busy}
            }
            until(60000){repo.state.value.board!!.offers.any{it.code==code} || repo.state.value.board!!.orders.any{it.code==code}}
            if(repo.state.value.board!!.orders.none{it.code==code}){
                compose.onNodeWithTag("accept-$code").performScrollTo().performClick()
                until{repo.state.value.board!!.orders.any{it.code==code&&it.status=="assigned"}}
            }
            compose.onNodeWithTag("detail-$code").performScrollTo().performClick()
            if(repo.state.value.board!!.orders.any{it.code==code&&it.status=="assigned"}){
                compose.onNodeWithTag("advance").performScrollTo().performClick()
                until{repo.state.value.board!!.orders.any{it.code==code&&it.status=="picked_up"}}
            }
            if(repo.state.value.board!!.orders.any{it.code==code&&it.status=="picked_up"}){
                compose.onNodeWithTag("advance").performScrollTo().performClick()
                until{repo.state.value.board!!.orders.any{it.code==code&&it.status=="on_the_way"}}
            }
            compose.onNodeWithTag("gps-start").performScrollTo().performClick()
            until(120000){repo.state.value.gps.contains("recibo recibido")}
            val start=SystemClock.elapsedRealtime()
            var failedMinutes=0;var recoveredMinutes=0;var offlineMinutes=0
            progress.writeText(JSONObject().put("started",true).put("elapsed_minutes",0)
                .put("active_delivery",true).put("staging_only",true).toString())
            // A status sample each minute; the backend receipts are counted by the host separately.
            for(minute in 1..60){
                Thread.sleep(60_000)
                runBlocking { repo.refresh() }
                val state=repo.state.value
                assertTrue("Delivery lost while soaking",state.board?.orders?.any{it.code==code}==true)
                if(!state.online)offlineMinutes++ else recoveredMinutes++
                if(state.gps.contains("sin conexión")||state.gps.contains("no confirmado"))failedMinutes++
                progress.writeText(JSONObject().put("elapsed_minutes",minute)
                    .put("online",state.online).put("active_delivery",true)
                    .put("gps_failure_minutes",failedMinutes).put("offline_minutes",offlineMinutes)
                    .put("recovered_minutes",recoveredMinutes).put("staging_only",true).toString())
            }
            context.startActivity(Intent(context,MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            until(45000){repo.state.value.online&&repo.state.value.board!!.orders.any{it.code==code}}
            val uiVisible=compose.activityRule.scenario.state==Lifecycle.State.RESUMED
            if(uiVisible){
                compose.onNodeWithTag("advance").performScrollTo().performClick()
                until{repo.state.value.board!!.orders.any{it.code==code&&it.status=="arrived"}}
                compose.onNodeWithTag("delivery-code").performScrollTo().performTextInput(input.getString("deliveryCode"))
                compose.onNodeWithTag("advance").performScrollTo().performClick()
            }else{
                val active=repo.state.value.board!!.orders.first{it.code==code}
                runBlocking{repo.advance(active)}
                until{repo.state.value.board!!.orders.any{it.code==code&&it.status=="arrived"}}
                val arrived=repo.state.value.board!!.orders.first{it.code==code}
                runBlocking{repo.advance(arrived,input.getString("deliveryCode"))}
            }
            until{repo.state.value.board!!.orders.none{it.code==code}}
            assertTrue(SystemClock.elapsedRealtime()-start>=3_600_000)
            progress.writeText(JSONObject().put("elapsed_minutes",60).put("completed",true)
                .put("completion_via_ui",uiVisible)
                .put("gps_failure_minutes",failedMinutes).put("offline_minutes",offlineMinutes)
                .put("recovered_minutes",recoveredMinutes).put("staging_only",true).toString())
        }finally{input.remove("password");input.remove("deliveryCode");inputFile.delete()}
    }
}
