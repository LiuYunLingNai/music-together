package io.github.yueby.musictogether.model

import androidx.compose.runtime.Immutable

@Immutable
data class PlaybackFailure(
    val source: String,
    val reason: String,
    val retryable: Boolean = false,
    val actionable: Boolean = false,
    val providerCode: String? = null,
    val providerMessage: String? = null,
    val httpStatus: Int? = null,
    val retryAfterMs: Long? = null,
)

@Immutable
data class PlaybackFailureEvent(
    val trackId: String,
    val track: Track,
    val failure: PlaybackFailure,
    val nextAction: String,
    val autoActionInMs: Long? = null,
)

@Immutable
data class PlaybackFailureState(
    val event: PlaybackFailureEvent,
    val localOnly: Boolean = false,
    val visible: Boolean = true,
    val busy: Boolean = false,
    val message: String? = null,
)
