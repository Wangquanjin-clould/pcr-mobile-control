param([string]$PlcHost='')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$javaRoot=[IO.Path]::GetFullPath((Join-Path $appRoot '..\.android-tools\jdk-17'))
$cache=Join-Path $env:USERPROFILE '.gradle\caches\modules-2\files-2.1'
function Jar([string]$module,[string]$version) {
    $file=Get-ChildItem -LiteralPath (Join-Path $cache "$module\$version") -Filter '*.jar' -Recurse | Select-Object -First 1
    if(-not $file){throw "Missing cached Kotlin dependency: $module $version"}
    return $file.FullName
}
$stdlib=Jar 'org.jetbrains.kotlin\kotlin-stdlib' '2.0.21'
$annotations=Jar 'org.jetbrains\annotations' '13.0'
$compiler=@(
    (Jar 'org.jetbrains.kotlin\kotlin-compiler-embeddable' '2.0.21'),$stdlib,$annotations,
    (Jar 'org.jetbrains.kotlin\kotlin-script-runtime' '2.0.21'),
    (Jar 'org.jetbrains.kotlin\kotlin-reflect' '1.6.10'),
    (Jar 'org.jetbrains.kotlin\kotlin-daemon-embeddable' '2.0.21'),
    (Jar 'org.jetbrains.intellij.deps\trove4j' '1.0.20200330'),
    (Jar 'org.jetbrains.kotlinx\kotlinx-coroutines-core-jvm' '1.6.4')
) -join ';'
$out=Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Path $out -Force | Out-Null
$source=Join-Path $appRoot 'app\src\main\java\com\sailun\pcrmobile\LogixClient.kt'
& "$javaRoot\bin\java.exe" -cp $compiler org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath "$stdlib;$annotations" -jvm-target 17 -d $out $source
if($LASTEXITCODE -ne 0){throw 'Kotlin client compilation failed'}
& "$javaRoot\bin\javac.exe" -encoding UTF-8 -cp "$out;$stdlib" -d $out (Join-Path $PSScriptRoot 'LogixCommunicationTest.java')
if($LASTEXITCODE -ne 0){throw 'Test harness compilation failed'}
if($PlcHost){& "$javaRoot\bin\java.exe" '-Dfile.encoding=UTF-8' -cp "$out;$stdlib" LogixCommunicationTest $PlcHost}
else {& "$javaRoot\bin\java.exe" '-Dfile.encoding=UTF-8' -cp "$out;$stdlib" LogixCommunicationTest}
exit $LASTEXITCODE
