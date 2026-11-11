package io.github.yueby.musictogether.model

import androidx.compose.runtime.Immutable

@Immutable
data class UnifiedSearchGroup(
    val key: String,
    val title: String,
    val artist: List<String>,
    val duration: Double,
    val version: String?,
    val candidates: List<Track>,
)
