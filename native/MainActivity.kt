package local.chinaslop.tracker

import android.app.AlertDialog
import android.webkit.CookieManager
import android.webkit.WebView
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : TauriActivity() {
    override val handleBackNavigation: Boolean = true
    companion object {
        init { System.loadLibrary("node"); System.loadLibrary("tracker") }
        private val started = AtomicBoolean(false)
        private val accessKey = UUID.randomUUID().toString() + UUID.randomUUID().toString()
        private const val origin = "http://127.0.0.1:4319"
        @JvmStatic private external fun startNode(root: String, data: String, port: Int, key: String): Int
    }

    private fun copyAssets(source: String, target: File) {
        val children = assets.list(source) ?: emptyArray()
        if (children.isNotEmpty()) {
            target.mkdirs()
            children.forEach { copyAssets("$source/$it", File(target, it)) }
        } else {
            target.parentFile?.mkdirs()
            assets.open(source).use { input -> target.outputStream().use { input.copyTo(it) } }
        }
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.setOnApplyWindowInsetsListener { view, insets ->
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        Thread({
            try {
                if (started.compareAndSet(false, true)) {
                    val root = File(filesDir, "app-v1")
                    copyAssets("tracker", root)
                    val data = File(filesDir, "tracker-data").also { it.mkdirs() }
                    Thread({
                        startNode(root.absolutePath, data.absolutePath, 4319, accessKey)
                        runOnUiThread { if (!isDestroyed) showFailure() }
                    }, "Tracker server").start()
                }
                var ready = false
                for (attempt in 0 until 150) {
                    if (isDestroyed) return@Thread
                    var connection: HttpURLConnection? = null
                    try {
                        connection = URL("$origin/api/health").openConnection() as HttpURLConnection
                        connection.setRequestProperty("X-Tracker-Key", accessKey)
                        connection.connectTimeout = 400
                        connection.readTimeout = 400
                        if (connection.responseCode == 200) { ready = true; break }
                    } catch (_: Exception) { } finally { connection?.disconnect() }
                    Thread.sleep(200)
                }
                check(ready) { "Local server did not start" }
                runOnUiThread {
                    if (!isDestroyed) {
                        CookieManager.getInstance().setAcceptCookie(true)
                        CookieManager.getInstance().setCookie(origin, "tracker_session=$accessKey; HttpOnly; SameSite=Strict; Path=/") {
                            if (!isDestroyed) webView.loadUrl(origin)
                        }
                    }
                }
            } catch (_: Exception) { runOnUiThread { if (!isDestroyed) showFailure() } }
        }, "Tracker startup").start()
    }

    private fun showFailure() {
        AlertDialog.Builder(this).setTitle("Could not start tracker")
            .setMessage("Close and reopen the app. Your encrypted account data remains in app storage.")
            .setPositiveButton("Close") { _, _ -> finish() }.show()
    }
}
