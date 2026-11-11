import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useArtist } from '@/hooks/useArtist'
import { usePlaylist } from '@/hooks/usePlaylist'
import { useArtistPageStore, type ArtistTarget } from '@/stores/artistPageStore'
import type { Playlist } from '@music-together/shared'
import { useCallback, useEffect, useState } from 'react'
import { ArtistDetail } from './ArtistDetail'
import { PlaylistDetail } from './Settings/PlaylistDetail'

/** 全局歌手页：任何地方的歌手名都通过 openArtistPage 打开，叠在来源对话框之上，关闭即返回。 */
export function ArtistDialog() {
  const target = useArtistPageStore((state) => state.target)
  const close = useArtistPageStore((state) => state.close)
  return (
    <ResponsiveDialog open={target !== null} onOpenChange={(open) => !open && close()}>
      <ResponsiveDialogContent className="flex h-dvh max-h-dvh flex-col overflow-hidden sm:h-[80vh] sm:max-h-[80vh] sm:max-w-2xl">
        {target ? <ArtistPage key={`${target.source}:${target.id ?? target.name}`} target={target} /> : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function ArtistPage({ target }: { target: ArtistTarget }) {
  const artistState = useArtist()
  const playlist = usePlaylist()
  const [album, setAlbum] = useState<Playlist | null>(null)
  const { load, loadByName } = artistState
  const { source, id, name } = target

  const open = useCallback(() => {
    if (id) void load(source, id, { id, name, cover: '', source })
    else void loadByName(source, name)
  }, [source, id, name, load, loadByName])

  useEffect(() => {
    open()
  }, [open])

  const openAlbum = (selected: Playlist) => {
    setAlbum(selected)
    void playlist.fetchPlaylistTracks(source, selected.id, selected.trackCount, 'album')
  }

  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle className="truncate pr-8">
          {album ? album.name : (artistState.artist?.name ?? name)}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="sr-only">歌手的热门歌曲和专辑</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {album ? (
          <PlaylistDetail
            playlist={album}
            tracks={playlist.playlistTracks}
            loading={playlist.tracksLoading}
            loadingMore={playlist.loadingMore}
            hasMore={playlist.hasMoreTracks}
            total={playlist.playlistTotal}
            onBack={() => setAlbum(null)}
            onAddTrack={playlist.addTrackToQueue}
            onInsertAfterCurrent={playlist.insertTrackAfterCurrent}
            onAddAll={playlist.addBatchToQueue}
            onLoadAll={playlist.fetchAllPlaylistTracks}
            onLoadMore={playlist.loadMoreTracks}
          />
        ) : (
          <ArtistDetail
            artist={artistState.artist}
            loading={artistState.loading}
            error={artistState.error}
            songs={artistState.songs}
            songsTotal={artistState.songsTotal}
            songsHasMore={artistState.songsHasMore}
            songsLoadingMore={artistState.songsLoadingMore}
            albums={artistState.albums}
            albumsHasMore={artistState.albumsHasMore}
            albumsLoadingMore={artistState.albumsLoadingMore}
            onRetry={open}
            onAddTrack={playlist.addTrackToQueue}
            onInsertAfterCurrent={playlist.insertTrackAfterCurrent}
            onAddAll={playlist.addBatchToQueue}
            onLoadMoreSongs={() => void artistState.loadMoreSongs()}
            onLoadMoreAlbums={() => void artistState.loadMoreAlbums()}
            onSelectAlbum={openAlbum}
          />
        )}
      </ResponsiveDialogBody>
    </>
  )
}
