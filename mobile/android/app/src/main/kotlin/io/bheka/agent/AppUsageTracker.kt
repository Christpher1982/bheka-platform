package io.bheka.agent

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Process
import kotlinx.coroutines.delay
import org.json.JSONObject

/**
 * Tracks which app is in the foreground by polling UsageStatsManager every
 * 5 seconds, and posts an `app_usage_session` event whenever the foreground
 * app changes (session = time spent in one app before switching).
 *
 * Sessions shorter than 2 seconds are discarded as noise (matches the
 * Windows agent's debounce logic for quick alt-tabs).
 */
class AppUsageTracker(
    private val context: Context,
    private val apiClient: ApiClient
) {

    private val usageStatsManager =
        context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    private val packageManager = context.packageManager

    private var currentPackage: String? = null
    private var currentWindowTitle: String = ""
    private var sessionStartMillis: Long = 0L

    companion object {
        const val POLL_INTERVAL_MS = 5_000L
        const val MIN_SESSION_DURATION_SECONDS = 2L
    }

    /** Must be granted manually by the user (or MDM policy) under Settings > Special access > Usage access. */
    fun hasUsageAccessPermission(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /**
     * Runs forever (until the enclosing coroutine is cancelled), polling the
     * foreground app every [POLL_INTERVAL_MS] and emitting a session event
     * on every app switch.
     */
    suspend fun runLoop() {
        if (!hasUsageAccessPermission()) {
            Utils.logw("Usage access not granted; app usage tracking disabled until permission is granted")
        }
        while (true) {
            try {
                pollOnce()
            } catch (e: Exception) {
                Utils.loge("AppUsageTracker poll failed", e)
            }
            delay(POLL_INTERVAL_MS)
        }
    }

    private suspend fun pollOnce() {
        val foregroundPackage = queryForegroundPackage() ?: return
        if (foregroundPackage == currentPackage) return // no change, still in the same session

        // App changed: close out the previous session (if any) and start a new one.
        val now = System.currentTimeMillis()
        val previousPackage = currentPackage
        val previousWindowTitle = currentWindowTitle
        val previousStart = sessionStartMillis

        if (previousPackage != null) {
            val durationSeconds = (now - previousStart) / 1000.0
            if (durationSeconds >= MIN_SESSION_DURATION_SECONDS) {
                postSession(previousPackage, previousWindowTitle, previousStart, now, durationSeconds)
            } else {
                Utils.logd("Discarding short session for $previousPackage (${durationSeconds}s < ${MIN_SESSION_DURATION_SECONDS}s)")
            }
        }

        currentPackage = foregroundPackage
        currentWindowTitle = resolveAppLabel(foregroundPackage)
        sessionStartMillis = now
    }

    private suspend fun postSession(
        processName: String,
        windowTitle: String,
        startedAtMillis: Long,
        endedAtMillis: Long,
        durationSeconds: Double
    ) {
        val metadata = JSONObject().apply {
            put("processName", processName)
            put("windowTitle", windowTitle)
            put("isBrowser", Utils.isBrowserPackage(processName))
            put("startedAt", Utils.isoFormat(startedAtMillis))
            put("endedAt", Utils.isoFormat(endedAtMillis))
            put("durationSeconds", durationSeconds)
        }
        val result = apiClient.postEvent(
            eventType = "app_usage_session",
            occurredAt = Utils.isoFormat(endedAtMillis),
            metadata = metadata
        )
        if (result is ApiClient.Result.Failure) {
            Utils.logw("app_usage_session post failed: ${result.message}")
        }
    }

    /**
     * Queries the most recent MOVE_TO_FOREGROUND event within the last
     * polling window to determine the current foreground app. Falls back to
     * querying a slightly larger window on the first call.
     */
    private fun queryForegroundPackage(): String? {
        val end = System.currentTimeMillis()
        val start = end - (POLL_INTERVAL_MS * 4) // look back a bit further than one tick to avoid gaps
        val events: UsageEvents = usageStatsManager.queryEvents(start, end)
        var lastForegroundPackage: String? = null
        var lastTimestamp = 0L

        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND || event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
                if (event.timeStamp >= lastTimestamp) {
                    lastTimestamp = event.timeStamp
                    lastForegroundPackage = event.packageName
                }
            }
        }
        return lastForegroundPackage ?: currentPackage
    }

    private fun resolveAppLabel(packageName: String): String {
        return try {
            val appInfo = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(appInfo).toString()
        } catch (e: PackageManager.NameNotFoundException) {
            packageName
        }
    }
}
