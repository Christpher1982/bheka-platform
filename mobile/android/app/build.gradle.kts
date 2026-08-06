// Module build file for the Bheka monitoring agent app.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.bheka.agent"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.bheka.agent"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        // CI (build-android.yml) passes -PversionNameSuffix="-<git-sha>" so any
        // screenshot of the app's status screen unambiguously proves which
        // build/commit is actually installed on a device.
        versionName = "1.0.0" + (project.findProperty("versionNameSuffix") as String? ?: "")

        // Compile-time defaults for enrollment fields. These are only used
        // to pre-fill the enrollment UI; the values actually used at runtime
        // are read from SharedPreferences (see Config.kt) and can be
        // overridden via MDM AppConfig or QR-code enrollment.
        buildConfigField("String", "DEFAULT_API_URL", "\"http://100.87.148.94:8081\"")
        buildConfigField("String", "DEFAULT_AGENT_TOKEN", "\"4a57a3cdf82af186fe0d8ce7d7235ff77008b1bf16edebac\"")
        buildConfigField("String", "DEFAULT_TENANT_SLUG", "\"eride-technologies\"")
        buildConfigField("String", "DEFAULT_SITE_ID", "\"\"")
        buildConfigField("String", "DEFAULT_SUBJECT_USER_ID", "\"\"")
        buildConfigField("String", "DEFAULT_SOURCE_AGENT_ID", "\"\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // Core AndroidX
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.activity:activity-ktx:1.9.1")

    // Coroutines for all async work
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // OkHttp for direct HTTP calls to the Bheka API
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // ML Kit on-device text recognition for screenshot OCR
    implementation("com.google.mlkit:text-recognition:16.0.1")

    // ZXing for QR code enrollment scanning
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("com.google.zxing:core:3.5.3")

    // Lifecycle helpers for service-friendly coroutine scopes
    implementation("androidx.lifecycle:lifecycle-service:2.8.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
