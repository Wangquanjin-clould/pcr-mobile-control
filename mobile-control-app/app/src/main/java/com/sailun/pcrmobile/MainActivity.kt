package com.sailun.pcrmobile

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var web: WebView
    private val worker = Executors.newSingleThreadExecutor()
    private val plc = LogixClient()
    private val activeJogs = mutableSetOf<String>() // Accessed only on the PLC worker.

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
        web = WebView(this)
        if ((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        // The page is packaged in android_asset; no network URL is loaded in the WebView.
        web.settings.allowFileAccess = true
        web.settings.allowContentAccess = false
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                !url.startsWith("file:///android_asset/")
        }
        web.addJavascriptInterface(PlcBridge(), "AndroidPlc")
        setContentView(web)
        web.loadUrl("file:///android_asset/index.html")
    }

    private fun js(name: String, data: JSONObject) {
        runOnUiThread { if (::web.isInitialized) web.evaluateJavascript("window.$name(${JSONObject.quote(data.toString())})", null) }
    }

    inner class PlcBridge {
        @JavascriptInterface fun connect(host: String) {
            worker.execute {
                val result = JSONObject()
                try { result.put("ok", true); result.put("message", plc.connect(host)) }
                catch (e: Exception) { plc.disconnect(); result.put("ok", false); result.put("message", e.message ?: "连接失败") }
                js("onNativeConnected", result)
            }
        }

        @JavascriptInterface fun disconnect() {
            worker.execute { plc.disconnect(); js("onNativeDisconnected", JSONObject().put("ok", true)) }
        }

        @JavascriptInterface fun readTags(requestId: String, json: String) {
            worker.execute {
                val result = JSONObject(); val values = JSONObject(); val errors = JSONObject()
                try {
                    val tags = JSONArray(json)
                    for (i in 0 until tags.length()) {
                        val item = tags.getJSONObject(i); val tag = item.getString("tag"); val type = item.getString("type")
                        try { values.put(tag, plc.read(tag, type)) }
                        catch (e: Exception) { errors.put(tag, e.message ?: "读取失败") }
                    }
                    result.put("ok", errors.length() == 0); result.put("values", values); result.put("errors", errors)
                } catch (e: Exception) { result.put("ok", false); result.put("message", e.message ?: "读取失败") }
                result.put("requestId", requestId); js("onNativeRead", result)
            }
        }

        @JavascriptInterface fun writeTag(requestId: String, tag: String, type: String, value: String) {
            worker.execute {
                val r = JSONObject().put("requestId", requestId).put("tag", tag)
                try {
                    plc.write(tag, type, value)
                    if (tag.matches(Regex("(HMI_Manaul_(AC_Fwd|AC_Rev|BD_Fwd|BD_Rev|Up|Dn)|HMI_PalletData_(Chg|Clr))_(1P|3P)"))) {
                        if (value == "1" || value == "true") activeJogs.add(tag) else activeJogs.remove(tag)
                    }
                    r.put("ok", true); r.put("message", "写入请求已发送")
                }
                catch (e: Exception) { r.put("ok", false); r.put("message", e.message ?: "写入失败") }
                js("onNativeWrite", r)
            }
        }

        @JavascriptInterface fun writeString(requestId: String, tag: String, value: String) {
            worker.execute {
                val r = JSONObject().put("requestId", requestId).put("tag", tag)
                try { plc.writeString(tag, value); r.put("ok", true); r.put("message", "字符串已写入") }
                catch (e: Exception) { r.put("ok", false); r.put("message", e.message ?: "写入失败") }
                js("onNativeWrite", r)
            }
        }
    }

    override fun onDestroy() {
        worker.execute { plc.disconnect() }
        worker.shutdown()
        web.removeJavascriptInterface("AndroidPlc")
        web.destroy()
        super.onDestroy()
    }

    override fun onPause() {
        if (::web.isInitialized) web.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null)
        worker.execute {
            for (tag in activeJogs.toList()) {
                try { plc.write(tag, "BOOL", "0"); activeJogs.remove(tag) } catch (_: Exception) { }
            }
        }
        super.onPause()
    }
}
