package de.horrorgeticon.ops

/** Gespeicherte Server-Adresse — je Plattform nativ abgelegt. */
expect fun loadServerUrl(): String?
expect fun saveServerUrl(url: String?)
