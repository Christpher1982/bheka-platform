package io.bheka.agent

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter

/**
 * Application entry point. Refreshes MDM-managed configuration on process
 * start and listens for ACTION_APPLICATION_RESTRICTIONS_CHANGED, which the
 * system broadcasts whenever the EMM/MDM console pushes updated
 * "Managed App Configuration" values (see Config.refreshFromManagedConfig).
 */
class BhekaApplication : Application() {

    private val restrictionsReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            Utils.logd("Managed app restrictions changed; refreshing config")
            val changed = Config.refreshFromManagedConfig(context)
            if (changed && Config.hasMinimumConfig(context)) {
                // Restart the service so the new config takes effect immediately.
                BhekaMonitoringService.start(context)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()

        Config.refreshFromManagedConfig(this)

        registerReceiver(
            restrictionsReceiver,
            IntentFilter(Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED)
        )

        // If the device was already enrolled and configured (e.g. process
        // was restarted by the system, not a full reboot), make sure the
        // monitoring service is running.
        if (Config.isEnrolled(this) && Config.hasMinimumConfig(this)) {
            BhekaMonitoringService.start(this)
        }
    }
}
