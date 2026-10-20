# Sailun PCR 移动触摸屏（1P / 3P）

这是供 1280×800 横屏 Android 平板使用的原生 Android 外壳与本地 WebView 界面。页面坐标保持 1280×800，并按设备可视区域等比缩放。当前测试版 1.1.0-test 包含入库 1P / 3P 两组通道、六张布局；出库 PLC 保留后续入口。

## 一键构建

双击本目录的 `build-debug-apk.bat`。脚本使用上级 `.android-tools` 内的 JDK 17、Gradle 8.9 和 Android SDK，不依赖预先配置的系统环境变量。为兼容 Windows 原生工具和中文项目路径，SDK 会自动缓存到当前用户的 `%LOCALAPPDATA%\PCRMobileBuild\sdk`，并自动写入 `local.properties`。

APK 输出为 `app/build/outputs/apk/debug/app-debug.apk`，构建日志为 `build-debug-apk.log`。分发源码构建环境时须保留上级 `.android-tools` 目录；安装 APK 到平板无需这些构建工具。

首次补齐依赖后，可在本目录运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\build-apk.ps1 -Offline` 离线增量构建。`build-debug-apk.bat --check` 只验证构建工具并准备 SDK 配置。

## Android Studio 构建

用 Android Studio 打开本目录，安装 JDK 17 和 Android SDK Platform 35，等待 Gradle 同步后使用 **Build > Build APK(s)**。调试 APK 会输出到 `app/build/outputs/apk/debug/`。

## 现场连接

平板接入与入库 PLC 同网段的现场 Wi-Fi，在左上角 PLC 选择中选择“入库 PLC”。默认处理器地址为 `192.168.41.129`，EtherNet/IP 显式消息使用 TCP 44818。

PLC 标签必须开放所需的 External Access。本轮 Echo 联调已验证两通道各 65 项页面绑定可读取、主查询输入联动正常。应用通过当前通道的 HMI 请求标签写入，设备状态及托盘字段来自 PLC 回读。

P3248～P3251 属于出库 PLC，应读取出库 PLC 的 `SCADA_P[3,248]`～`SCADA_P[3,251].DeviceStatus`；本版显示待接入并跳过这些读取，不将它们映射到入库 PLC。

## 操作约束

- 点动按钮按下写 1，松开、触摸取消、切页或应用失焦时写 0。
- 托盘字段编辑先停止 PLC 刷新。写入/清除按钮直接按下写 1、松开写 0，APP 不做长按计时、延时提交或目标地址/盘号/重量提交校验，处理条件和计时交给 PLC。触摸取消、切页或应用失焦时释放请求。
- 设备布局颜色按 `DeviceStatus` bit 9 故障、bit 8 自动、bit 10 有盘解析；状态字索引取设备号末三位，如 P1025→`SCADA_P[1,25]`、P1103→`SCADA_P[1,103]`、Z5003→`SCADA_Z5[3]`。
- 区域停止为普通 PLC 停止请求，不能替代现场急停及安全回路。

## 现场联调前提

本工作区已配置构建工具并生成调试 APK，支持 Android 8.0 及以上版本。2026-10-19 已在 emulator-5554（1280×800）安装运行并连接 Echo。构建时调用 `build-live-assets.cjs`，使用已批准的布局、悬浮键盘和 `live-runtime.js` 生成真实通信页面；需要现有 Node.js。界面预览仍保留独立模拟数据，不随 APK 联机。

全流程测试顺序：确认左上角 PLC 在线 → 选择 1P 或 3P → 布局选择设备并核对 PLC 实际选择号 → 设备状态 → 托盘数据 → 启停控制与手动点动。升降机及拆盘机仍仅查看状态。点动、启停、复位及托盘修改的实际 PLC 执行结果由本轮人工联调验证；UI 模拟桥测试不代表设备动作已验证。
