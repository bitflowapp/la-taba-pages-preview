package com.lataba.rider

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.location.LocationCompat
import kotlinx.coroutines.*
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/** One sampler, no stored GPS queue: never replay stale positions after reconnect. */
class RiderLocationService: Service(), LocationListener {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val repository get() = (application as RiderApplication).repository
    private lateinit var locations: LocationManager
    private var lastSend = 0L
    private var publishing = false
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") { stopSelf(); return START_NOT_STICKY }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            repository.gps("Falta permiso GPS preciso"); stopSelf(); return START_NOT_STICKY
        }
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel("rider_gps", "Reparto y ubicación", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, javaClass).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE)
        startForeground(10, NotificationCompat.Builder(this, "rider_gps").setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(if (BuildConfig.APPLICATION_ID.endsWith(".pilot"))
                "La Taba Rider Piloto · GPS activo" else "La Taba Rider QA · GPS activo")
            .setContentText("Sólo entregas activas de Staging")
            .setContentIntent(open).addAction(0, "Detener GPS", stop).setOngoing(true).build())
        locations = getSystemService(LocationManager::class.java)
        try {
            locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 5000, 0f, this, Looper.getMainLooper())
            if (locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000, 0f, this, Looper.getMainLooper())
            repository.gps("Esperando ubicación real del dispositivo")
        } catch (_: SecurityException) { repository.gps("Permiso de ubicación revocado"); stopSelf() }
        return START_NOT_STICKY
    }
    override fun onCreate() {
        super.onCreate()
        scope.launch {
            while (isActive) {
                repository.refresh()
                val state = repository.state.value
                if (!state.signedIn || (state.online && state.board?.orders?.none { it.publishable } == true)) { stopSelf(); break }
                delay(5000)
            }
        }
    }
    override fun onLocationChanged(location: Location) {
        val now = SystemClock.elapsedRealtime()
        if (publishing || now - lastSend < 6000 || !location.hasAccuracy() || location.accuracy > 250 ||
            now - location.elapsedRealtimeNanos / 1_000_000 > 30_000 || LocationCompat.isMock(location)) return
        if (repository.state.value.board?.orders?.any { it.publishable } != true) return
        publishing = true; lastSend = now
        scope.launch {
            try {
                val receipt = repository.api.rpc("publish_rider_location_fanout", JSONObject()
                    .put("p_lat", location.latitude).put("p_lng", location.longitude).put("p_accuracy", location.accuracy.toDouble())
                    .put("p_heading", if (location.hasBearing()) location.bearing.toDouble() else JSONObject.NULL)
                    .put("p_speed", if (location.hasSpeed()) location.speed.toDouble() else JSONObject.NULL)
                    .put("p_captured_at", Instant.ofEpochMilli(location.time).toString())
                    .put("p_idempotency_key", UUID.randomUUID().toString()).put("p_is_mock", false))
                repository.gps(if (receipt.optBoolean("ok")) "GPS real enviado · recibo recibido" else "GPS no confirmado por servidor")
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { repository.gps("GPS sin conexión: esperando muestra nueva") }
            finally { publishing = false }
        }
    }
    override fun onDestroy() {
        if (::locations.isInitialized) locations.removeUpdates(this)
        scope.cancel(); repository.gps("GPS detenido"); super.onDestroy()
    }
}
