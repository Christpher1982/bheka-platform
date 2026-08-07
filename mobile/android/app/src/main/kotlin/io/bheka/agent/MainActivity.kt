package io.bheka.agent

import android.app.AppOpsManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import io.bheka.agent.databinding.ActivityMainBinding
import org.json.JSONObject

/**
 * Enrollment / configuration activity shown on first launch and whenever
 * the user re-opens the app afterward. Responsibilities:
 *   1. Show enrollment fields, pre-filled from saved config or BuildConfig defaults.
 *   2. Allow enrollment via QR code (zxing) as an alternative to manual entry.
 *   3. On "Start Monitoring": persist config, request Accessibility +
 *      Usage-Access + MediaProjection + Notification permissions (with clear
 *      explanations), then start the foreground service and finish/minimize.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val notificationPermissionLauncher =
        registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) {
                Toast.makeText(this, "Notifications are needed to show the persistent status bar", Toast.LENGTH_LONG).show()
            }
            proceedToAccessibilityStep()
        }

    private val cameraPermissionLauncher =
        registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                launchQrScanner()
            } else {
                Toast.makeText(this, "Camera permission is required to scan the enrollment QR code", Toast.LENGTH_LONG).show()
            }
        }

    // Modern ActivityResult API for QR scanning (zxing-android-embedded's
    // ScanContract), replacing the deprecated startActivityForResult path.
    private val qrScanLauncher = registerForActivityResult(ScanContract()) { result ->
        if (result.contents != null) {
            applyQrPayload(result.contents)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        Config.refreshFromManagedConfig(this)
        prefillFields()

        binding.buttonScanQr.setOnClickListener { requestCameraAndScan() }
        binding.buttonStartMonitoring.setOnClickListener { onStartMonitoringClicked() }
    }

    override fun onResume() {
        super.onResume()
        updatePermissionStatusText()
    }

    private fun prefillFields() {
        binding.editApiUrl.setText(Config.apiUrl(this))
        binding.editAgentToken.setText(Config.agentToken(this))
        binding.editTenantSlug.setText(Config.tenantSlug(this))
        binding.editSiteId.setText(Config.siteId(this))
        binding.editSubjectUserId.setText(Config.subjectUserId(this))
        binding.editSourceAgentId.setText(Config.sourceAgentId(this))
    }

    private fun updatePermissionStatusText() {
        val accessibilityOk = BhekaAccessibilityService.isEnabled(this)
        val usageOk = hasUsageAccessPermission()
        val projectionOk = Config.isMediaProjectionGranted(this)

        binding.textPermissionStatus.text = buildString {
            append("Accessibility: ${if (accessibilityOk) "granted" else "NOT granted"}\n")
            append("Usage access: ${if (usageOk) "granted" else "NOT granted"}\n")
            append("Screen capture: ${if (projectionOk) "previously granted" else "not yet granted"}")
        }
    }

    private fun hasUsageAccessPermission(): Boolean {
        val appOps = getSystemService(APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), packageName)
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    // ---- QR code enrollment -------------------------------------------------

    private fun requestCameraAndScan() {
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.CAMERA) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            launchQrScanner()
        } else {
            cameraPermissionLauncher.launch(android.Manifest.permission.CAMERA)
        }
    }

    private fun launchQrScanner() {
        val options = ScanOptions().apply {
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt("Scan the Bheka enrollment QR code")
            setBeepEnabled(false)
            setOrientationLocked(true)
        }
        qrScanLauncher.launch(options)
    }

    /**
     * Expected QR payload is a JSON object matching the enrollment fields, e.g.:
     * {
     *   "apiUrl": "http://100.87.148.94:8081",
     *   "agentToken": "4a57a3cdf82af186fe0d8ce7d7235ff77008b1bf16edebac",
     *   "tenantSlug": "eride-technologies",
     *   "siteId": "b6b6b6b6-....",
     *   "subjectUserId": "c7c7c7c7-....",
     *   "sourceAgentId": "d8d8d8d8-...."   // optional; generated if absent
     * }
     */
    private fun applyQrPayload(rawContents: String) {
        try {
            val json = JSONObject(rawContents)
            binding.editApiUrl.setText(json.optString("apiUrl", Config.apiUrl(this)))
            binding.editAgentToken.setText(json.optString("agentToken", Config.agentToken(this)))
            binding.editTenantSlug.setText(json.optString("tenantSlug", Config.tenantSlug(this)))
            binding.editSiteId.setText(json.optString("siteId", ""))
            binding.editSubjectUserId.setText(json.optString("subjectUserId", ""))
            val sourceAgentId = json.optString("sourceAgentId", "")
            binding.editSourceAgentId.setText(
                sourceAgentId.ifBlank { Config.sourceAgentId(this) }
            )
            Toast.makeText(this, "QR enrollment data loaded — review and tap Start Monitoring", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Utils.loge("Failed to parse QR enrollment payload", e)
            Toast.makeText(this, "Invalid QR code: not a valid Bheka enrollment payload", Toast.LENGTH_LONG).show()
        }
    }

    // ---- Start monitoring flow ----------------------------------------------

    private fun onStartMonitoringClicked() {
        val apiUrl = binding.editApiUrl.text.toString().trim()
        val agentToken = binding.editAgentToken.text.toString().trim()
        val tenantSlug = binding.editTenantSlug.text.toString().trim()
        val siteId = binding.editSiteId.text.toString().trim()
        val subjectUserId = binding.editSubjectUserId.text.toString().trim()
        val sourceAgentId = binding.editSourceAgentId.text.toString().trim().ifBlank {
            Config.sourceAgentId(this)
        }

        if (apiUrl.isBlank() || agentToken.isBlank() || tenantSlug.isBlank() ||
            siteId.isBlank() || subjectUserId.isBlank()
        ) {
            Toast.makeText(this, "Please fill in all fields before starting", Toast.LENGTH_LONG).show()
            return
        }

        Config.save(this, apiUrl, agentToken, tenantSlug, siteId, subjectUserId, sourceAgentId)
        Toast.makeText(this, "Configuration saved. Requesting permissions…", Toast.LENGTH_SHORT).show()

        requestNotificationPermissionIfNeeded()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) !=
                android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                return
            }
        }
        proceedToAccessibilityStep()
    }

    private fun proceedToAccessibilityStep() {
        if (!BhekaAccessibilityService.isEnabled(this)) {
            AlertDialog.Builder(this)
                .setTitle("Enable Accessibility Service")
                .setMessage(
                    "Bheka needs the Accessibility permission to capture keystroke activity. " +
                        "On the next screen, find \"Bheka Monitoring Agent\" and turn it on."
                )
                .setPositiveButton("Open Settings") { _, _ ->
                    startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                }
                .setNegativeButton("Skip for now") { _, _ -> proceedToUsageAccessStep() }
                .setCancelable(false)
                .show()
        } else {
            proceedToUsageAccessStep()
        }
    }

    private fun proceedToUsageAccessStep() {
        if (!hasUsageAccessPermission()) {
            AlertDialog.Builder(this)
                .setTitle("Enable Usage Access")
                .setMessage(
                    "Bheka needs Usage Access permission to detect which app is in the foreground. " +
                        "On the next screen, find \"Bheka Monitoring Agent\" and allow usage tracking."
                )
                .setPositiveButton("Open Settings") { _, _ ->
                    startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:$packageName")))
                }
                .setNegativeButton("Skip for now") { _, _ -> proceedToStartService() }
                .setCancelable(false)
                .show()
        } else {
            proceedToStartService()
        }
    }

    private fun proceedToStartService() {
        BhekaMonitoringService.start(this)

        AlertDialog.Builder(this)
            .setTitle("Monitoring started")
            .setMessage(
                "Bheka is now running in the background. It will request one-time screen capture " +
                    "permission shortly — please accept it to enable screenshot monitoring.\n\n" +
                    "You can close this screen; the service keeps running."
            )
            .setPositiveButton("Close") { _, _ -> moveTaskToBack(true) }
            .setCancelable(true)
            .show()
    }
}
