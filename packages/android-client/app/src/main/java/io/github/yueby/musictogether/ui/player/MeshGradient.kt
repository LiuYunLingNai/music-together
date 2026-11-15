package io.github.yueby.musictogether.ui.player

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

/** One control point of an AMLL mesh preset: position in -1..1, tangent rotations in degrees, tangent scales. */
internal class MeshControlPoint(
    val x: Float,
    val y: Float,
    val ur: Float = 0f,
    val vr: Float = 0f,
    val up: Float = 1f,
    val vp: Float = 1f,
)

internal class MeshPreset(val width: Int, val height: Int, val points: List<MeshControlPoint>)

/** Triangles of the warped cover: positions in WebGL clip space (y up), texture coordinates in 0..1. */
internal class MeshGeometry(val positions: FloatArray, val uvs: FloatArray, val indices: ShortArray)

private const val MeshSubdivisions = 20

private fun cp(x: Double, y: Double, ur: Double = 0.0, vr: Double = 0.0, up: Double = 1.0, vp: Double = 1.0) =
    MeshControlPoint(x.toFloat(), y.toFloat(), ur.toFloat(), vr.toFloat(), up.toFloat(), vp.toFloat())

private const val T = 1.0 / 3.0

/** AMLL `CONTROL_POINT_PRESETS`, row by row. */
internal val MeshPresets: List<MeshPreset> = listOf(
    MeshPreset(
        5, 5,
        listOf(
            cp(-1.0, -1.0), cp(-0.5, -1.0), cp(0.0, -1.0), cp(0.5, -1.0), cp(1.0, -1.0),
            cp(-1.0, -0.5), cp(-0.5, -0.5), cp(-0.0052029684413368305, -0.6131420587090777),
            cp(0.5884227308309977, -0.3990805107556692), cp(1.0, -0.5),
            cp(-1.0, 0.0), cp(-0.4210024670505933, -0.11895058380429502),
            cp(-0.1019613423315412, -0.023812118047224606, 0.0, -47.0, 0.629, 0.849),
            cp(0.40275125660925437, -0.06345314544600389), cp(1.0, 0.0),
            cp(-1.0, 0.5), cp(0.06801958477287173, 0.5205913248960121, -31.0, -45.0),
            cp(0.21446469120128908, 0.29331610114301043, 6.0, -56.0, 0.566, 1.321), cp(0.5, 0.5), cp(1.0, 0.5),
            cp(-1.0, 1.0), cp(-0.31378372841550195, 1.0), cp(0.26153633255328046, 1.0), cp(0.5, 1.0), cp(1.0, 1.0),
        ),
    ),
    MeshPreset(
        4, 4,
        listOf(
            cp(-1.0, -1.0), cp(-T, -1.0), cp(T, -1.0), cp(1.0, -1.0),
            cp(-1.0, -0.04495399932657351), cp(-0.24056117520129328, -0.22465999020104),
            cp(0.334758885767489, -0.00531297192779423),
            cp(0.9989920470678106, -0.3382976020775408, 8.0, 0.0, 0.566, 1.792),
            cp(-1.0, T), cp(-0.3425497314639411, -0.000027501607956947893), cp(0.3321437945812673, 0.1981776353859399),
            cp(1.0, 0.0766118180296832),
            cp(-1.0, 1.0), cp(-T, 1.0), cp(T, 1.0), cp(1.0, 1.0),
        ),
    ),
    MeshPreset(
        4, 4,
        listOf(
            cp(-1.0, -1.0, 0.0, 0.0, 1.0, 2.075), cp(-T, -1.0), cp(T, -1.0), cp(1.0, -1.0),
            cp(-1.0, -0.4545779491139603), cp(-T, -T), cp(0.0889403142626457, -0.6025711180694033, -32.0, 45.0),
            cp(1.0, -T),
            cp(-1.0, -0.07402408608567845, 1.0, 0.0, 1.0, 0.094),
            cp(-0.2719422694359541, 0.09775369930903222, 25.0, -18.0, 1.321, 0.0),
            cp(0.19877414408395877, 0.4307383294587789, 48.0, -40.0, 0.755, 0.975), cp(1.0, T, -37.0),
            cp(-1.0, 1.0), cp(-T, 1.0), cp(0.5125850864305672, 1.0, -20.0, -18.0, 0.0, 1.604), cp(1.0, 1.0),
        ),
    ),
    MeshPreset(
        5, 5,
        listOf(
            cp(-1.0, -1.0), cp(-0.4501953125, -1.0, 0.0, 55.0, 1.0, 2.075), cp(0.1953125, -1.0),
            cp(0.4580078125, -1.0, 0.0, -25.0), cp(1.0, -1.0),
            cp(-1.0, -0.2514475377525607, -16.0, 0.0, 2.327, 0.943),
            cp(-0.55859375, -0.6609325945787148, 47.0, 0.0, 2.358, 0.377),
            cp(0.232421875, -0.5244375756366635, -66.0, -25.0, 1.855, 1.164),
            cp(0.685546875, -0.3753706470552125), cp(1.0, -0.6699125300354287),
            cp(-1.0, 0.035910396862284255), cp(-0.4921875, 0.005378616309457018, 90.0, 23.0, 1.0, 1.981),
            cp(0.021484375, -0.1365043639066228, 0.0, 42.0),
            cp(0.4765625, 0.05925822904974043, -30.0, 0.0, 1.95, 0.44), cp(1.0, 0.251428847823418),
            cp(-1.0, 0.6968336464764276, -68.0, 0.0, 1.0, 0.786), cp(-0.6904296875, 0.5890744209958608, -68.0),
            cp(0.1845703125, 0.3879238667654693, 61.0),
            cp(0.60546875, 0.4633553246018661, -47.0, -59.0, 0.849, 1.73),
            cp(1.0, 0.6214021886400309, -33.0, 0.0, 0.377, 1.604),
            cp(-1.0, 1.0), cp(-0.5, 1.0, 0.0, -73.0), cp(-0.3271484375, 1.0, 0.0, -24.0, 0.314, 2.704),
            cp(0.5, 1.0), cp(1.0, 1.0),
        ),
    ),
    MeshPreset(
        5, 5,
        listOf(
            cp(-1.0, -1.0), cp(-0.6393, -1.0, 0.0, 0.0, 1.0, 2.3884), cp(0.0, -1.0), cp(0.5, -1.0), cp(1.0, -1.0),
            cp(-1.0, -0.2301), cp(-0.6934, -0.331, 0.0, -0.7188, 1.0, 1.063),
            cp(-0.0082, -0.6814, -0.2583, 0.0, 1.0964, 1.0), cp(0.5836, -0.531, 0.7029, 0.0, 1.5466, 1.0),
            cp(1.0, -0.6407),
            cp(-1.0, 0.2973, 0.0, 0.0, 1.8352, 1.0), cp(-0.4082, 0.0602),
            cp(-0.1803, -0.3646, -0.2998, 0.0, 1.1513, 1.0), cp(0.477, -0.1027, 0.8903, -0.1882, 1.0807, 0.8551),
            cp(1.0, -0.2973),
            cp(-1.0, 0.7628, 0.0, 0.0, 2.3868, 1.0), cp(-0.2525, 0.4814, -0.8406, -1.6199, 1.4093, 1.2215),
            cp(0.3607, 0.2814, -1.0713, -0.0529, 1.0025, 0.7611), cp(0.4885, 0.623, 0.0, 0.8184, 1.0, 1.2876),
            cp(1.0, 0.5),
            cp(-1.0, 1.0), cp(-0.4033, 1.0), cp(0.2672, 1.0), cp(0.5967, 1.0), cp(1.0, 1.0),
        ),
    ),
    MeshPreset(
        5, 5,
        listOf(
            cp(-1.0, -1.0), cp(-0.2197, -1.0), cp(0.0197, -1.0), cp(0.8033, -1.0), cp(1.0, -1.0),
            cp(-1.0, -0.5451), cp(-0.4885, -0.4035, -1.0246, -0.2268, 1.1936, 0.8005),
            cp(-0.1213, -0.2867, 0.0, -0.6981, 1.0, 0.809), cp(0.3246, -0.5628, 0.0, -1.2188, 1.0, 1.044),
            cp(1.0, -0.3292),
            cp(-1.0, 0.1416), cp(-0.341, -0.0142, 0.0, -0.4004, 1.0, 1.1293),
            cp(-0.0393, -0.023, 0.2915, -0.373, 1.044, 0.9879), cp(0.3148, -0.0673, -0.7853, -0.8962, 1.4709, 1.0247),
            cp(1.0, 0.1912),
            cp(-1.0, 0.5), cp(-0.2689, 0.2743, 0.3404, -0.5248, 1.0184, 0.4391),
            cp(0.0721, 0.269, 0.5302, 0.1244, 0.6723, 0.3225), cp(0.4148, 0.3894, -0.6977, -0.6783, 0.8094, 0.9247),
            cp(1.0, 0.446),
            cp(-1.0, 1.0), cp(-0.7311, 1.0), cp(0.323, 1.0), cp(0.6393, 1.0), cp(1.0, 1.0),
        ),
    ),
)

/** AMLL `createMeshState`: one time in five a generated 6x6 grid, otherwise one of the presets. */
internal fun pickMeshPreset(random: Random = Random.Default): MeshPreset =
    if (random.nextFloat() > 0.8f) generateMeshPreset(6, 6, random) else MeshPresets[random.nextInt(MeshPresets.size)]

private fun fract(value: Float) = value - floor(value)

private fun cellNoise(x: Float, y: Float) = fract(sin(x * 12.9898f + y * 78.233f) * 43758.5453f)

private fun smoothNoise(x: Float, y: Float): Float {
    val x0 = floor(x)
    val y0 = floor(y)
    val xf = x - x0
    val yf = y - y0
    val u = xf * xf * (3 - 2 * xf)
    val v = yf * yf * (3 - 2 * yf)
    val low = cellNoise(x0, y0) * (1 - u) + cellNoise(x0 + 1, y0) * u
    val high = cellNoise(x0, y0 + 1) * (1 - u) + cellNoise(x0 + 1, y0 + 1) * u
    return low * (1 - v) + high * v
}

/** AMLL `generateControlPoints`: a jittered grid pushed along a noise gradient, then smoothed. */
internal fun generateMeshPreset(width: Int, height: Int, random: Random): MeshPreset {
    fun range(from: Float, to: Float) = random.nextFloat() * (to - from) + from
    val variation = range(0.4f, 0.6f)
    val normalOffset = range(0.3f, 0.6f)
    val blend = 0.8f
    val smoothIterations = floor(range(3f, 5f)).toInt()
    var factor = range(0.2f, 0.3f)
    val factorStep = range(-0.1f, -0.05f)
    val dx = 2f / (width - 1)
    val dy = 2f / (height - 1)
    var grid = Array(height) { j ->
        Array(width) { i ->
            val baseX = i.toFloat() / (width - 1) * 2 - 1
            val baseY = j.toFloat() / (height - 1) * 2 - 1
            if (i == 0 || i == width - 1 || j == 0 || j == height - 1) {
                MeshControlPoint(baseX, baseY)
            } else {
                var x = baseX + range(-variation * dx, variation * dx)
                var y = baseY + range(-variation * dy, variation * dy)
                val ur = range(-60f, 60f)
                val vr = range(-60f, 60f)
                val up = range(0.8f, 1.2f)
                val vp = range(0.8f, 1.2f)
                val uNorm = (baseX + 1) / 2
                val vNorm = (baseY + 1) / 2
                val epsilon = 0.001f
                val gx = (smoothNoise(uNorm + epsilon, vNorm) - smoothNoise(uNorm - epsilon, vNorm)) / (2 * epsilon)
                val gy = (smoothNoise(uNorm, vNorm + epsilon) - smoothNoise(uNorm, vNorm - epsilon)) / (2 * epsilon)
                val length = sqrt(gx * gx + gy * gy).takeIf { it != 0f } ?: 1f
                val edge = min(min(uNorm, 1 - uNorm), min(vNorm, 1 - vNorm)).coerceIn(0f, 1f)
                val weight = edge * edge * (3 - 2 * edge)
                x += gx / length * normalOffset * weight * blend
                y += gy / length * normalOffset * weight * blend
                MeshControlPoint(x, y, ur, vr, up, vp)
            }
        }
    }
    val kernel = arrayOf(floatArrayOf(1f, 2f, 1f), floatArrayOf(2f, 4f, 2f), floatArrayOf(1f, 2f, 1f))
    repeat(smoothIterations) {
        val source = grid
        grid = Array(height) { j ->
            Array(width) { i ->
                val current = source[j][i]
                if (i == 0 || i == width - 1 || j == 0 || j == height - 1) return@Array current
                val sums = FloatArray(6)
                for (dj in -1..1) for (di in -1..1) {
                    val weight = kernel[dj + 1][di + 1]
                    val near = source[j + dj][i + di]
                    sums[0] += near.x * weight
                    sums[1] += near.y * weight
                    sums[2] += near.ur * weight
                    sums[3] += near.vr * weight
                    sums[4] += near.up * weight
                    sums[5] += near.vp * weight
                }
                fun mix(own: Float, sum: Float) = own * (1 - factor) + sum / 16f * factor
                MeshControlPoint(
                    mix(current.x, sums[0]), mix(current.y, sums[1]), mix(current.ur, sums[2]),
                    mix(current.vr, sums[3]), mix(current.up, sums[4]), mix(current.vp, sums[5]),
                )
            }
        }
        factor = (factor + factorStep).coerceIn(0f, 1f)
    }
    return MeshPreset(width, height, grid.flatMap { it.asList() })
}

/** Cubic Hermite weights for (start point, end point, start tangent, end tangent). */
private fun hermite(t: Float, out: FloatArray) {
    val t2 = t * t
    val t3 = t2 * t
    out[0] = 2 * t3 - 3 * t2 + 1
    out[1] = -2 * t3 + 3 * t2
    out[2] = t3 - 2 * t2 + t
    out[3] = t3 - t2
}

/** AMLL `BHPMesh.updateMesh`: every cell between four control points becomes a bicubic Hermite patch. */
internal fun buildMeshGeometry(preset: MeshPreset, subdivisions: Int = MeshSubdivisions): MeshGeometry {
    val w = preset.width
    val h = preset.height
    val uPower = 2f / (w - 1)
    val vPower = 2f / (h - 1)
    val radians = (PI / 180).toFloat()
    // Per point: location, u tangent, v tangent; two axes each.
    val location = Array(2) { FloatArray(w * h) }
    val uTangent = Array(2) { FloatArray(w * h) }
    val vTangent = Array(2) { FloatArray(w * h) }
    preset.points.forEachIndexed { index, point ->
        location[0][index] = point.x
        location[1][index] = point.y
        uTangent[0][index] = cos(point.ur * radians) * uPower * point.up
        uTangent[1][index] = sin(point.ur * radians) * uPower * point.up
        vTangent[0][index] = -sin(point.vr * radians) * vPower * point.vp
        vTangent[1][index] = cos(point.vr * radians) * vPower * point.vp
    }
    val patches = (w - 1) * (h - 1)
    val perPatch = subdivisions * subdivisions
    val positions = FloatArray(patches * perPatch * 2)
    val uvs = FloatArray(patches * perPatch * 2)
    val indices = ShortArray(patches * (subdivisions - 1) * (subdivisions - 1) * 6)
    val hs = FloatArray(4)
    val ht = FloatArray(4)
    var vertex = 0
    var index = 0
    for (cy in 0 until h - 1) for (cx in 0 until w - 1) {
        val p00 = cx + cy * w
        val p10 = p00 + 1
        val p01 = p00 + w
        val p11 = p01 + 1
        val base = vertex
        for (row in 0 until subdivisions) {
            hermite(row.toFloat() / (subdivisions - 1), ht)
            for (column in 0 until subdivisions) {
                val s = column.toFloat() / (subdivisions - 1)
                hermite(s, hs)
                for (axis in 0..1) {
                    val l = location[axis]
                    val u = uTangent[axis]
                    val v = vTangent[axis]
                    positions[vertex * 2 + axis] =
                        hs[0] * (l[p00] * ht[0] + l[p01] * ht[1] + v[p00] * ht[2] + v[p01] * ht[3]) +
                        hs[1] * (l[p10] * ht[0] + l[p11] * ht[1] + v[p10] * ht[2] + v[p11] * ht[3]) +
                        hs[2] * (u[p00] * ht[0] + u[p01] * ht[1]) +
                        hs[3] * (u[p10] * ht[0] + u[p11] * ht[1])
                }
                uvs[vertex * 2] = (cx + s) / (w - 1)
                uvs[vertex * 2 + 1] = 1f - (cy + row.toFloat() / (subdivisions - 1)) / (h - 1)
                vertex += 1
            }
        }
        for (row in 0 until subdivisions - 1) for (column in 0 until subdivisions - 1) {
            val corner = base + row * subdivisions + column
            indices[index++] = corner.toShort()
            indices[index++] = (corner + 1).toShort()
            indices[index++] = (corner + subdivisions).toShort()
            indices[index++] = (corner + 1).toShort()
            indices[index++] = (corner + subdivisions + 1).toShort()
            indices[index++] = (corner + subdivisions).toShort()
        }
    }
    return MeshGeometry(positions, uvs, indices)
}
