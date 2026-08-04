"""
api/stream.py — Audio streaming endpoint for BC125AT controller.

Streams raw PCM audio from the system default input (line-in / mic)
as a continuous chunked HTTP response in WAV-compatible format.

The browser treats it like an internet radio stream via <audio src="/stream/audio">.

Format: 44100 Hz, 16-bit, mono PCM with a WAV header prepended so the
browser knows how to decode it. The stream never ends until the client
disconnects.

Uses a generator that yields audio chunks. Only one sounddevice stream
is opened regardless of how many clients connect — all clients share the
same captured audio via a broadcast queue list.
"""

import logging
import queue
import struct
import threading
from typing import Generator

logger = logging.getLogger(__name__)

SAMPLE_RATE = 44100
CHANNELS = 1
DTYPE = "int16"
CHUNK_FRAMES = 4096  # ~93ms per chunk at 44100 Hz

# Global shared state — one input stream, multiple subscriber queues
_lock = threading.Lock()
_stream = None  # sounddevice InputStream
_subscribers: list[queue.Queue] = []
_stream_lock = threading.Lock()


def _wav_header(
    sample_rate: int = SAMPLE_RATE, channels: int = CHANNELS, bits: int = 16
) -> bytes:
    """
    Build a WAV header for a streaming (unknown-length) file.
    Uses 0xFFFFFFFF for the data chunk size — browsers ignore it and
    just play until the stream ends.
    """
    data_size = 0xFFFFFFFF
    chunk_size = 0xFFFFFFFF  # also max — avoids overflow
    byte_rate = sample_rate * channels * (bits // 8)
    block_align = channels * (bits // 8)

    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        chunk_size,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM format
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits,
        b"data",
        data_size,
    )


def _audio_callback(indata, frames, time_info, status):
    """Called by sounddevice on each captured chunk — broadcasts to all subscribers."""
    if status:
        logger.debug("Audio stream status: %s", status)
    raw = indata.tobytes()
    with _lock:
        dead = []
        for q in _subscribers:
            try:
                q.put_nowait(raw)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _subscribers.remove(q)


def _ensure_stream_running() -> bool:
    """Start the shared sounddevice input stream if not already running."""
    global _stream
    with _stream_lock:
        if _stream is not None and _stream.active:
            return True
        try:
            import sounddevice as sd

            _stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                dtype=DTYPE,
                blocksize=CHUNK_FRAMES,
                callback=_audio_callback,
            )
            _stream.start()
            logger.info("Audio stream started — %d Hz mono", SAMPLE_RATE)
            return True
        except Exception as e:
            logger.error("Could not open audio input: %s", e)
            _stream = None
            return False


def _stop_stream_if_idle():
    """Stop the shared stream when no subscribers remain."""
    global _stream
    with _stream_lock:
        with _lock:
            if _subscribers:
                return
        if _stream is not None:
            try:
                _stream.stop()
                _stream.close()
            except Exception:
                pass
            _stream = None
            logger.info("Audio stream stopped — no subscribers.")


def audio_stream_generator() -> Generator[bytes, None, None]:
    """
    Generator yielded to Flask's streaming response.
    Subscribes to the shared audio capture, yields WAV header then
    raw PCM chunks until the client disconnects.
    """
    if not _ensure_stream_running():
        return

    q: queue.Queue = queue.Queue(maxsize=20)
    with _lock:
        _subscribers.append(q)

    try:
        yield _wav_header()
        while True:
            try:
                chunk = q.get(timeout=2.0)
                yield chunk
            except queue.Empty:
                # Heartbeat — keep connection alive
                yield b""
    except GeneratorExit:
        pass
    finally:
        with _lock:
            if q in _subscribers:
                _subscribers.remove(q)
        # Stop shared stream if nobody is listening
        threading.Timer(1.0, _stop_stream_if_idle).start()
        logger.info("Audio stream client disconnected.")
