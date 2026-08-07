package io.bheka.agent

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import android.util.DisplayMetrics
import android.view.WindowManager
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import java.nio.ByteBuffer
import kotlin.coroutines.resume

/**
 * Handles periodic screenshot capture via MediaProjection + ImageReader, and
 * runs on-device OCR (ML Kit Text Recognition) on each captured frame.
 *
 * MediaProjection permission is granted once per user session (the grant
 * dialog is shown by the system and cannot be MDM-silenced), via
 * [MediaProjectionRequestActivity]. The resulting Intent (the "token") is
 * cached in-memory by [BhekaMonitoringService] and passed here; a fresh
 * MediaProjection object must be created from it, and it becomes invalid
 * when the projection is stopped or the process dies, in which case the
 * service must re-request it (see [isActive]).
 */
class ScreenshotManager(private val context: Context) {

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var handlerThread: HandlerThread? = null
    private var handler: Handler? = null

    private var displayWidth = 0
    private var displayHeight = 0
    private var displayDensity = 0

    private val textRecognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    /**
     * Starts (or restarts) the capture pipeline using a MediaProjection
     * grant [resultCode]/[resultData] obtained from the system permission
     * dialog. Safe to call again to refresh a stale projection.
     */
    fun start(mediaProjectionManager: MediaProjectionManager, resultCode: Int, resultData: Intent) {
        stop() // tear down any previous session first

        mediaProjection = mediaProjectionManager.getMediaProjection(resultCode, resultData)

        val metrics = DisplayMetrics()
        val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getRealMetrics(metrics)
        displayWidth = metrics.widthPixels
        displayHeight = metrics.heightPixels
        displayDensity = metrics.densityDpi

        handlerThread = HandlerThread("BhekaScreenshotThread").also { it.start() }
        handler = Handler(handlerThread!!.looper)

        // Android 14+ requires registering a callback before creating a
        // VirtualDisplay from this projection; it also lets us detect when
        // the user revokes capture from the system status bar so we can
        // clean up instead of holding a dangling reference.
        mediaProjection?.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                Utils.logw("MediaProjection stopped by the system or user")
                stop()
            }
        }, handler)

        imageReader = ImageReader.newInstance(displayWidth, displayHeight, android.graphics.PixelFormat.RGBA_8888, 2)

        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "BhekaScreenCapture",
            displayWidth,
            displayHeight,
            displayDensity,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface,
            null,
            handler
        )

        Utils.logd("ScreenshotManager started: ${displayWidth}x${displayHeight}")
    }

    fun isActive(): Boolean = mediaProjection != null && virtualDisplay != null

    /**
     * Captures a single frame from the ImageReader, converts it to a
     * Bitmap, scales/compresses it per the API contract, runs OCR, and
     * returns a ready-to-post `screenshot_capture` metadata JSON object.
     * Returns null if capture failed (e.g. no frame available yet, or the
     * projection has become invalid) so the caller can skip this tick.
     */
    suspend fun captureAndBuildMetadata(activeWindowTitle: String): JSONObject? {
        val reader = imageReader ?: return null
        val bitmap = try {
            captureBitmap(reader)
        } catch (e: Exception) {
            Utils.loge("Screenshot capture failed", e)
            null
        } ?: return null

        val scaled = Utils.scaleBitmapForUpload(bitmap)
        val jpegBytes = Utils.compressToJpeg(scaled)
        val base64 = Utils.base64Encode(jpegBytes)

        val ocrText = try {
            runOcr(scaled)
        } catch (e: Exception) {
            Utils.logw("OCR failed, continuing without text", e)
            null
        }

        return JSONObject().apply {
            put("screenshotImageBase64", base64)
            put("ocrText", ocrText)
            put("activeWindowTitle", activeWindowTitle)
            put("screenshotWidth", scaled.width)
            put("screenshotHeight", scaled.height)
        }
    }

    private fun captureBitmap(reader: ImageReader): Bitmap? {
        val image: Image = reader.acquireLatestImage() ?: return null
        try {
            val plane = image.planes[0]
            val buffer: ByteBuffer = plane.buffer
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPadding = rowStride - pixelStride * image.width

            val bitmap = Bitmap.createBitmap(
                image.width + rowPadding / pixelStride,
                image.height,
                Bitmap.Config.ARGB_8888
            )
            bitmap.copyPixelsFromBuffer(buffer)

            // Crop off any row padding introduced by the stride requirement.
            return if (rowPadding == 0) {
                bitmap
            } else {
                Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)
            }
        } finally {
            image.close()
        }
    }

    private suspend fun runOcr(bitmap: Bitmap): String? = suspendCancellableCoroutine { cont ->
        val inputImage = InputImage.fromBitmap(bitmap, 0)
        textRecognizer.process(inputImage)
            .addOnSuccessListener { visionText ->
                val text = visionText.text
                if (cont.isActive) cont.resume(if (text.isBlank()) null else text)
            }
            .addOnFailureListener { e ->
                Utils.logw("ML Kit OCR failed", e)
                if (cont.isActive) cont.resume(null)
            }
    }

    fun stop() {
        try {
            virtualDisplay?.release()
            imageReader?.close()
            mediaProjection?.stop()
            handlerThread?.quitSafely()
        } catch (e: Exception) {
            Utils.logw("Error while stopping ScreenshotManager", e)
        } finally {
            virtualDisplay = null
            imageReader = null
            mediaProjection = null
            handlerThread = null
            handler = null
        }
    }

    companion object {
        const val EXTRA_RESULT_CODE = "extra_result_code"
        const val EXTRA_RESULT_DATA = "extra_result_data"
        const val ACTION_PROJECTION_GRANTED = "io.bheka.agent.ACTION_PROJECTION_GRANTED"
        const val ACTION_PROJECTION_DENIED = "io.bheka.agent.ACTION_PROJECTION_DENIED"
    }
}

/**
 * Transparent activity whose sole purpose is to call
 * MediaProjectionManager.createScreenCaptureIntent() and relay the result
 * back to BhekaMonitoringService via a broadcast, since a Service cannot
 * call startActivityForResult itself.
 */
class MediaProjectionRequestActivity : Activity() {

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        val projectionManager =
            getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(projectionManager.createScreenCaptureIntent(), REQUEST_CODE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                Config.setMediaProjectionGranted(applicationContext, true)
                val intent = Intent(ScreenshotManager.ACTION_PROJECTION_GRANTED).apply {
                    setPackage(packageName)
                    putExtra(ScreenshotManager.EXTRA_RESULT_CODE, resultCode)
                    putExtra(ScreenshotManager.EXTRA_RESULT_DATA, data)
                }
                sendBroadcast(intent)
            } else {
                Config.setMediaProjectionGranted(applicationContext, false)
                Utils.logw("User denied MediaProjection (screen capture) permission")
                sendBroadcast(Intent(ScreenshotManager.ACTION_PROJECTION_DENIED).setPackage(packageName))
            }
        }
        finish()
    }

    companion object {
        private const val REQUEST_CODE = 4201
    }
}
