package de.horrorgeticon.ops

import androidx.compose.ui.window.ComposeUIViewController
import platform.Foundation.NSUserDefaults
import platform.UIKit.UIViewController

/** Einstiegspunkt für die iOS-App (wird aus dem Xcode-Projekt aufgerufen). */
fun MainViewController(): UIViewController = ComposeUIViewController { App() }

actual fun loadServerUrl(): String? =
    NSUserDefaults.standardUserDefaults.stringForKey("serverUrl")

actual fun saveServerUrl(url: String?) {
    if (url == null) NSUserDefaults.standardUserDefaults.removeObjectForKey("serverUrl")
    else NSUserDefaults.standardUserDefaults.setObject(url, forKey = "serverUrl")
}
