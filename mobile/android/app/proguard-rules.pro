# Add project specific ProGuard rules here.
# Minification is disabled by default (isMinifyEnabled = false) for this
# monitoring agent to simplify debugging on enrolled devices. If you enable
# minification later, keep the rules below.

-keep class io.bheka.agent.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class com.google.mlkit.** { *; }
-keep class com.google.zxing.** { *; }
