$ErrorActionPreference = "Stop"
$env:NODE_OPTIONS = "--max-old-space-size=4096"

# Detect Java Home
if (Test-Path "C:\Program Files\Android\Android Studio\jbr") {
    $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
} elseif (Test-Path "c:\Dev\Fleet360\jdk-21.0.12+8") {
    $env:JAVA_HOME = "c:\Dev\Fleet360\jdk-21.0.12+8"
}
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

Write-Host "=== 1. Building Next.js Static Export for Mobile App ===" -ForegroundColor Cyan
Set-Location "c:\Dev\Fleet360\mobile-app"
npx next build
Set-Location "c:\Dev\Fleet360"

Write-Host "=== 2. Configuring Android Assets for Fleet360 Booking App ===" -ForegroundColor Green
$stringsBooking = '<?xml version="1.0" encoding="utf-8"?>' + "`n" + '<resources>' + "`n" + '    <string name="app_name">Fleet360 Booking App</string>' + "`n" + '    <string name="title_activity_main">Fleet360 Booking App</string>' + "`n" + '    <string name="package_name">com.fleet360.booking</string>' + "`n" + '    <string name="custom_url_scheme">com.fleet360.booking</string>' + "`n" + '</resources>'
Set-Content -Path "c:\Dev\Fleet360\android\app\src\main\res\values\strings.xml" -Value $stringsBooking

# Update build.gradle for booking app
$gradleContent = Get-Content "c:\Dev\Fleet360\android\app\build.gradle" -Raw
$gradleBooking = $gradleContent -replace 'applicationId "com.fleet360.[a-zA-Z0-9_]+"', 'applicationId "com.fleet360.booking"'
Set-Content -Path "c:\Dev\Fleet360\android\app\build.gradle" -Value $gradleBooking

# Copy web assets into android
npx cap copy android

# Replace default index.html with booking-app html
if (Test-Path "c:\Dev\Fleet360\out\driver\booking-app.html") {
    Copy-Item "c:\Dev\Fleet360\out\driver\booking-app.html" "c:\Dev\Fleet360\android\app\src\main\assets\public\index.html" -Force
} elseif (Test-Path "c:\Dev\Fleet360\out\driver\booking-app\index.html") {
    Copy-Item "c:\Dev\Fleet360\out\driver\booking-app\index.html" "c:\Dev\Fleet360\android\app\src\main\assets\public\index.html" -Force
}

Write-Host "=== 3. Compiling Android APK with Gradle ===" -ForegroundColor Cyan
Set-Location "c:\Dev\Fleet360\android"
.\gradlew.bat :app:assembleDebug --no-daemon

Copy-Item "app\build\outputs\apk\debug\app-debug.apk" "..\Fleet360-Booking.apk" -Force
Copy-Item "app\build\outputs\apk\debug\app-debug.apk" "..\Fleet360 Booking App.apk" -Force
Set-Location "c:\Dev\Fleet360"

Write-Host "`n=== FLEET360 BOOKING APP APK BUILD COMPLETE ===" -ForegroundColor Green
Get-Item "c:\Dev\Fleet360\Fleet360 Booking App.apk" | Select-Object Name, Length, LastWriteTime
