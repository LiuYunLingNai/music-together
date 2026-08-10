package io.github.yueby.musictogether.network

import io.github.yueby.musictogether.model.DEFAULT_MUSIC_DOWNLOAD_DIRECTORY
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MusicDownloadStorageTest {
    @Test
    fun `resolves default and custom public download folders`() {
        val defaultDirectory = resolveMusicDownloadDirectory(DEFAULT_MUSIC_DOWNLOAD_DIRECTORY)
        val customDirectory = resolveMusicDownloadDirectory("/storage/emulated/0/Download/My Music/Albums/")

        assertEquals("Download/music-together", defaultDirectory?.mediaStoreRelativePath)
        assertEquals("/storage/emulated/0/Download/My Music/Albums", customDirectory?.absolutePath)
        assertEquals("Download/My Music/Albums", customDirectory?.mediaStoreRelativePath)
    }

    @Test
    fun `rejects paths outside public downloads and traversal`() {
        assertNull(resolveMusicDownloadDirectory("/storage/emulated/0/Music"))
        assertNull(resolveMusicDownloadDirectory("/storage/emulated/0/Download/music-together/../private"))
        assertNull(resolveMusicDownloadDirectory("/storage/emulated/0/Download/bad:name"))
    }

    @Test
    fun `chooses a non conflicting file name`() {
        val name = uniqueDownloadFileName(
            "Song.flac",
            setOf("Song.flac", "Song (1).flac", "Song (2).flac"),
        )

        assertEquals("Song (3).flac", name)
    }
}
