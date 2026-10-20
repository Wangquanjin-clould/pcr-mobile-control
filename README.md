# PCR 移动触摸屏

埃及赛轮半钢成品库输送线安卓平板触摸屏，1280×800 横屏，入库 PLC 下包含 1P / 3P 两套操作通道。

本仓库保存已在安卓模拟器运行的 **1.1.1-test（versionCode 3）** 源码和 APK。包含 P1040 / P1050 编号修正、升降到位指示、设备布局状态、托盘数据、点动操作及输入框附近的悬浮键盘。此仓库为安卓版本；FactoryTalk Optix 测试工程另行维护。

## 安装

下载 [PCR-Mobile-1.1.1-test.apk](releases/PCR-Mobile-1.1.1-test.apk)，安装到 Android 8.0 及以上平板或模拟器。APK 是调试签名测试版。

SHA-256 校验值见 [SHA256SUMS.txt](releases/SHA256SUMS.txt)。上传时已核对 APK 内 `assets/index.html` 与仓库源码的同名文件 SHA-256 一致。

## 目录

- `mobile-control-app/`：Kotlin Android 工程、Logix 通信代码、实时界面生成器和通信测试源码。
- `移动触摸屏设计/模拟预览/`：生成 APK 界面所需的 HTML、CSS、JS 和 1P / 3P 布局数据。
- `移动触摸屏设计/*画面标签绑定.json`：两套操作通道的 PLC 标签说明。
- `releases/`：本次归档 APK 和校验值。

## 从源码构建

需要 JDK 17、Node.js、Android SDK Platform 35、Build Tools 35.0.0。标准构建使用 Gradle Wrapper 8.9；首次运行需要联网下载 Gradle 和依赖。

1. 克隆完整仓库，保持两个源码目录的相对位置。
2. 在 Android Studio 中打开 `mobile-control-app`，通过 SDK Manager 安装上述 SDK，等待 Gradle 同步。
3. 每次修改界面模板后，在仓库根目录运行：

   ```powershell
   node .\mobile-control-app\build-live-assets.cjs
   ```

4. 在 `mobile-control-app` 目录运行：

   ```powershell
   .\gradlew.bat assembleDebug
   ```

APK 输出：`mobile-control-app/app/build/outputs/apk/debug/app-debug.apk`。也可使用 Android Studio 的 Build APK(s)。

命令行构建前需通过 Android Studio 生成本机 `local.properties`，或设置 `ANDROID_HOME` 指向实际 SDK 目录。`local.properties` 不提交到 Git。

原来的 `build-debug-apk.bat` / `build-apk.ps1` 为现场离线构建脚本，需要仓库外的 `.android-tools` 工具目录。该目录体积很大，未上传；从 GitHub 获取源码时优先使用上述 Gradle Wrapper 构建方式。

## 联调约定

- 当前入库 PLC / Echo 地址：`192.168.41.129`，EtherNet/IP TCP 44818。
- 主查询编号写入 `HMI_Input_DeviceNo_1P_1` 或 `HMI_Input_DeviceNo_3P_1`；由 PLC 判断并回读实际设备。
- 手动方向、上升、下降、托盘写入和清除均按下写 1、松开写 0；触摸取消、切页和应用失焦时释放请求。
- 设备底色使用状态字 bit 8 自动、bit 9 故障（优先）；绿点使用 bit 10 有托盘。
- P3248～P3251 属于出库 PLC，本版保留位置并跳过入库 PLC 读取。
- 升降机及拆盘机仅查看状态。APP 的停止为普通 PLC 请求，现场安全回路独立执行。

源码和 APK 上传日期：2026-10-20。保留 APK 原始文件名：`PCR移动触摸屏_1.1.1_P1040_P1050修正版.apk`。
