package com.lataba.rider

import org.json.JSONObject

/** Contract boundary for deterministic resilience tests; the installed app uses RiderApi only. */
interface RiderBackend {
    val hasSession: Boolean
    val available: Boolean
    fun available(value: Boolean)
    suspend fun login(email: String, password: String)
    suspend fun refresh(force: Boolean = false)
    suspend fun board(): Board
    suspend fun rpc(name: String, params: JSONObject = JSONObject()): JSONObject
    suspend fun logout()
}
