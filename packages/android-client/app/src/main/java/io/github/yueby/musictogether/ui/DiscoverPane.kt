package io.github.yueby.musictogether.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import io.github.yueby.musictogether.MusicTogetherViewModel
import io.github.yueby.musictogether.ui.designsystem.AppTextAction
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
internal fun DiscoverPane(
    viewModel: MusicTogetherViewModel,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val navigator = LocalAppNavigator.current
    val catalog by viewModel.catalogState.collectAsStateWithLifecycle()
    val discover = catalog.discover
    LaunchedEffect(Unit) { viewModel.loadDiscover() }
    val home = discover.home
    when {
        home == null && discover.error != null -> Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(discover.error, color = MiuixTheme.colorScheme.error)
            AppTextAction(onClick = { viewModel.loadDiscover(force = true) }) { Text("重试") }
        }
        home == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        else -> LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp + contentPadding.calculateBottomPadding()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (home.radar.isNotEmpty()) {
                item(key = "radar") {
                    DiscoverSection("雷达歌单") {
                        items(home.radar, key = { "radar:${it.id}" }) { playlist ->
                            DiscoverCard(playlist.cover, playlist.name, playlist.creator, 128.dp, false) {
                                navigator.openPlaylist(playlist)
                            }
                        }
                    }
                }
            }
            if (home.artists.isNotEmpty()) {
                item(key = "artists") {
                    DiscoverSection("热门歌手") {
                        items(home.artists, key = { "artist:${it.id}" }) { artist ->
                            DiscoverCard(artist.cover, artist.name, null, 96.dp, true) {
                                navigator.openArtist(artist.source, artist.id)
                            }
                        }
                    }
                }
            }
            if (home.albums.isNotEmpty()) {
                item(key = "albums") {
                    DiscoverSection("新碟上架") {
                        items(home.albums, key = { "album:${it.id}" }) { album ->
                            DiscoverCard(album.cover, album.name, album.creator, 128.dp, false) {
                                navigator.openPlaylist(album)
                            }
                        }
                    }
                }
            }
            if (home.failed.isNotEmpty()) {
                item(key = "failed") {
                    Text(
                        "部分栏目暂时加载失败",
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        style = MiuixTheme.textStyles.paragraph,
                        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                    )
                }
            }
        }
    }
}

@Composable
private fun DiscoverSection(title: String, content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            title,
            modifier = Modifier.padding(horizontal = 16.dp),
            style = MiuixTheme.textStyles.title3,
            fontWeight = FontWeight.SemiBold,
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
private fun DiscoverCard(
    cover: String,
    title: String,
    subtitle: String?,
    size: Dp,
    circle: Boolean,
    onClick: () -> Unit,
) {
    Column(
        Modifier.width(size).clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        AsyncImage(
            model = cover,
            contentDescription = title,
            modifier = Modifier
                .size(size)
                .clip(if (circle) CircleShape else RoundedCornerShape(14.dp)),
            contentScale = ContentScale.Crop,
        )
        Text(
            title,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textAlign = if (circle) TextAlign.Center else TextAlign.Start,
            modifier = Modifier.fillMaxWidth(),
            style = MiuixTheme.textStyles.body2,
        )
        subtitle?.takeIf { it.isNotBlank() }?.let {
            Text(
                it,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth(),
                style = MiuixTheme.textStyles.footnote1,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
    }
}
