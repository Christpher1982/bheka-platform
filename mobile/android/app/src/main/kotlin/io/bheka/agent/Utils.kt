package io.bheka.agent

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Shared constants and small helpers used across monitoring components. */
object Utils {

    const val TAG = "BhekaAgent"

    // Maximum screenshot dimension per the API contract.
    const val SCREENSHOT_MAX_WIDTH = 1280
    const val SCREENSHOT_JPEG_QUALITY = 55

    // Cap the JSON body well under the 10MB API limit (screenshot base64
    // inflates payload size by ~33% over raw JPEG bytes).
    const val MAX_JSON_BODY_BYTES = 10 * 1024 * 1024
    const val MAX_SCREENSHOT_JPEG_BYTES = 8 * 1024 * 1024

    // Known browser package names -> isBrowser = true in app_usage_session events.
    private val BROWSER_PACKAGES = setOf(
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.chrome.canary",
        "org.mozilla.firefox",
        "org.mozilla.firefox_beta",
        "org.mozilla.fenix",
        "com.microsoft.emmx",
        "com.brave.browser",
        "com.sec.android.app.sbrowser",
        "com.opera.browser",
        "com.opera.mini.native",
        "com.opera.browser.beta",
        "com.duckduckgo.mobile.android"
    )

    fun isBrowserPackage(packageName: String): Boolean = BROWSER_PACKAGES.contains(packageName)

    /** ISO-8601 UTC timestamp formatter, e.g. "2026-08-01T20:30:00Z". */
    fun isoNow(): String = isoFormat(Date())

    fun isoFormat(date: Date): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(date)
    }

    fun isoFormat(epochMillis: Long): String = isoFormat(Date(epochMillis))

    /**
     * Scales [source] down so its width is at most [SCREENSHOT_MAX_WIDTH],
     * preserving aspect ratio. If the bitmap is already narrower, it is
     * returned unchanged (no upscaling).
     */
    fun scaleBitmapForUpload(source: Bitmap): Bitmap {
        if (source.width <= SCREENSHOT_MAX_WIDTH) return source
        val ratio = SCREENSHOT_MAX_WIDTH.toFloat() / source.width.toFloat()
        val targetHeight = (source.height * ratio).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(source, SCREENSHOT_MAX_WIDTH, targetHeight, true)
    }

    /**
     * JPEG-compresses [bitmap] at [SCREENSHOT_JPEG_QUALITY] and returns the
     * bytes. If the result still exceeds [MAX_SCREENSHOT_JPEG_BYTES], the
     * quality is progressively lowered until it fits (or a floor is hit).
     */
    fun compressToJpeg(bitmap: Bitmap): ByteArray {
        var quality = SCREENSHOT_JPEG_QUALITY
        var bytes: ByteArray
        do {
            val stream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream)
            bytes = stream.toByteArray()
            quality -= 10
        } while (bytes.size > MAX_SCREENSHOT_JPEG_BYTES && quality > 10)
        return bytes
    }

    fun base64Encode(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.NO_WRAP)

    /** Decodes a raw byte buffer into a Bitmap, used by ScreenshotManager after ImageReader capture. */
    fun decodeBitmap(bytes: ByteArray): Bitmap? =
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)

    fun logd(message: String) = Log.d(TAG, message)
    fun logw(message: String, throwable: Throwable? = null) = Log.w(TAG, message, throwable)
    fun loge(message: String, throwable: Throwable? = null) = Log.e(TAG, message, throwable)
}
