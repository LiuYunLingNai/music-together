package io.github.yueby.musictogether.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.staticCompositionLocalOf
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.Playlist
import kotlinx.coroutines.flow.distinctUntilChanged
import top.yukonga.miuix.kmp.nav.core.NavBackStack
import top.yukonga.miuix.kmp.nav.core.NavKey

internal sealed interface AppRoute : NavKey {
    data object Shell : AppRoute
    data object Search : AppRoute
    data object Recommendations : AppRoute
    data object PlaylistDetail : AppRoute
    data class Artist(val source: String, val id: String) : AppRoute
    data class UserPlaylist(val id: String) : AppRoute
    data object RoomInfo : AppRoute
    data object Members : AppRoute
    data object Queue : AppRoute
    data object Chat : AppRoute
    data object HotSongs : AppRoute
    data object Download : AppRoute
    data object CreateRoom : AppRoute
    data object JoinRoom : AppRoute
    data object PlatformAccounts : AppRoute
    data object Account : AppRoute
    data object Server : AppRoute
    data object Appearance : AppRoute
    data object PlayerDisplay : AppRoute
    data object Updates : AppRoute
    data object General : AppRoute
    data object Admin : AppRoute
}

private val roomOnlyRoutes = setOf<AppRoute>(
    AppRoute.Recommendations, AppRoute.RoomInfo, AppRoute.Members, AppRoute.Queue, AppRoute.Chat,
    AppRoute.HotSongs, AppRoute.Download, AppRoute.PlatformAccounts,
)

@Stable
internal class AppNavigator(
    val backStack: NavBackStack,
    private val viewModel: MusicTogetherViewModel,
) {
    val atShell: Boolean get() = backStack.size <= 1

    fun open(route: AppRoute) {
        if (backStack.lastOrNull() == route) return
        val singleInstanceIndex = backStack.indexOfFirst { existing ->
            existing == route || existing.isSameDetailKind(route)
        }
        if (singleInstanceIndex > 0) {
            while (backStack.size > singleInstanceIndex) backStack.removeAt(backStack.lastIndex)
        }
        backStack.add(route)
    }

    fun pop() {
        if (backStack.size > 1) backStack.removeAt(backStack.lastIndex)
    }

    fun popToShell() {
        while (backStack.size > 1) backStack.removeAt(backStack.lastIndex)
    }

    fun dropRoomRoutes() {
        val firstRoomRoute = backStack.indexOfFirst { it in roomOnlyRoutes || it == AppRoute.PlaylistDetail }
        if (firstRoomRoute > 0) {
            while (backStack.size > firstRoomRoute) backStack.removeAt(backStack.lastIndex)
        }
    }

    fun openArtist(source: String, id: String) {
        viewModel.openArtist(source, id)
        open(AppRoute.Artist(source, id))
    }

    fun openPlaylist(playlist: Playlist) {
        viewModel.openPlaylist(playlist)
        open(AppRoute.PlaylistDetail)
    }

    fun openUserPlaylist(id: String) {
        viewModel.openUserPlaylist(id)
        open(AppRoute.UserPlaylist(id))
    }

    private fun NavKey.isSameDetailKind(other: AppRoute): Boolean = when (other) {
        is AppRoute.Artist -> this is AppRoute.Artist
        is AppRoute.UserPlaylist -> this is AppRoute.UserPlaylist
        AppRoute.PlaylistDetail -> this == AppRoute.PlaylistDetail
        else -> false
    }
}

internal val LocalAppNavigator = staticCompositionLocalOf<AppNavigator> {
    error("AppNavigator is not provided")
}

@Composable
internal fun AppRouteLifecycleEffects(navigator: AppNavigator, viewModel: MusicTogetherViewModel) {
    LaunchedEffect(navigator) {
        var previous = emptySet<String>()
        snapshotFlow {
            navigator.backStack.mapNotNullTo(mutableSetOf()) { route ->
                when (route) {
                    AppRoute.PlaylistDetail -> "playlist"
                    is AppRoute.Artist -> "artist"
                    is AppRoute.UserPlaylist -> "user-playlist"
                    else -> null
                }
            }.toSet()
        }.distinctUntilChanged().collect { current ->
            if ("playlist" in previous && "playlist" !in current) viewModel.closePlaylist()
            if ("artist" in previous && "artist" !in current) viewModel.closeArtist()
            if ("user-playlist" in previous && "user-playlist" !in current) viewModel.closeUserPlaylist()
            previous = current
        }
    }
}
