package com.lataba.rider

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ApiFailure(val status: Int, val code: String): Exception("Backend: $code ($status)")
class RiderApi(private val vault: SessionVault): RiderBackend {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()
    private val refreshLock = Mutex()
    @Volatile private var session: JSONObject? = vault.read()?.let { runCatching { JSONObject(it) }.getOrNull() }
    override val hasSession get() = session != null
    override val businessId get() = session?.optString("business_id")?.takeIf { it.isNotEmpty() }
    private fun save() { session?.let { vault.save(it.toString()) } }

    private suspend fun request(path: String, body: JSONObject?, token: String? = null): String = withContext(Dispatchers.IO) {
        check(BuildConfig.SUPABASE_URL == "https://ucbtjcurawxjwjdvvcvj.supabase.co")
        check(BuildConfig.PUBLIC_KEY.startsWith("sb_publishable_")) { "Falta configuración pública Staging" }
        val req = Request.Builder().url(BuildConfig.SUPABASE_URL + path).header("apikey", BuildConfig.PUBLIC_KEY)
            .header("X-Client-Info", "lataba-rider-android-canonical/" + BuildConfig.VERSION_NAME)
        if (token != null) req.header("Authorization", "Bearer $token")
        if (body != null) req.post(body.toString().toRequestBody("application/json".toMediaType()))
        http.newCall(req.build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val code = runCatching { JSONObject(text).optString("code", "request_failed") }.getOrDefault("request_failed")
                throw ApiFailure(response.code, code.take(60))
            }
            text
        }
    }
    private fun acceptSession(auth: JSONObject, previous: JSONObject? = session) {
        auth.put("expires_at", System.currentTimeMillis() / 1000 + auth.getLong("expires_in"))
        previous?.let { auth.put("business_id", it.optString("business_id")) }
        session = auth
        save()
    }
    override suspend fun login(email: String, password: String) {
        val auth = JSONObject(request("/auth/v1/token?grant_type=password", JSONObject().put("email", email).put("password", password)))
        acceptSession(auth, null)
        try {
            val memberships = JSONArray(authorized("/rest/v1/business_members?select=business_id,role,is_active&user_id=eq.${auth.getJSONObject("user").getString("id")}&role=eq.rider&is_active=eq.true", null))
            check(memberships.length() == 1) { "Se requiere una membresía Rider activa única" }
            session!!.put("business_id", memberships.getJSONObject(0).getString("business_id"))
            save()
            val registration = rpc("identity_register_session", JSONObject().put("p_business_id", businessId)
                .put("p_client", "rider_android").put("p_device_label", "Android Rider QA")
                .put("p_device_key_hash", JSONObject.NULL).put("p_app_version", BuildConfig.VERSION_NAME))
            check(registration.optBoolean("ok") && registration.optString("role") == "rider") { "Rol Rider requerido" }
        } catch (e: Exception) { clear(); throw e }
    }
    override suspend fun refresh(force: Boolean) = refreshLock.withLock {
        val previous = session ?: throw ApiFailure(401, "session_required")
        if (!force && previous.getLong("expires_at") > System.currentTimeMillis() / 1000 + 90) return@withLock
        try {
            val refreshed = JSONObject(request("/auth/v1/token?grant_type=refresh_token",
                JSONObject().put("refresh_token", previous.getString("refresh_token"))))
            // A pending refresh must never resurrect a session after logout/re-login.
            if (session !== previous) throw ApiFailure(401, "session_changed")
            acceptSession(refreshed, previous)
        } catch (e: ApiFailure) { if (session === previous && e.status in setOf(400, 401, 403)) clear(); throw e }
    }
    private suspend fun authorized(path: String, body: JSONObject?): String {
        refresh()
        return try { request(path, body, session!!.getString("access_token")) }
        catch (e: ApiFailure) {
            if (e.status != 401) throw e
            refresh(true)
            request(path, body, session!!.getString("access_token"))
        }
    }
    override suspend fun rpc(name: String, params: JSONObject) = JSONObject(authorized("/rest/v1/rpc/$name", params))
    override suspend fun board() = Board.from(rpc("get_rider_delivery_board"))
    override suspend fun logout() {
        try { if (hasSession) rpc("identity_close_own_session", JSONObject().put("p_business_id", businessId)) }
        finally { clear() }
    }
    fun clear() { session = null; vault.clear() }
}
