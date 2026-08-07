package io.bheka.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Persistent foreground service that orchestrates all three monitoring
 * loops (keystroke capture is handled separately by the always-on
 * BhekaAccessibilityService; this service drives screenshots and app-usage
 * polling, and keeps the process alive via a foreground notification).
 *
 * Restart behavior:
 *  - Returns START_STICKY so the system restarts the service if it's
 *    killed under memory pressure.
 *  - BootReceiver restarts it after device reboot.
 *  - The MediaProjection grant does not survive process death; if the
 *    cached token is missing/expired, screenshot capture pauses and a
 *    notification prompts the user to re-grant it (see [ensureProjection]).
 */
class BhekaMonitoringService : Service() {

    private val serviceJob = Job()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)

    private lateinit var apiClient: ApiClient
    private lateinit var screenshotManager: ScreenshotManager
    private lateinit var appUsageTracker: AppUsageTracker

    private var screenshotLoopJob: Job? = null
    private var appUsageLoopJob: Job? = null

    // Cached MediaProjection grant (in-memory only; Android does not let us
    // persist this token across process death — it must be re-requested).
    private var pendingProjectionResultCode: Int? = null
    private var pendingProjectionResultData: Intent? = null

    private val projectionResultReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            when (intent?.action) {
                ScreenshotManager.ACTION_PROJECTION_GRANTED -> {
                    val resultCode = intent.getIntExtra(ScreenshotManager.EXTRA_RESULT_CODE, 0)
                    val resultData = intent.getParcelableExtra<Intent>(ScreenshotManager.EXTRA_RESULT_DATA)
                    if (resultData != null) {
                        startScreenshotPipeline(resultCode, resultData)
                    }
                }
                ScreenshotManager.ACTION_PROJECTION_DENIED -> {
                    Utils.logw("MediaProjection permission denied; screenshots disabled until re-granted")
                    notifyPermissionNeeded(
                        "Screen capture permission needed",
                        "Bheka needs screen recording permission to capture activity screenshots."
                    )
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        apiClient = ApiClient(applicationContext)
        screenshotManager = ScreenshotManager(applicationContext)
        appUsageTracker = AppUsageTracker(applicationContext, apiClient)

        createNotificationChannel()

        val filter = IntentFilter().apply {
            addAction(ScreenshotManager.ACTION_PROJECTION_GRANTED)
            addAction(ScreenshotManager.ACTION_PROJECTION_DENIED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(projectionResultReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(projectionResultReceiver, filter)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // On Android 10+ (Q) a foreground service type can be declared explicitly;
        // Android 14 (U) requires it for the mediaProjection type specifically.
        // The manifest also declares foregroundServiceType="mediaProjection" as
        // the default, but we pass it explicitly here for clarity and forward
        // compatibility.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                buildNotification("Monitoring active"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, buildNotification("Monitoring active"))
        }

        // Re-sync any managed (MDM) configuration each time the service starts.
        Config.refreshFromManagedConfig(applicationContext)

        startAppUsageLoop()
        requestOrResumeScreenshotPipeline()

        // START_STICKY: if the system kills this service to reclaim memory,
        // it will be recreated (with a null Intent) as soon as resources
        // allow, so monitoring resumes automatically.
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startAppUsageLoop() {
        if (appUsageLoopJob?.isActive == true) return
        appUsageLoopJob = serviceScope.launch {
            appUsageTracker.runLoop()
        }
    }

    /**
     * Attempts to resume screenshot capture using a previously granted
     * MediaProjection token. If none is cached in this process (e.g. after
     * a restart), prompts the user via a notification to re-grant it by
     * launching MediaProjectionRequestActivity.
     */
    private fun requestOrResumeScreenshotPipeline() {
        val resultCode = pendingProjectionResultCode
        val resultData = pendingProjectionResultData
        if (resultCode != null && resultData != null) {
            startScreenshotPipeline(resultCode, resultData)
        } else {
            Utils.logw("No cached MediaProjection token; requesting user to (re-)grant screen capture permission")
            notifyPermissionNeeded(
                "Tap to enable screenshots",
                "Bheka needs one-time screen capture permission after each restart."
            )
            launchProjectionRequest()
        }
    }

    private fun launchProjectionRequest() {
        val intent = Intent(this, MediaProjectionRequestActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(intent)
        } catch (e: Exception) {
            Utils.loge("Failed to launch MediaProjectionRequestActivity", e)
        }
    }

    private fun startScreenshotPipeline(resultCode: Int, resultData: Intent) {
        pendingProjectionResultCode = resultCode
        pendingProjectionResultData = resultData

        val projectionManager =
            getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        screenshotManager.start(projectionManager, resultCode, resultData)

        screenshotLoopJob?.cancel()
        screenshotLoopJob = serviceScope.launch {
            while (true) {
                delay(60_000L) // capture every 60 seconds
                try {
                    if (!screenshotManager.isActive()) {
                        Utils.logw("Screenshot session inactive; requesting re-grant")
                        requestOrResumeScreenshotPipeline()
                        break
                    }
                    val windowTitle = "unknown" // best-effort; accessibility service tracks precise focus separately
                    val metadata = screenshotManager.captureAndBuildMetadata(windowTitle)
                    if (metadata != null) {
                        val result = apiClient.postEvent(
                            eventType = "screenshot_capture",
                            occurredAt = Utils.isoNow(),
                            metadata = metadata
                        )
                        if (result is ApiClient.Result.Failure) {
                            Utils.logw("screenshot_capture post failed: ${result.message}")
                        }
                    }
                } catch (e: Exception) {
                    Utils.loge("Screenshot loop iteration failed", e)
                }
            }
        }
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Bheka Monitoring",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Persistent notification indicating the Bheka monitoring agent is active."
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(statusText: String): Notification {
        val launchIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Bheka is active")
            .setContentText(statusText)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun notifyPermissionNeeded(title: String, text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        val launchIntent = Intent(this, MediaProjectionRequestActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 1, launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()
        manager.notify(PERMISSION_NOTIFICATION_ID, notification)
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            unregisterReceiver(projectionResultReceiver)
        } catch (e: Exception) {
            // Receiver may already be unregistered; ignore.
        }
        screenshotLoopJob?.cancel()
        appUsageLoopJob?.cancel()
        screenshotManager.stop()
        serviceJob.cancel()
    }

    companion object {
        const val CHANNEL_ID = "bheka_monitoring_channel"
        const val NOTIFICATION_ID = 1001
        const val PERMISSION_NOTIFICATION_ID = 1002

        fun start(context: Context) {
            val intent = Intent(context, BhekaMonitoringService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
