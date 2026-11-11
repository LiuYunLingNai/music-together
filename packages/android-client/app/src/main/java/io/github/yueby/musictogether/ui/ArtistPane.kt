package io.github.yueby.musictogether.ui

import top.yukonga.miuix.kmp.basic.TabRow
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.model.AppState
import io.github.yueby.musictogether.model.Artist
import io.github.yueby.musictogether.ui.designsystem.AppTextAction
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
internal fun ArtistPane(
    state: AppState,
    viewModel: MusicTogetherViewModel,
) {
    val navigator = LocalAppNavigator.current
    val catalog by viewModel.catalogState.collectAsStateWithLifecycle()
    val artistState = catalog.artist ?: return
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var descriptionExpanded by rememberSaveable { mutableStateOf(false) }
    val queueKeys = rememberQueueKeys(state)

    when {
        artistState.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        artistState.error != null && artistState.artist == null -> Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(artistState.error, color = MiuixTheme.colorScheme.error)
            AppTextAction(onClick = { viewModel.openArtist(artistState.source, artistState.id) }) { Text("重试") }
        }
        else -> LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            artistState.artist?.let { artist ->
                item(key = "header") {
                    ArtistHeader(artist, descriptionExpanded) { descriptionExpanded = !descriptionExpanded }
                }
            }
            item(key = "tabs") {
                TabRow(
                    tabs = listOf("热门歌曲", "专辑"),
                    selectedTabIndex = tab,
                    onTabSelected = { tab = it },
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            if (tab == 0) {
                if (artistState.songs.isEmpty()) {
                    item(key = "songs-empty") { ArtistEmpty("暂无歌曲") }
                }
                items(artistState.songs, key = { "song:${it.source}:${it.id}" }) { track ->
                    MusicTrackItem(track = track, state = state, viewModel = viewModel, queueKeys = queueKeys)
                }
                if (artistState.songsHasMore) {
                    item(key = "songs-more") {
                        LaunchedEffect(artistState.songs.size) { viewModel.loadMoreArtistSongs() }
                        ArtistLoadingFooter()
                    }
                }
            } else {
                if (artistState.albums.isEmpty()) {
                    item(key = "albums-empty") { ArtistEmpty("暂无专辑") }
                }
                items(artistState.albums, key = { "album:${it.id}" }) { album ->
                    PlaylistRow(album) { navigator.openPlaylist(album) }
                }
                if (artistState.albumsHasMore) {
                    item(key = "albums-more") {
                        LaunchedEffect(artistState.albums.size) { viewModel.loadMoreArtistAlbums() }
                        ArtistLoadingFooter()
                    }
                }
            }
        }
    }
}

@Composable
private fun ArtistHeader(artist: Artist, expanded: Boolean, onToggle: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            AsyncImage(
                model = artist.cover,
                contentDescription = artist.name,
                modifier = Modifier.size(88.dp).clip(CircleShape),
                contentScale = ContentScale.Crop,
            )
            Column(Modifier.weight(1f)) {
                Text(artist.name, style = MiuixTheme.textStyles.title2, fontWeight = FontWeight.Bold)
                val counts = listOfNotNull(
                    artist.songCount?.let { "$it 首歌" },
                    artist.albumCount?.let { "$it 张专辑" },
                ).joinToString(" · ")
                if (counts.isNotEmpty()) {
                    Text(
                        counts,
                        style = MiuixTheme.textStyles.paragraph,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    )
                }
            }
        }
        artist.description?.takeIf { it.isNotBlank() }?.let { description ->
            Text(
                description,
                modifier = Modifier.padding(top = 12.dp).clickable(onClick = onToggle),
                style = MiuixTheme.textStyles.body2,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                maxLines = if (expanded) Int.MAX_VALUE else 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ArtistEmpty(text: String) {
    Text(
        text,
        modifier = Modifier.fillMaxWidth().padding(32.dp),
        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
    )
}

@Composable
private fun ArtistLoadingFooter() {
    Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
    }
}
