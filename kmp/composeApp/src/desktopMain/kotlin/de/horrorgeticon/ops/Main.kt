package de.horrorgeticon.ops

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import dev.datlag.kcef.KCEF
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.awt.Desktop
import java.io.File
import java.net.URI
import java.util.prefs.Preferences

/**
 * Windows-/macOS-/Linux-Leitstand (Compose Desktop).
 * Der Webview läuft über KCEF (Chromium). Beim allerersten Start lädt KCEF
 * das Chromium-Bundle (~100 MB) in den Ordner „kcef-bundle“ — danach offline.
 * Schlägt das fehl (kein Netz beim Erststart), bietet die App an, den
 * Leitstand im System-Browser zu öffnen — gleiche Oberfläche, volle Funktion.
 */
fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "Horrorgeticon Ops — Leitstand",
        state = rememberWindowState(width = 1366.dp, height = 850.dp),
    ) {
        var kcefReady by remember { mutableStateOf(false) }
        var kcefError by remember { mutableStateOf<String?>(null) }
        var downloadPct by remember { mutableStateOf(0) }

        LaunchedEffect(Unit) {
            withContext(Dispatchers.IO) {
                try {
                    KCEF.init(builder = {
                        installDir(File("kcef-bundle"))
                        progress {
                            onDownloading { downloadPct = it.toInt().coerceAtLeast(0) }
                            onInitialized { kcefReady = true }
                        }
                        settings { cachePath = File("kcef-cache").absolutePath }
                    }, onError = { kcefError = it?.message ?: "KCEF-Initialisierung fehlgeschlagen" })
                } catch (e: Throwable) {
                    kcefError = e.message ?: "KCEF nicht verfügbar"
                }
            }
        }

        when {
            kcefReady -> App()
            kcefError != null -> BrowserFallback(kcefError!!)
            else -> androidx.compose.foundation.layout.Box(
                Modifier.fillMaxSize(), contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (downloadPct in 1..99) "Browser-Laufzeit wird geladen … $downloadPct %"
                    else "Browser-Laufzeit wird vorbereitet …",
                )
            }
        }
    }
}

@Composable
private fun BrowserFallback(error: String) {
    val prefsUrl = loadServerUrl() ?: "http://localhost:8787"
    androidx.compose.foundation.layout.Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
    ) {
        Text("Eingebetteter Browser nicht verfügbar", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
        Text("($error)")
        Text("Kein Problem — der Leitstand läuft 1:1 im System-Browser:")
        Button(onClick = {
            runCatching { Desktop.getDesktop().browse(URI(prefsUrl)) }
        }) { Text("Leitstand im Browser öffnen → $prefsUrl") }
    }
}

private val prefs: Preferences = Preferences.userRoot().node("de.horrorgeticon.ops")

actual fun loadServerUrl(): String? = prefs.get("serverUrl", null)

actual fun saveServerUrl(url: String?) {
    if (url == null) prefs.remove("serverUrl") else prefs.put("serverUrl", url)
    prefs.flush()
}
