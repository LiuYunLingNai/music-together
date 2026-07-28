import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}

android {
    namespace = "io.github.yueby.musictogether"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.yueby.musictogether"
        minSdk = 26
        targetSdk = 36
        versionCode = 15
        versionName = "2.2.0"
    }

    flavorDimensions += "distribution"

    productFlavors {
        create("standard") {
            dimension = "distribution"
        }
        create("vivo") {
            dimension = "distribution"
            applicationId = "cmccwm.mobilemusic"
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.findByName("release")
            isDebuggable = false
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// Gradle's Windows test worker can fail to load class directories when the checkout
// path contains non-ASCII characters. Putting the compiled classes in a jar gives
// the worker a Unicode-safe classpath while keeping normal test discovery intact.
val unicodeSafeUnitTestClasses by tasks.registering(Jar::class) {
    archiveClassifier.set("unit-test-classes")
    destinationDirectory.set(gradle.gradleUserHomeDir.resolve("caches/music-together-test-classes/${rootProject.name}"))
    from(layout.buildDirectory.dir("tmp/kotlin-classes/standardDebug"))
    from(layout.buildDirectory.dir("tmp/kotlin-classes/standardDebugUnitTest"))
    dependsOn("compileStandardDebugKotlin", "compileStandardDebugUnitTestKotlin")
}

tasks.withType<Test>().matching { it.name.contains("StandardDebug") }.configureEach {
    dependsOn(unicodeSafeUnitTestClasses)
    doFirst {
        classpath = files(unicodeSafeUnitTestClasses.get().archiveFile.get().asFile) + classpath
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.06.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.media3:media3-exoplayer:1.7.1")
    implementation("androidx.media3:media3-session:1.7.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("io.coil-kt.coil3:coil-compose:3.2.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.2.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
