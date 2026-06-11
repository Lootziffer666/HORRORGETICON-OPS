package de.horrorgeticon.ops

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        appContext = applicationContext
        setContent { App() }
    }
}

@SuppressLint("StaticFieldLeak")
internal var appContext: Context? = null

actual fun loadServerUrl(): String? =
    appContext?.getSharedPreferences("ops", Context.MODE_PRIVATE)?.getString("serverUrl", null)

actual fun saveServerUrl(url: String?) {
    appContext?.getSharedPreferences("ops", Context.MODE_PRIVATE)?.edit()?.apply {
        if (url == null) remove("serverUrl") else putString("serverUrl", url)
        apply()
    }
}
