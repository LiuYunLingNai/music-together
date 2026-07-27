package io.github.yueby.musictogether.model

data class AudioQualityOption(
    val value: String,
    val label: String,
    val platform: String? = null,
    val description: String? = null,
)

private val baseAudioQualities = listOf(
    AudioQualityOption("128", "标准 128kbps"),
    AudioQualityOption("192", "较高 192kbps"),
    AudioQualityOption("320", "高品质 320kbps"),
)

private val platformAudioQualities = mapOf(
    "netease" to listOf(
        AudioQualityOption("999", "无损 SQ", "netease"),
        AudioQualityOption("netease_hires", "Hi-Res", "netease"),
        AudioQualityOption("netease_jyeffect", "高清臻音", "netease"),
        AudioQualityOption("netease_spatial", "沉浸环绕声", "netease"),
        AudioQualityOption("netease_master", "超清母带", "netease"),
        AudioQualityOption("netease_dolby", "杜比全景声", "netease", "兼容性有限"),
    ),
    "tencent" to listOf(
        AudioQualityOption("tencent_flac", "QQ 无损", "tencent"),
        AudioQualityOption("tencent_master", "QQ 臻品母带", "tencent"),
    ),
    "kugou" to listOf(
        AudioQualityOption("kugou_hires", "酷狗 Hi-Res", "kugou"),
        AudioQualityOption("kugou_master", "酷狗臻品母带", "kugou"),
    ),
)

fun availableAudioQualities(statuses: List<PlatformAuthStatus>): List<AudioQualityOption> {
    val result = baseAudioQualities.toMutableList()
    statuses.filter { it.hasVip }.forEach { status ->
        result += platformAudioQualities[status.platform].orEmpty()
    }
    if (result.none { it.value == "999" }) {
        result += AudioQualityOption("999", "无损 SQ", description = "需要 VIP 账号")
    }
    return result.distinctBy { it.value }
}

fun audioQualityLabel(value: String): String =
    (baseAudioQualities + platformAudioQualities.values.flatten())
        .firstOrNull { it.value == value }
        ?.label
        ?: value
