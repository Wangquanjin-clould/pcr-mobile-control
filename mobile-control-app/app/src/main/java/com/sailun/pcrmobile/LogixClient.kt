package com.sailun.pcrmobile

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicInteger

/** Minimal EtherNet/IP explicit-message client for Logix atomic tags. */
class LogixClient {
    private var socket: Socket? = null
    private var input: BufferedInputStream? = null
    private var output: BufferedOutputStream? = null
    private var session = 0
    private val context = AtomicInteger(1)
    var host: String = "192.168.41.129"
        private set

    @Synchronized fun connect(address: String, timeoutMs: Int = 2500): String {
        disconnect()
        host = address.trim()
        val s = Socket()
        s.tcpNoDelay = true
        s.connect(InetSocketAddress(host, 44818), timeoutMs)
        s.soTimeout = 2500
        socket = s
        input = BufferedInputStream(s.getInputStream())
        output = BufferedOutputStream(s.getOutputStream())
        val reply = exchange(0x0065, byteArrayOf(1, 0, 0, 0))
        if (reply.size < 4) throw IllegalStateException("Logix RegisterSession 响应不完整")
        if (session == 0) throw IllegalStateException("Logix 拒绝 RegisterSession")
        return "已连接 $host:44818"
    }

    @Synchronized fun disconnect() {
        try { socket?.close() } catch (_: Exception) { }
        socket = null; input = null; output = null; session = 0
    }

    @Synchronized fun read(tag: String, type: String): Any {
        requireSession()
        val req = byteArrayOf(0x4c) + path(tag) + leShortBytes(1)
        val cip = exchange(0x006f, rrPayload(req))
        val data = parseCip(cip, 0xcc)
        val code = leShort(data, 0)
        val value = data.copyOfRange(2, data.size)
        return decode(type, code, value)
    }

    @Synchronized fun write(tag: String, type: String, value: String) {
        requireSession()
        val (code, bytes) = encode(type, value)
        val req = byteArrayOf(0x4d) + path(tag) + leShortBytes(code) + leShortBytes(1) + bytes
        parseCip(exchange(0x006f, rrPayload(req)), 0xcd)
    }

    @Synchronized fun writeString(tag: String, value: String, maxBytes: Int = 20) {
        val bytes = value.toByteArray(Charsets.US_ASCII).take(maxBytes).toByteArray()
        write("$tag.LEN", "DINT", bytes.size.toString())
        val padded = ByteArray(maxBytes)
        bytes.copyInto(padded)
        // STRING.DATA is an array of SINT; write the entire contiguous buffer in one CIP request.
        requireSession()
        val req = byteArrayOf(0x4d) + path("$tag.DATA[0]") + leShortBytes(0x00c2) + leShortBytes(maxBytes) + padded
        parseCip(exchange(0x006f, rrPayload(req)), 0xcd)
    }

    private fun requireSession() {
        if (socket == null || session == 0 || socket?.isClosed != false) throw IllegalStateException("PLC 未连接")
    }

    private fun rrPayload(cip: ByteArray): ByteArray = leIntBytes(0) + leShortBytes(0) + leShortBytes(2) +
        leShortBytes(0) + leShortBytes(0) + leShortBytes(0x00b2) + leShortBytes(cip.size) + cip

    private fun exchange(command: Int, payload: ByteArray): ByteArray {
        val s = socket ?: throw IllegalStateException("PLC 未连接")
        val ctx = context.getAndIncrement().toLong()
        val header = leShortBytes(command) + leShortBytes(payload.size) + leIntBytes(session) + leIntBytes(0) +
            leLongBytes(ctx) + leIntBytes(0)
        val out = output ?: throw IllegalStateException("PLC 套接字已关闭")
        out.write(header); out.write(payload); out.flush()
        val inp = input ?: throw IllegalStateException("PLC 套接字已关闭")
        val responseHeader = readExact(inp, 24)
        val len = leShort(responseHeader, 2)
        if (len > 60000) throw IllegalStateException("EtherNet/IP 响应长度异常: $len")
        val body = readExact(inp, len)
        val status = leInt(responseHeader, 8)
        if (status != 0) throw IllegalStateException("EtherNet/IP 封装状态 0x${status.toString(16)}")
        if (command == 0x0065) session = leInt(responseHeader, 4)
        return if (command == 0x006f) extractCip(body) else body
    }

    private fun extractCip(body: ByteArray): ByteArray {
        if (body.size < 16) throw IllegalStateException("SendRRData 响应不完整")
        var p = 8
        val count = leShort(body, 6)
        repeat(count) {
            if (p + 4 > body.size) throw IllegalStateException("SendRRData item 头不完整")
            val type = leShort(body, p); val size = leShort(body, p + 2); p += 4
            if (p + size > body.size) throw IllegalStateException("SendRRData item 长度异常")
            if (type == 0x00b2 || type == 0x00b1) return body.copyOfRange(p, p + size)
            p += size
        }
        throw IllegalStateException("响应中没有 CIP 数据项")
    }

    private fun parseCip(cip: ByteArray, expected: Int): ByteArray {
        if (cip.size < 4) throw IllegalStateException("CIP 响应不完整")
        val service = cip[0].toInt() and 0xff
        if (service != expected) throw IllegalStateException("CIP 服务码不匹配: 0x${service.toString(16)}")
        val status = cip[2].toInt() and 0xff
        val extraWords = cip[3].toInt() and 0xff
        val extraStart = 4; val payloadStart = extraStart + extraWords * 2
        if (status != 0) {
            val extra = (extraStart until minOf(payloadStart, cip.size)).joinToString(" ") { "%02X".format(cip[it]) }
            throw IllegalStateException("CIP 状态 0x${status.toString(16)}${if (extra.isNotEmpty()) " [$extra]" else ""}")
        }
        return cip.copyOfRange(minOf(payloadStart, cip.size), cip.size)
    }

    private fun path(tag: String): ByteArray {
        val out = ArrayList<Byte>()
        val partPattern = Regex("([A-Za-z_][A-Za-z0-9_]*)(?:\\[([0-9]+(?:,[0-9]+)*)])?")
        for (part in tag.split('.')) {
            val m = partPattern.matchEntire(part)
                ?: throw IllegalArgumentException("不支持的 Logix 标签路径: $tag")
            val name = m.groupValues[1].toByteArray(Charsets.US_ASCII)
            require(name.size <= 255) { "标签名称过长" }
            out.add(0x91.toByte()); out.add(name.size.toByte()); name.forEach(out::add)
            if (name.size % 2 != 0) out.add(0.toByte())
            val idx = m.groupValues[2]
            if (idx.isNotEmpty()) idx.split(',').forEach { token ->
                val n = token.toLongOrNull() ?: throw IllegalArgumentException("数组下标无效: $token")
                require(n in 0..Int.MAX_VALUE.toLong())
                when {
                    n <= 0xff -> { out.add(0x28.toByte()); out.add(n.toByte()) }
                    n <= 0xffff -> {
                        out.add(0x29.toByte()); out.add(0.toByte())
                        leShortBytes(n.toInt()).forEach(out::add)
                    }
                    else -> {
                        out.add(0x2a.toByte()); out.add(0.toByte())
                        leIntBytes(n.toInt()).forEach(out::add)
                    }
                }
            }
        }
        require(out.isNotEmpty() && out.size % 2 == 0 && out.size <= 510) { "Logix 标签路径长度无效: $tag" }
        return byteArrayOf((out.size / 2).toByte()) + out.toByteArray()
    }

    private fun encode(type: String, value: String): Pair<Int, ByteArray> = when (type.uppercase()) {
        "BOOL" -> 0x00c1 to byteArrayOf(if (value == "1" || value.equals("true", true)) 1 else 0)
        "SINT" -> 0x00c2 to byteArrayOf(value.toInt().toByte())
        "INT" -> 0x00c3 to leShortBytes(value.toInt())
        "DINT" -> 0x00c4 to leIntBytes(value.toInt())
        "REAL" -> 0x00ca to leIntBytes(java.lang.Float.floatToIntBits(value.toFloat()))
        else -> throw IllegalArgumentException("暂不支持写入类型 $type")
    }

    private fun decode(type: String, code: Int, b: ByteArray): Any {
        val expected = mapOf("BOOL" to 0x00c1, "SINT" to 0x00c2, "INT" to 0x00c3, "DINT" to 0x00c4, "REAL" to 0x00ca)[type.uppercase()]
            ?: throw IllegalArgumentException("暂不支持读取类型 $type")
        if (code != expected) throw IllegalStateException("标签类型不匹配: 请求 $type, PLC 类型 0x${code.toString(16)}")
        return when (type.uppercase()) {
            "BOOL" -> b.isNotEmpty() && b[0].toInt() != 0
            "SINT" -> b[0].toInt()
            "INT" -> leShort(b, 0).toShort().toInt()
            "DINT" -> leInt(b, 0)
            "REAL" -> java.lang.Float.intBitsToFloat(leInt(b, 0)).toDouble()
            else -> error("unreachable")
        }
    }

    private fun readExact(inp: BufferedInputStream, count: Int): ByteArray {
        val b = ByteArray(count); var p = 0
        while (p < count) { val n = inp.read(b, p, count - p); if (n < 0) throw IllegalStateException("PLC 关闭了连接"); p += n }
        return b
    }
    private fun leShort(b: ByteArray, p: Int) = (b[p].toInt() and 255) or ((b[p + 1].toInt() and 255) shl 8)
    private fun leInt(b: ByteArray, p: Int) = (b[p].toInt() and 255) or ((b[p+1].toInt() and 255) shl 8) or ((b[p+2].toInt() and 255) shl 16) or ((b[p+3].toInt() and 255) shl 24)
    private fun leShortBytes(n: Int) = byteArrayOf(n.toByte(), (n shr 8).toByte())
    private fun leIntBytes(n: Int) = byteArrayOf(n.toByte(), (n shr 8).toByte(), (n shr 16).toByte(), (n shr 24).toByte())
    private fun leLongBytes(n: Long) = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(n).array()
}
