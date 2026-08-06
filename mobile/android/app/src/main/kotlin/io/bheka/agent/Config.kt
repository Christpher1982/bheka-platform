package io.bheka.agent

import android.content.Context
import android.content.RestrictionsManager
import android.content.SharedPreferences
import android.os.Bundle
import java.util.UUID

/**
 * Central configuration store for the Bheka monitoring agent.
 *
 * Values are persisted in a private SharedPreferences file and can be set
 * three ways, in order of precedence when [refreshFromManagedConfig] is
 * called:
 *   1. MDM-pushed "Managed App Configuration" (RestrictionsManager) — highest
 *      precedence, used by Device Owner / EMM consoles.
 *   2. Manual entry or QR-code enrollment via [MainActivity].
 *   3. Compile-time BuildConfig defaults (used only to pre-fill the UI).
 *
 * See README.md for the MDM AppConfig XML schema that maps to these keys.
 */
object Config {

    private const val PREFS_NAME = "bheka_agent_prefs"

    // SharedPreferences keys. These intentionally match the MDM managed
    // config keys 1:1 so that RestrictionsManager bundles can be applied
    // directly without translation.
    const val KEY_API_URL = "BHEKA_API_URL"
    const val KEY_AGENT_TOKEN = "BHEKA_AGENT_TOKEN"
    const val KEY_TENANT_SLUG = "BHEKA_TENANT_SLUG"
    const val KEY_SITE_ID = "BHEKA_SITE_ID"
    const val KEY_SUBJECT_USER_ID = "BHEKA_SUBJECT_USER_ID"
    const val KEY_SOURCE_AGENT_ID = "BHEKA_SOURCE_AGENT_ID"
    const val KEY_ENROLLED = "BHEKA_ENROLLED"
    const val KEY_MEDIA_PROJECTION_GRANTED = "BHEKA_MEDIA_PROJECTION_GRANTED"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun apiUrl(context: Context): String =
        prefs(context).getString(KEY_API_URL, BuildConfig.DEFAULT_API_URL) ?: BuildConfig.DEFAULT_API_URL

    fun agentToken(context: Context): String =
        prefs(context).getString(KEY_AGENT_TOKEN, BuildConfig.DEFAULT_AGENT_TOKEN) ?: BuildConfig.DEFAULT_AGENT_TOKEN

    fun tenantSlug(context: Context): String =
        prefs(context).getString(KEY_TENANT_SLUG, BuildConfig.DEFAULT_TENANT_SLUG) ?: BuildConfig.DEFAULT_TENANT_SLUG

    fun siteId(context: Context): String =
        prefs(context).getString(KEY_SITE_ID, BuildConfig.DEFAULT_SITE_ID) ?: BuildConfig.DEFAULT_SITE_ID

    fun subjectUserId(context: Context): String =
        prefs(context).getString(KEY_SUBJECT_USER_ID, BuildConfig.DEFAULT_SUBJECT_USER_ID)
            ?: BuildConfig.DEFAULT_SUBJECT_USER_ID

    /**
     * The source agent ID identifies this specific device/install. If not
     * already set via MDM or QR enrollment, it is generated once (UUIDv4)
     * and persisted so it stays stable across service restarts and reboots.
     */
    fun sourceAgentId(context: Context): String {
        val existing = prefs(context).getString(KEY_SOURCE_AGENT_ID, null)
        if (!existing.isNullOrBlank()) return existing
        val generated = UUID.randomUUID().toString()
        prefs(context).edit().putString(KEY_SOURCE_AGENT_ID, generated).apply()
        return generated
    }

    fun isEnrolled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ENROLLED, false)

    fun setEnrolled(context: Context, enrolled: Boolean) {
        prefs(context).edit().putBoolean(KEY_ENROLLED, enrolled).apply()
    }

    fun setMediaProjectionGranted(context: Context, granted: Boolean) {
        prefs(context).edit().putBoolean(KEY_MEDIA_PROJECTION_GRANTED, granted).apply()
    }

    fun isMediaProjectionGranted(context: Context): Boolean =
        prefs(context).getBoolean(KEY_MEDIA_PROJECTION_GRANTED, false)

    /** Persists a full configuration set, e.g. from manual entry or QR code. */
    fun save(
        context: Context,
        apiUrl: String,
        agentToken: String,
        tenantSlug: String,
        siteId: String,
        subjectUserId: String,
        sourceAgentId: String
    ) {
        prefs(context).edit()
            .putString(KEY_API_URL, apiUrl.trim())
            .putString(KEY_AGENT_TOKEN, agentToken.trim())
            .putString(KEY_TENANT_SLUG, tenantSlug.trim())
            .putString(KEY_SITE_ID, siteId.trim())
            .putString(KEY_SUBJECT_USER_ID, subjectUserId.trim())
            .putString(KEY_SOURCE_AGENT_ID, sourceAgentId.trim())
            .putBoolean(KEY_ENROLLED, true)
            .apply()
    }

    /**
     * Reads managed configuration pushed by an EMM/MDM console via
     * RestrictionsManager (Android's "Managed App Configuration" feature)
     * and overlays any present values on top of SharedPreferences. This is
     * the mechanism Device Owner apps use to receive config pushed from the
     * MDM without any user interaction. Call this on app start and whenever
     * ACTION_APPLICATION_RESTRICTIONS_CHANGED is broadcast.
     *
     * Returns true if any managed value was applied.
     */
    fun refreshFromManagedConfig(context: Context): Boolean {
        val restrictionsManager =
            context.getSystemService(Context.RESTRICTIONS_SERVICE) as? RestrictionsManager ?: return false
        val bundle: Bundle = restrictionsManager.applicationRestrictions ?: return false
        if (bundle.isEmpty) return false

        val editor = prefs(context).edit()
        var applied = false

        fun applyIfPresent(key: String) {
            if (bundle.containsKey(key)) {
                val value = bundle.getString(key)
                if (!value.isNullOrBlank()) {
                    editor.putString(key, value)
                    applied = true
                }
            }
        }

        applyIfPresent(KEY_API_URL)
        applyIfPresent(KEY_AGENT_TOKEN)
        applyIfPresent(KEY_TENANT_SLUG)
        applyIfPresent(KEY_SITE_ID)
        applyIfPresent(KEY_SUBJECT_USER_ID)
        applyIfPresent(KEY_SOURCE_AGENT_ID)

        if (applied) {
            editor.putBoolean(KEY_ENROLLED, true)
            editor.apply()
        }
        return applied
    }

    /** True once the minimum fields needed to post events are populated. */
    fun hasMinimumConfig(context: Context): Boolean {
        return apiUrl(context).isNotBlank() &&
            agentToken(context).isNotBlank() &&
            tenantSlug(context).isNotBlank() &&
            siteId(context).isNotBlank() &&
            subjectUserId(context).isNotBlank()
    }
}
