import { prepareLyricGroups } from './lyrics/engine'
import { useAppStore } from './store/app-store'

export function installDemoState(): void {
  const cover = 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=85'
  const track = {
    id: 'demo-track',
    title: '在星光抵达以前',
    artist: ['林序', '北岸乐队'],
    album: '漫游频率',
    duration: 246,
    cover,
    source: 'netease' as const,
    sourceId: 'demo-source',
    urlId: 'demo-url',
    lyricId: 'demo-lyric',
  }
  const lyricLines = [
    ['夜色在窗沿停留', 0, 4_200, 'The night lingers by the window'],
    ['城市把喧闹都调成静音', 4_200, 8_800, 'The city turns every noise down'],
    ['我们沿着未读的消息', 8_800, 13_300, 'We follow the messages left unread'],
    ['走到风开始唱歌的地方', 13_300, 18_000, 'To where the wind begins to sing'],
    ['在星光抵达以前', 18_000, 23_200, 'Before the starlight reaches us'],
    ['把这一秒留给彼此', 23_200, 28_500, 'Let this second belong to us'],
    ['如果明天醒来仍是远方', 28_500, 34_000, 'If tomorrow is still far away'],
    ['至少此刻我们听见同一首歌', 34_000, 40_000, 'At least we hear the same song now'],
  ].map(([text, startTimeMs, endTimeMs, translatedLyric]) => ({
    words: String(text).split('').map((word, index, all) => ({
      text: word,
      startTimeMs: Number(startTimeMs) + index * ((Number(endTimeMs) - Number(startTimeMs)) / all.length),
      endTimeMs: Number(startTimeMs) + (index + 1) * ((Number(endTimeMs) - Number(startTimeMs)) / all.length),
    })),
    translatedLyric: String(translatedLyric),
    startTimeMs: Number(startTimeMs),
    endTimeMs: Number(endTimeMs),
  }))
  useAppStore.getState().set({
    serverUrl: 'http://music.local:3001',
    nickname: 'Desktop Listener',
    currentUserId: 'u1',
    profile: { id: 'u1', nickname: '林舟', avatarUrl: null, hasPassword: true, role: 'user' },
    connectionStatus: 'connected',
    lyricSource: 'TTML',
    lyricGroups: prepareLyricGroups(lyricLines),
    currentTime: 20.6,
    duration: 246,
    buffered: 0.62,
    isPlaying: true,
    rooms: [{ id: 'demo-room', name: '夜航电台', hasPassword: false, permanent: true, userCount: 4, currentTrackTitle: track.title, currentTrackArtist: track.artist.join(' / ') }],
    room: {
      id: 'demo-room',
      name: '夜航电台',
      creatorId: 'u1',
      hostId: 'u1',
      hasPassword: false,
      hidden: false,
      permanent: true,
      audioQuality: 320,
      users: [
        { id: 'u1', nickname: '林舟', role: 'owner', isServerAdmin: false },
        { id: 'u2', nickname: 'Mori', role: 'member', isServerAdmin: false },
        { id: 'u3', nickname: 'Kite', role: 'member', isServerAdmin: false },
        { id: 'u4', nickname: '阿岚', role: 'member', isServerAdmin: false },
      ],
      queue: [
        { ...track, id: 'q1', title: '凌晨四点的站台', duration: 228, requestedBy: 'Mori' },
        { ...track, id: 'q2', title: '橘色海岸线', artist: ['潮汐信号'], duration: 197, requestedBy: 'Kite' },
        { ...track, id: 'q3', title: '雨停之后', artist: ['林序'], duration: 214, requestedBy: '阿岚' },
      ],
      currentTrack: track,
      playState: { isPlaying: true, currentTime: 20.6, serverTimestamp: Date.now() },
      playMode: 'loop-all',
    },
    messages: [
      { id: 'm1', userId: 'u2', nickname: 'Mori', content: '这版歌词的逐字效果很舒服。', timestamp: Date.now() - 60_000, type: 'user' },
      { id: 'm2', userId: 'u4', nickname: '阿岚', content: '下一首已经加到队列了', timestamp: Date.now() - 22_000, type: 'user' },
    ],
  })
}
