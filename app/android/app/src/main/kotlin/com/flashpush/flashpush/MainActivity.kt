package com.flashpush.flashpush

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileOutputStream
import kotlin.concurrent.thread

class MainActivity : FlutterActivity() {
    private lateinit var channel: MethodChannel
    private var initialShareConsumed = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "flashpush/native")
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "getInitialShare" -> {
                    if (initialShareConsumed) {
                        result.success(null)
                    } else {
                        initialShareConsumed = true
                        extractShare(intent) { result.success(it) }
                    }
                }
                "saveToDownloads" -> {
                    val path = call.argument<String>("path")
                    val name = call.argument<String>("name")
                    if (path == null || name == null) {
                        result.error("bad_args", "path and name are required", null)
                    } else {
                        thread {
                            try {
                                val saved = saveToDownloads(File(path), name)
                                runOnUiThread { result.success(saved) }
                            } catch (e: Exception) {
                                runOnUiThread { result.error("save_failed", e.message, null) }
                            }
                        }
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        extractShare(intent) { data -> if (data != null) channel.invokeMethod("onShare", data) }
    }

    /** Reads text/files out of an ACTION_SEND(_MULTIPLE) intent; files are copied into the cache so Dart can read them. */
    private fun extractShare(intent: Intent?, done: (Map<String, Any?>?) -> Unit) {
        if (intent == null || (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE)) {
            done(null)
            return
        }
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        val uris = ArrayList<Uri>()
        if (intent.action == Intent.ACTION_SEND) {
            getStreamExtra(intent)?.let { uris.add(it) }
        } else {
            getStreamListExtra(intent)?.let { uris.addAll(it) }
        }
        thread {
            val files = uris.mapNotNull { uri ->
                try {
                    copyToCache(uri)
                } catch (e: Exception) {
                    null
                }
            }
            runOnUiThread {
                if (text == null && files.isEmpty()) done(null)
                else done(mapOf("text" to text, "files" to files))
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun getStreamExtra(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_STREAM)

    @Suppress("DEPRECATION")
    private fun getStreamListExtra(intent: Intent): List<Uri>? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)

    private fun displayName(uri: Uri): String {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val name = c.getString(0)
                if (!name.isNullOrBlank()) return name
            }
        }
        return uri.lastPathSegment ?: "shared_file"
    }

    private fun copyToCache(uri: Uri): Map<String, String> {
        val dir = File(cacheDir, "shared").apply { mkdirs() }
        val name = displayName(uri).replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val target = File(dir, "${System.currentTimeMillis()}_$name")
        contentResolver.openInputStream(uri)!!.use { input ->
            FileOutputStream(target).use { output -> input.copyTo(output) }
        }
        return mapOf("path" to target.absolutePath, "name" to name)
    }

    /** Copies a downloaded file into the public Downloads/FlashPush folder. Returns a human-readable location. */
    private fun saveToDownloads(source: File, name: String): String {
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/FlashPush")
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Could not create file in Downloads")
            contentResolver.openOutputStream(uri)!!.use { out -> source.inputStream().use { it.copyTo(out) } }
            return "Downloads/FlashPush/$name"
        }
        // Older Android: use the app's own Downloads folder (no storage permission needed).
        val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir
        val target = File(dir, name)
        source.copyTo(target, overwrite = true)
        return target.absolutePath
    }
}
