param([switch]$Check, [switch]$Offline)

$ErrorActionPreference = 'Stop'
try {
    Set-Location -LiteralPath $PSScriptRoot
    Write-Host 'PCR APK builder - project tools v5'
    $toolsRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.android-tools'))
    $env:JAVA_HOME = Join-Path $toolsRoot 'jdk-17'
    $env:ANDROID_HOME = Join-Path $toolsRoot 'sdk'
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    $gradleRoot = Join-Path $toolsRoot 'gradle-8.9'
    $javaExe = Join-Path $env:JAVA_HOME 'bin\java.exe'
    $gradleJar = Join-Path $gradleRoot 'lib\gradle-gradle-cli-main-8.9.jar'
    foreach ($required in @(
        $javaExe,
        $gradleJar,
        (Join-Path $env:ANDROID_HOME 'platforms\android-35\android.jar'),
        (Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\aapt2.exe')
    )) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Required build file is missing: $required"
        }
    }

    # aapt2 on Windows needs an ASCII SDK path. Keep the redistributable SDK
    # with the project and prepare a cache in the current Windows user profile.
    if ($env:ANDROID_HOME -match '[^\x00-\x7F]') {
        $sdkCache = Join-Path $env:LOCALAPPDATA 'PCRMobileBuild\sdk'
        if ($sdkCache -match '[^\x00-\x7F]') {
            throw "The SDK cache path must contain ASCII characters only: $sdkCache"
        }
        Write-Host "Preparing SDK cache: $sdkCache"
        & robocopy.exe $env:ANDROID_HOME $sdkCache /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
        if ($LASTEXITCODE -ge 8) { throw "SDK cache copy failed (exit $LASTEXITCODE)." }
        $env:ANDROID_HOME = $sdkCache
        $env:ANDROID_SDK_ROOT = $sdkCache
    }

    # Java .properties files require Unicode escapes for non-ASCII paths.
    $sdkPath = $env:ANDROID_HOME.Replace('\', '/')
    $escapedPath = -join ($sdkPath.ToCharArray() | ForEach-Object {
        if ([int]$_ -gt 127) { '\u{0:x4}' -f [int]$_ } else { [string]$_ }
    })
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'local.properties'),
        "sdk.dir=$escapedPath`r`n", [Text.Encoding]::ASCII)
    Write-Host "Project: $PSScriptRoot"
    Write-Host "SDK: $env:ANDROID_HOME"
    Write-Host "Java: $javaExe"
    if ($Check) { Write-Host 'Build tools check passed.'; exit 0 }

    & node (Join-Path $PSScriptRoot 'build-live-assets.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Live page generation failed.' }

    # Match Gradle's required JVM options so --no-daemon can use this process.
    $jvmArgs = @(
        '--add-opens=java.base/java.util=ALL-UNNAMED',
        '--add-opens=java.base/java.lang=ALL-UNNAMED',
        '--add-opens=java.base/java.lang.invoke=ALL-UNNAMED',
        '--add-opens=java.prefs/java.util.prefs=ALL-UNNAMED',
        '--add-exports=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED',
        '--add-exports=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED',
        '--add-opens=java.base/java.nio.charset=ALL-UNNAMED',
        '--add-opens=java.base/java.net=ALL-UNNAMED',
        '--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED',
        '-Xmx2g', '-Dfile.encoding=UTF-8', '-Duser.country=US',
        '-Duser.language=en', '-Duser.variant=',
        "-javaagent:$gradleRoot\lib\agents\gradle-instrumentation-agent-8.9.jar"
    )
    $buildArgs = @('--no-daemon', '--console=plain', '--build-cache', '--parallel',
        '-Dorg.gradle.internal.http.connectionTimeout=15000',
        '-Dorg.gradle.internal.http.socketTimeout=30000',
        '-Pkotlin.compiler.execution.strategy=in-process', 'assembleDebug')
    if ($Offline) { $buildArgs += '--offline' }
    $buildLog = Join-Path $PSScriptRoot 'build-debug-apk.log'
    $ErrorActionPreference = 'Continue'
    & $javaExe @jvmArgs -classpath $gradleJar org.gradle.launcher.GradleMain @buildArgs 2>&1 |
        ForEach-Object { "$_" } | Tee-Object -FilePath $buildLog
    $buildExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($buildExit -ne 0) { throw "Gradle failed (exit $buildExit). Log: $buildLog" }
    $apk = Join-Path $PSScriptRoot 'app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $apk)) { throw "APK was not generated: $apk" }
    Write-Host "APK created at: $apk"
    exit 0
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
