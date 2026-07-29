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

private val legacyAudioQualities = listOf(
    AudioQualityOption("netease_hires", "Hi-Res", "netease"),
    AudioQualityOption("netease_jyeffect", "高清臻音", "netease"),
    AudioQualityOption("netease_spatial", "沉浸环绕声", "netease"),
    AudioQualityOption("netease_master", "超清母带", "netease"),
    AudioQualityOption("netease_dolby", "杜比全景声", "netease", "兼容性有限"),
    AudioQualityOption("tencent_flac", "QQ 无损", "tencent"),
    AudioQualityOption("tencent_master", "QQ 臻品母带", "tencent"),
    AudioQualityOption("kugou_hires", "酷狗 Hi-Res", "kugou"),
    AudioQualityOption("kugou_master", "酷狗蝰蛇母带 2.0", "kugou"),
    AudioQualityOption("bilibili_64", "B站 64K", "bilibili"),
    AudioQualityOption("bilibili_132", "B站 132K", "bilibili"),
    AudioQualityOption("bilibili_192", "B站 192K", "bilibili"),
    AudioQualityOption("bilibili_hires", "B站 Hi-Res", "bilibili"),
)

fun availableAudioQualities(): List<AudioQualityOption> = baseAudioQualities + listOf(
    AudioQualityOption("999", "无损 SQ", description = "需要 VIP 账号"),
    AudioQualityOption("highest", "尽量高"),
)

fun audioQualityLabel(value: String): String =
    (availableAudioQualities() + legacyAudioQualities)
        .firstOrNull { it.value == value }
        ?.label
        ?: value
