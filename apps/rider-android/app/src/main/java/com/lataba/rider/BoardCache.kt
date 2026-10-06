package com.lataba.rider

import android.annotation.SuppressLint
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The last board the SERVER confirmed, kept so a cold start without network still shows the active mission. */
data class CachedBoard(val board: Board, val confirmedAt: Long)

/**
 * Only the rider's own active deliveries are kept: offers are never stored (an offer seen offline cannot be
 * accepted and may already belong to someone else). Nothing here is ever sent back to the server: it is shown as
 * offline information and replaced by the next confirmed board.
 */
interface BoardStore {
    fun save(board: Board, confirmedAt: Long)
    fun load(): CachedBoard?
    fun clear()
}

object NoBoardStore: BoardStore {
    override fun save(board: Board, confirmedAt: Long) = Unit
    override fun load(): CachedBoard? = null
    override fun clear() = Unit
}

object BoardCodec {
    fun encode(board: Board, confirmedAt: Long): String = JSONObject()
        .put("v", 1).put("confirmed_at", confirmedAt).put("max_active_orders", board.capacity)
        .put("orders", JSONArray(board.orders.map { it.toJson() })).toString()

    fun decode(text: String): CachedBoard? = runCatching {
        val root = JSONObject(text)
        require(root.getInt("v") == 1)
        val orders = root.getJSONArray("orders")
        val board = Board(List(orders.length()) { Delivery.from(orders.getJSONObject(it)) }, emptyList(),
            root.getInt("max_active_orders").also { require(it > 0) })
        CachedBoard(board, root.getLong("confirmed_at"))
    }.getOrNull()
}

/** Same protection as the session: AES-GCM under an Android Keystore key, no backup (see data_extraction_rules). */
class EncryptedBoardStore(context: Context): BoardStore {
    private val preferences = context.getSharedPreferences("rider_last_confirmed_board", Context.MODE_PRIVATE)
    private val alias = "lataba.rider.${BuildConfig.APPLICATION_ID}.board.v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @SuppressLint("ApplySharedPref")
    @Synchronized override fun save(board: Board, confirmedAt: Long) {
        if (board.orders.isEmpty()) { clear(); return }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(BoardCodec.encode(board, confirmedAt).toByteArray())
        preferences.edit().putString("payload", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).commit()
    }
    @Synchronized override fun load(): CachedBoard? = try {
        preferences.getString("payload", null)?.let {
            val bytes = Base64.decode(it, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            }
            BoardCodec.decode(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size))))
        }
    } catch (_: Exception) { clear(); null }
    @SuppressLint("ApplySharedPref")
    @Synchronized override fun clear() { preferences.edit().clear().commit() }
}
