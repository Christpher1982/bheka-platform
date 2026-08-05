// Root build file for the Bheka Android monitoring agent.
// Declares plugin versions once here; the app module applies them without
// re-specifying versions (Gradle "plugins" block with apply false pattern).
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}

tasks.register("clean", Delete::class) {
    delete(rootProject.layout.buildDirectory)
}
