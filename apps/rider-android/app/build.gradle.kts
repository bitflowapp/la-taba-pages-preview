plugins { id("com.android.application"); kotlin("android"); id("org.jetbrains.kotlin.plugin.compose") }

val publicKey = providers.environmentVariable("RIDER_STAGING_PUBLIC_KEY").orElse("").get()
require(publicKey.isEmpty() || publicKey.startsWith("sb_publishable_")) { "Only a staging publishable key is accepted" }
val pilotStore = providers.environmentVariable("RIDER_PILOT_KEYSTORE_PATH").orNull
val pilotPassword = providers.environmentVariable("RIDER_PILOT_SIGNING_PASS").orNull
require((pilotStore == null) == (pilotPassword == null)) { "Pilot signer needs both path and password" }
val versionCodeOverride = providers.gradleProperty("riderPilotVersionCode").orNull
val pilotVersionCode = versionCodeOverride?.toIntOrNull() ?: 1
require(versionCodeOverride == null || (versionCodeOverride.toIntOrNull() != null && pilotVersionCode in 1..99999)) {
    "riderPilotVersionCode must be an integer between 1 and 99999"
}
val pilotVersionName = providers.gradleProperty("riderPilotVersionName").orNull ?: "0.1.0-canonical"
require(pilotVersionName.matches(Regex("[0-9]+\\.[0-9]+\\.[0-9]+-canonical"))) {
    "riderPilotVersionName must be a numeric canonical version"
}
val pilotInstrumentation = providers.gradleProperty("riderPilotInstrumentation").orNull == "true"
require(!pilotInstrumentation || (pilotStore != null && pilotPassword != null)) {
    "Instrumenting the signed pilot requires the pilot signer"
}
android {
    namespace = "com.lataba.rider"
    compileSdk = 35
    testBuildType = if (pilotInstrumentation) "release" else "debug"
    defaultConfig {
        applicationId = "com.lataba.rider"
        minSdk = 26
        targetSdk = 35
        versionCode = pilotVersionCode
        versionName = pilotVersionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "SUPABASE_URL", "\"https://ucbtjcurawxjwjdvvcvj.supabase.co\"")
        buildConfigField("String", "PUBLIC_KEY", "\"$publicKey\"")
    }
    if (pilotStore != null && pilotPassword != null) signingConfigs {
        create("pilot") {
            storeFile = file(pilotStore)
            storePassword = pilotPassword
            keyAlias = "lataba-pilot-v1"
            keyPassword = pilotPassword
            storeType = "pkcs12"
        }
    }
    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".qa"
            versionNameSuffix = "-qa"
            manifestPlaceholders["appLabel"] = "La Taba Rider QA"
        }
        getByName("release") {
            applicationIdSuffix = ".pilot"
            versionNameSuffix = "-pilot"
            manifestPlaceholders["appLabel"] = "La Taba Rider Piloto"
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("pilot")
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
}
dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation(platform("androidx.compose:compose-bom:2024.11.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.11.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
