package io.github.yueby.musictogether.network

internal const val SEARCH_KEYWORD_MAX_LENGTH = 100
internal const val BILIBILI_SEARCH_INPUT_MAX_LENGTH = 2000

internal fun searchInputMaxLength(source: String): Int =
    if (source == "bilibili") BILIBILI_SEARCH_INPUT_MAX_LENGTH else SEARCH_KEYWORD_MAX_LENGTH

internal fun normalizeSearchKeyword(keyword: String, source: String): String =
    keyword.trim().take(searchInputMaxLength(source))
