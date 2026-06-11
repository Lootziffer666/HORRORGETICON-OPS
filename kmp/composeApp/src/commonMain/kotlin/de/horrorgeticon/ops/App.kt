package de.horrorgeticon.ops

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.multiplatform.webview.web.LoadingState
import com.multiplatform.webview.web.WebView
import com.multiplatform.webview.web.rememberWebViewNavigator
import com.multiplatform.webview.web.rememberWebViewState

/**
 * Horrorgeticon Ops — Geräte-Shell.
 * Die komplette Fachlogik lebt in der Web-Plattform (server/ + web/);
 * diese App ist der native Rahmen: Server wählen, Vollbild-Webview,
 * Verbindungsfehler sauber abfangen. Ein Codestand für
 * Windows (Compose Desktop/KCEF), Android (WebView) und iOS (WKWebView).
 */

val Navy = Color(0xFF0D2847)
val Orange = Color(0xFFF2994A)
val OffWhite = Color(0xFFF8F6F2)

@Composable
fun App() {
    var serverUrl by remember { mutableStateOf(loadServerUrl()) }

    MaterialTheme {
        val url = serverUrl
        if (url == null) {
            ConnectScreen(onConnect = { entered ->
                val normalized = normalizeUrl(entered)
                saveServerUrl(normalized)
                serverUrl = normalized
            })
        } else {
            OpsWebScreen(url = url, onChangeServer = {
                saveServerUrl(null)
                serverUrl = null
            })
        }
    }
}

fun normalizeUrl(raw: String): String {
    var u = raw.trim()
    if (u.isEmpty()) u = "http://localhost:8787"
    if (!u.startsWith("http://") && !u.startsWith("https://")) u = "http://$u"
    return u.trimEnd('/')
}

@Composable
fun ConnectScreen(onConnect: (String) -> Unit) {
    var input by remember { mutableStateOf("") }
    Box(
        modifier = Modifier.fillMaxSize().background(Navy),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = OffWhite,
            modifier = Modifier.widthIn(max = 420.dp).padding(16.dp),
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Box(
                    modifier = Modifier.size(64.dp).background(Navy, RoundedCornerShape(16.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("👻", fontSize = 30.sp)
                }
                Row {
                    Text("Horrorgeticon ", fontWeight = FontWeight.Black, fontSize = 22.sp, color = Navy)
                    Text("Ops", fontWeight = FontWeight.Black, fontSize = 22.sp, color = Orange)
                }
                Text(
                    "Leitstand für den Wahnsinn vor Ort.\nAdresse des Ops-Servers eingeben (steht am Crew-Büro-Aushang).",
                    fontSize = 13.sp, color = Color(0xFF4F4F4F),
                )
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    label = { Text("Server, z. B. 192.168.31.10:8787") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { onConnect(input) },
                    colors = ButtonDefaults.buttonColors(containerColor = Orange),
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    Text("Verbinden", fontWeight = FontWeight.Bold)
                }
                Text("Zugang nur für eingeteilte Crew · v1.0", fontSize = 11.sp, color = Color(0xFF828282))
            }
        }
    }
}

@Composable
fun OpsWebScreen(url: String, onChangeServer: () -> Unit) {
    val state = rememberWebViewState(url)
    val navigator = rememberWebViewNavigator()

    Box(Modifier.fillMaxSize().background(Navy)) {
        WebView(
            state = state,
            navigator = navigator,
            modifier = Modifier.fillMaxSize(),
        )

        when (val loading = state.loadingState) {
            is LoadingState.Loading -> Box(
                Modifier.fillMaxSize().background(Navy),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(color = Orange)
                    Text("Verbinde mit $url …", color = OffWhite, fontSize = 13.sp)
                }
            }
            else -> Unit
        }

        val error = state.errorsForCurrentRequest.firstOrNull()
        if (error != null && error.isFromMainFrame) {
            Box(Modifier.fillMaxSize().background(Navy), contentAlignment = Alignment.Center) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(24.dp),
                ) {
                    Text("⚠️", fontSize = 34.sp)
                    Text("Keine Verbindung zum Ops-Server", color = OffWhite, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Text(
                        "Läuft der Server? Stimmt die Adresse?\n$url",
                        color = Color(0xCCF8F6F2), fontSize = 13.sp,
                    )
                    Spacer(Modifier.height(4.dp))
                    Button(
                        onClick = { navigator.reload() },
                        colors = ButtonDefaults.buttonColors(containerColor = Orange),
                    ) { Text("Erneut versuchen", fontWeight = FontWeight.Bold) }
                    TextButton(onClick = onChangeServer) {
                        Text("Anderen Server wählen", color = OffWhite)
                    }
                }
            }
        }
    }
}
