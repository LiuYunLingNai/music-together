package io.github.yueby.musictogether.network

object Events {
    const val ROOM_CREATE = "room:create"
    const val ROOM_CREATED = "room:created"
    const val ROOM_JOIN = "room:join"
    const val ROOM_LEAVE = "room:leave"
    const val ROOM_STATE = "room:state"
    const val ROOM_REJOIN_TOKEN = "room:rejoin_token"
    const val ROOM_USER_JOINED = "room:user_joined"
    const val ROOM_USER_LEFT = "room:user_left"
    const val ROOM_LIST = "room:list"
    const val ROOM_LIST_UPDATE = "room:list_update"
    const val ROOM_ERROR = "room:error"
    const val ROOM_ROLE_CHANGED = "room:role_changed"

    const val PLAYER_PLAY = "player:play"
    const val PLAYER_PAUSE = "player:pause"
    const val PLAYER_RESUME = "player:resume"
    const val PLAYER_SEEK = "player:seek"
    const val PLAYER_NEXT = "player:next"
    const val PLAYER_PREV = "player:prev"
    const val PLAYER_SYNC = "player:sync"
    const val PLAYER_SYNC_REQUEST = "player:sync_request"
    const val PLAYER_SYNC_RESPONSE = "player:sync_response"
    const val PLAYER_SET_MODE = "player:set_mode"

    const val QUEUE_ADD = "queue:add"
    const val QUEUE_INSERT_AFTER_CURRENT = "queue:insert_after_current"
    const val QUEUE_REMOVE = "queue:remove"
    const val QUEUE_CLEAR = "queue:clear"
    const val QUEUE_REORDER = "queue:reorder"
    const val QUEUE_UPDATED = "queue:updated"

    const val CHAT_MESSAGE = "chat:message"
    const val CHAT_HISTORY = "chat:history"

    const val VOTE_START = "vote:start"
    const val VOTE_STARTED = "vote:started"
    const val VOTE_CAST = "vote:cast"
    const val VOTE_RESULT = "vote:result"

    const val NTP_PING = "ntp:ping"
    const val NTP_PONG = "ntp:pong"
}
