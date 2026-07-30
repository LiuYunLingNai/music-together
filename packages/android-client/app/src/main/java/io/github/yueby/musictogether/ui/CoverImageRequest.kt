package io.github.yueby.musictogether.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import coil3.request.allowHardware

internal val coverNetworkHeaders: NetworkHeaders = NetworkHeaders.EMPTY

/** Load the upstream cover directly without leaking the app/server as a referrer. */
@Composable
internal fun rememberCoverImageRequest(url: String?): ImageRequest {
    val context = LocalContext.current
    return remember(context, url) {
        ImageRequest.Builder(context)
            .data(url)
            .httpHeaders(coverNetworkHeaders)
            .build()
    }
}

/**
 * The player backdrop is intentionally decoded at a tiny software size. It is
 * blurred when rendered, so a full-resolution bitmap would only waste memory
 * and make palette extraction more expensive.
 */
@Composable
internal fun rememberBackdropImageRequest(url: String?): ImageRequest {
    val context = LocalContext.current
    return remember(context, url) {
        ImageRequest.Builder(context)
            .data(url)
            .httpHeaders(coverNetworkHeaders)
            .size(96)
            .allowHardware(false)
            .build()
    }
}
