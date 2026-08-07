package io.bheka.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restarts the Bheka monitoring foreground service after the device
 * reboots, so monitoring resumes without any user action. This is what
 * makes the agent durable on company-owned MDM-enrolled devices: even a
 * full reboot doesn't require re-launching the app manually.
 *
 * Note: the MediaProjection (screenshot) permission grant does not survive
 * a reboot either (it's an OS-level, per-boot-session token), so the
 * service will detect the missing token on restart and prompt the user /
 * MDM to re-grant it (see BhekaMonitoringService.requestOrResumeScreenshotPipeline).
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action
        if (action == Intent.ACTION_BOOT_COMPLETED || action == "android.intent.action.QUICKBOOT_POWERON") {
            Utils.logd("Device boot detected; restarting Bheka monitoring service")
            if (Config.isEnrolled(context) && Config.hasMinimumConfig(context)) {
                BhekaMonitoringService.start(context)
            } else {
                Utils.logw("Skipping auto-start after boot: agent not yet enrolled/configured")
            }
        }
    }
}
