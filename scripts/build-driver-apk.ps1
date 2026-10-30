$ErrorActionPreference = "Stop"
$env:NODE_OPTIONS = "--max-old-space-size=4096"

# Detect Java Home
if (Test-Path "C:\Program Files\Android\Android Studio\jbr") {
    $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
} elseif (Test-Path "c:\Dev\Fleet360\jdk-21.0.12+8") {
    $env:JAVA_HOME = "c:\Dev\Fleet360\jdk-21.0.12+8"
}
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

Write-Host "=== 1. Building Next.js Static Export for Driver Mobile App ===" -ForegroundColor Cyan
Set-Location "c:\Dev\Fleet360\mobile-app"
npx next build
Set-Location "c:\Dev\Fleet360"

Write-Host "=== 2. Configuring Android Assets for Fleet360 Driver App ===" -ForegroundColor Green
$stringsDriver = '<?xml version="1.0" encoding="utf-8"?>' + "`n" + '<resources>' + "`n" + '    <string name="app_name">Fleet360 Driver</string>' + "`n" + '    <string name="title_activity_main">Fleet360 Driver</string>' + "`n" + '    <string name="package_name">com.fleet360.driver</string>' + "`n" + '    <string name="custom_url_scheme">com.fleet360.driver</string>' + "`n" + '</resources>'
Set-Content -Path "c:\Dev\Fleet360\android\app\src\main\res\values\strings.xml" -Value $stringsDriver

# Update build.gradle for driver app
$gradleContent = Get-Content "c:\Dev\Fleet360\android\app\build.gradle" -Raw
$gradleDriver = $gradleContent -replace 'applicationId "com.fleet360.[a-zA-Z0-9_]+"', 'applicationId "com.fleet360.driver"'
Set-Content -Path "c:\Dev\Fleet360\android\app\build.gradle" -Value $gradleDriver

# Copy web assets into android
npx cap copy android

# Ensure public/index.html is the updated driver app
if (Test-Path "c:\Dev\Fleet360\out\driver\driver-app.html") {
    Copy-Item "c:\Dev\Fleet360\out\driver\driver-app.html" "c:\Dev\Fleet360\android\app\src\main\assets\public\index.html" -Force
} elseif (Test-Path "c:\Dev\Fleet360\out\driver\driver-app\index.html") {
    Copy-Item "c:\Dev\Fleet360\out\driver\driver-app\index.html" "c:\Dev\Fleet360\android\app\src\main\assets\public\index.html" -Force
}

Write-Host "=== 3. Compiling Android APK with Gradle ===" -ForegroundColor Cyan
Set-Location "c:\Dev\Fleet360\android"
.\gradlew.bat :app:assembleDebug --no-daemon

Copy-Item "app\build\outputs\apk\debug\app-debug.apk" "..\Fleet360-Driver.apk" -Force
Copy-Item "app\build\outputs\apk\debug\app-debug.apk" "..\public\Fleet360-Driver.apk" -Force
Set-Location "c:\Dev\Fleet360"

Write-Host "`n=== FLEET360 DRIVER APP APK BUILD COMPLETE ===" -ForegroundColor Green
Get-Item "c:\Dev\Fleet360\Fleet360-Driver.apk" | Select-Object Name, Length, LastWriteTime
