"""JouleLab STM32 binary protocol, version 1.

Every packet is exactly 11 bytes, little-endian. The full specification
(with rationale) lives in docs/PROTOCOL.md; the firmware implementation is
firmware/joulelab_f446re/Core/Src/jl_protocol.c. Keep all three in sync.

    Byte 0-1  sync         0xAA 0x55
    Byte 2    type         see PacketType
    Byte 3-6  value1       uint32 (little-endian)
    Byte 7-8  value2       uint16 (little-endian)
    Byte 9    seq          8-bit sample sequence number
    Byte 10   checksum     CRC-8 (poly 0x07, init 0x00) over bytes 0-9
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from enum import IntEnum

SYNC = b"\xAA\x55"
PACKET_SIZE = 11
PROTOCOL_MAGIC = 0x4A4C0001  # "JL" + protocol version 1 (sent in HELLO.value1)
PROTOCOL_VERSION = PROTOCOL_MAGIC & 0xFFFF

# HELLO.value2 flags
FLAG_TEST_SOURCE = 0x0001  # packets come from a test generator, NOT from an INA219

_STRUCT = struct.Struct("<2sBIHB")  # sync, type, value1, value2, seq (10 bytes, CRC appended)


class PacketType(IntEnum):
    MEASUREMENT = 0x01  # value1 = current in µA (int32, two's complement), value2 = bus voltage in mV
    FUNCTION_START = 0x02  # value1 = firmware time µs, value2 = function id
    FUNCTION_END = 0x03  # value1 = firmware time µs, value2 = function id
    GPIO_EDGE = 0x04  # value1 = firmware time µs, value2 = (channel << 8) | level
    TIME_SYNC = 0x10  # value1 = firmware time µs of sample `seq`, value2 = sample period µs
    HELLO = 0x11  # value1 = PROTOCOL_MAGIC, value2 = flags
    DEVICE_STATUS = 0x7E  # value1 = detail, value2 = DeviceStatus code


class DeviceStatus(IntEnum):
    INA219_NOT_FOUND = 1  # detail = HAL I2C error code
    I2C_READ_FAILED = 2  # detail = HAL I2C error code
    TX_OVERFLOW = 3  # detail = total packets dropped by the firmware TX buffer
    INA219_MATH_OVERFLOW = 4  # detail = raw bus-voltage register
    SAMPLE_OVERRUN = 5  # detail = total samples skipped because the previous I2C read was still busy
    INA219_RECOVERED = 6  # detail = 0; sensor answered again after an error


DEVICE_STATUS_TEXT = {
    DeviceStatus.INA219_NOT_FOUND: "INA219 not responding on I2C (check wiring, address 0x40, power)",
    DeviceStatus.I2C_READ_FAILED: "I2C read from INA219 failed; sample skipped",
    DeviceStatus.TX_OVERFLOW: "Firmware UART buffer overflowed; packets were dropped on the board",
    DeviceStatus.INA219_MATH_OVERFLOW: "INA219 reported an overflow; sample marked invalid",
    DeviceStatus.SAMPLE_OVERRUN: "Sampling period too short for I2C; samples skipped on the board",
    DeviceStatus.INA219_RECOVERED: "INA219 is responding again",
}

# Scaling
CURRENT_LSB_UA = 1  # MEASUREMENT.value1 is current in microamps (signed)
VOLTAGE_LSB_MV = 1  # MEASUREMENT.value2 is bus voltage in millivolts


def crc8(data: bytes) -> int:
    """CRC-8, polynomial x^8 + x^2 + x + 1 (0x07), init 0x00, no reflection, no final XOR."""
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


@dataclass(frozen=True)
class Packet:
    type: int
    value1: int
    value2: int
    seq: int
    raw: bytes = b""

    # ---- typed views -------------------------------------------------------
    @property
    def current_ua(self) -> int:
        """MEASUREMENT: signed current in µA (value1 is int32 two's complement)."""
        v = self.value1
        return v - (1 << 32) if v & 0x80000000 else v

    @property
    def voltage_mv(self) -> int:
        return self.value2

    @property
    def function_id(self) -> int:
        return self.value2

    @property
    def gpio_channel(self) -> int:
        return self.value2 >> 8

    @property
    def gpio_level(self) -> int:
        return self.value2 & 0xFF


def encode(ptype: int, value1: int, value2: int, seq: int) -> bytes:
    """Build one 11-byte packet. value1 accepts signed ints (stored as two's complement)."""
    if not 0 <= ptype <= 0xFF:
        raise ValueError("packet type must fit in one byte")
    if not -(1 << 31) <= value1 < (1 << 32):
        raise ValueError("value1 out of 32-bit range")
    if not 0 <= value2 <= 0xFFFF:
        raise ValueError("value2 out of 16-bit range")
    body = _STRUCT.pack(SYNC, ptype, value1 & 0xFFFFFFFF, value2, seq & 0xFF)
    return body + bytes([crc8(body)])


def parse(frame: bytes) -> Packet:
    """Parse an 11-byte frame whose sync and CRC have already been checked."""
    _, ptype, v1, v2, seq = _STRUCT.unpack(frame[:10])
    return Packet(ptype, v1, v2, seq, bytes(frame))


# Convenience builders (used by tests and scripts/send_test_samples.py)
def measurement(current_ua: int, voltage_mv: int, seq: int) -> bytes:
    return encode(PacketType.MEASUREMENT, current_ua, voltage_mv, seq)


def time_sync(t_us: int, period_us: int, seq: int) -> bytes:
    return encode(PacketType.TIME_SYNC, t_us & 0xFFFFFFFF, period_us, seq)


def hello(flags: int = 0, seq: int = 0) -> bytes:
    return encode(PacketType.HELLO, PROTOCOL_MAGIC, flags, seq)


def function_start(fid: int, t_us: int, seq: int = 0) -> bytes:
    return encode(PacketType.FUNCTION_START, t_us & 0xFFFFFFFF, fid, seq)


def function_end(fid: int, t_us: int, seq: int = 0) -> bytes:
    return encode(PacketType.FUNCTION_END, t_us & 0xFFFFFFFF, fid, seq)


def gpio_edge(channel: int, level: int, t_us: int, seq: int = 0) -> bytes:
    return encode(PacketType.GPIO_EDGE, t_us & 0xFFFFFFFF, (channel << 8) | (level & 1), seq)


def device_status(code: int, detail: int = 0, seq: int = 0) -> bytes:
    return encode(PacketType.DEVICE_STATUS, detail & 0xFFFFFFFF, code, seq)
