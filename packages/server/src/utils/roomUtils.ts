import type { RoomState } from '@music-together/shared'
import type { RoomData } from '../repositories/types.js'

/** 将内部 RoomData 转为客户端可见的 RoomState（不含密码明文） */
export function toPublicRoomState(data: RoomData): RoomState {
  return {
    id: data.id,
    name: data.name,
    creatorId: data.creatorId,
    hostId: data.hostId,
    temporaryAdminUserId: data.temporaryAdminUserId,
    hasPassword: data.password !== null,
    hidden: data.hidden,
    permanent: data.permanent,
    allowTemporaryAdminTrackRemoval: data.allowTemporaryAdminTrackRemoval,
    allowTemporaryAdminQueueClear: data.allowTemporaryAdminQueueClear,
    removePlayedTracks: data.removePlayedTracks,
    roamingEnabled: data.roamingEnabled,
    automixEnabled: data.automixEnabled,
    transitionMode: data.transitionMode,
    crossfadeMaxSec: data.crossfadeMaxSec,
    automixPerformance: data.automixPerformance,
    roamingSource: data.roamingSource,
    roamingMode: data.roamingMode,
    audioQuality: data.audioQuality,
    users: data.users,
    members: data.members,
    queue: data.queue,
    currentTrack: data.currentTrack,
    playState: data.playState,
    playMode: data.playMode,
  }
}

/** 仅 owner 可见的完整房间状态（含密码明文，用于设置面板展示） */
export function toPublicRoomStateForOwner(data: RoomData): RoomState {
  return {
    ...toPublicRoomState(data),
    password: data.password ?? null,
    bannedMembers: data.bannedMembers,
  }
}

/**
 * 服务器管理员/房主管理视角：需要封禁名单来解封，但不应看到房间密码。
 * 被封禁者本身不会在房间内，普通成员也拿不到这份状态。
 */
export function toPublicRoomStateForModerator(data: RoomData): RoomState {
  return {
    ...toPublicRoomState(data),
    bannedMembers: data.bannedMembers,
  }
}
