"""
recorder/recorder.py - Audio recording manager for the BC125AT controller.

Records from the system default audio input (microphone / line-in).
Supports manual start/stop with a configurable tail — the recorder
keeps capturing for TAIL_SECONDS after stop() is called, so the end
of a transmission is never clipped.

Files are saved as WAV to the configured RECORDINGS_DIR with filenames
in the format:  YYYYMMDD_HHMMSS_<channel>_<freq>.wav

Dependencies: sounddevice, soundfile (see requirements.txt)

Usage:
    rec = Recorder()
    rec.start(channel_id=1, frequency_mhz=483.4125)
    # ... transmission ...
    rec.stop()                    # tail runs then file is saved
    listings = rec.list_recordings()
    rec.delete_recording("20260101_120000_ch1_483412.wav")
"""

import logging
import os
import queue
import threading
import time
from datetime import datetime
from pathlib import Path

from config import config

logger = logging.getLogger(__name__)

# Tail: seconds to keep recording after stop() is called
TAIL_SECONDS = 3.0

# Audio settings
SAMPLE_RATE = 44100  # Hz
CHANNELS = 1  # mono — scanner audio is mono
DTYPE = "int16"  # 16-bit PCM


class Recorder:
    """
    Manual audio recorder with tail support.

    Thread-safe: start() and stop() can be called from any thread
    (Flask request handler, SocketIO event, etc.).
    """

    def __init__(self) -> None:
        self._recordings_dir = Path(config.RECORDINGS_DIR)
        self._recordings_dir.mkdir(parents=True, exist_ok=True)

        self._recording = False
        self._tail_active = False
        self._lock = threading.Lock()
        self._audio_queue: queue.Queue = queue.Queue()
        self._record_thread: threading.Thread | None = None
        self._current_file: str | None = None
        self._start_time: float | None = None

        # Metadata for the current recording
        self._current_channel: int = 0
        self._current_freq: float = 0.0

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    @property
    def is_recording(self) -> bool:
        """True while actively recording (including tail period)."""
        return self._recording or self._tail_active

    @property
    def current_file(self) -> str | None:
        """Filename of the recording in progress, or None."""
        return self._current_file

    @property
    def elapsed_seconds(self) -> float:
        """Seconds elapsed since recording started, or 0."""
        if self._start_time is None:
            return 0.0
        return round(time.monotonic() - self._start_time, 1)

    def start(
        self,
        channel_id: int = 0,
        frequency_mhz: float = 0.0,
        name: str = "",
    ) -> dict:
        """
        Start recording from the default audio input.

        Args:
            channel_id:    Current scanner channel (used in filename).
            frequency_mhz: Current frequency in MHz (used in filename).
            name:          Optional base filename override (without extension).
                           If provided, used as the WAV filename directly.

        Returns dict with success status and filename.
        """
        with self._lock:
            if self.is_recording:
                return {
                    "success": False,
                    "message": "Already recording.",
                    "file": self._current_file,
                }

        # Build filename — use provided name or generate default
        if name:
            filename = name if name.endswith(".wav") else name + ".wav"
        else:
            now = datetime.now().strftime("%Y%m%d_%H%M%S")
            freq_tag = (
                str(int(frequency_mhz * 1000)).zfill(7) if frequency_mhz else "000000"
            )
            ch_tag = f"ch{channel_id}" if channel_id else "ch0"
            filename = f"{now}_{ch_tag}_{freq_tag}.wav"
        filepath = self._recordings_dir / filename

        self._current_file = filename
        self._current_channel = channel_id
        self._current_freq = frequency_mhz
        self._start_time = time.monotonic()

        # Clear queue from any previous run
        while not self._audio_queue.empty():
            try:
                self._audio_queue.get_nowait()
            except queue.Empty:
                break

        # Start recording thread
        self._recording = True
        self._record_thread = threading.Thread(
            target=self._record_loop,
            args=(filepath,),
            name="recorder",
            daemon=True,
        )
        self._record_thread.start()

        logger.info("Recording started → %s", filename)
        return {"success": True, "message": "Recording started.", "file": filename}

    def stop(self) -> dict:
        """
        Stop recording. The tail (TAIL_SECONDS) runs before the file is saved.

        Returns dict with success status and filename.
        """
        with self._lock:
            if not self.is_recording:
                return {"success": False, "message": "Not currently recording."}
            if self._tail_active:
                return {
                    "success": True,
                    "message": f"Tail in progress ({TAIL_SECONDS}s).",
                    "file": self._current_file,
                }

        logger.info("Recording stop requested — tail: %.1fs", TAIL_SECONDS)
        self._recording = False
        self._tail_active = True
        filename = self._current_file
        return {
            "success": True,
            "message": f"Stopping — recording tail for {TAIL_SECONDS}s.",
            "file": filename,
        }

    def status(self) -> dict:
        """Return current recorder state."""
        return {
            "recording": self.is_recording,
            "tail_active": self._tail_active,
            "elapsed_seconds": self.elapsed_seconds,
            "current_file": self._current_file,
            "tail_seconds": TAIL_SECONDS,
        }

    def list_recordings(self) -> list[dict]:
        """
        Return a list of all recordings in the recordings directory,
        sorted newest first.
        """
        files = []
        for path in sorted(self._recordings_dir.glob("*.wav"), reverse=True):
            stat = path.stat()
            files.append(
                {
                    "filename": path.name,
                    "size_kb": round(stat.st_size / 1024, 1),
                    "created": datetime.fromtimestamp(stat.st_mtime).strftime(
                        "%Y-%m-%d %H:%M:%S"
                    ),
                    "url": f"/recordings/{path.name}",
                }
            )
        return files

    def delete_recording(self, filename: str) -> dict:
        """
        Delete a recording by filename.
        Validates that the file is inside the recordings directory.
        """
        # Security: ensure we only delete files inside recordings dir
        target = (self._recordings_dir / Path(filename).name).resolve()
        if not str(target).startswith(str(self._recordings_dir.resolve())):
            logger.warning("Attempted path traversal: %s", filename)
            return {"success": False, "message": "Invalid filename."}

        if not target.exists():
            return {"success": False, "message": f"File not found: {filename}"}

        # Cannot delete the file currently being recorded
        if filename == self._current_file and self.is_recording:
            return {
                "success": False,
                "message": "Cannot delete a recording in progress.",
            }

        target.unlink()
        logger.info("Deleted recording: %s", filename)
        return {"success": True, "message": f"Deleted {filename}."}

    # ------------------------------------------------------------------
    # Recording thread
    # ------------------------------------------------------------------

    def _record_loop(self, filepath: Path) -> None:
        """
        Background thread: captures audio from default input, writes WAV.
        Runs until self._recording is False AND tail has expired.
        """
        try:
            import sounddevice as sd
            import soundfile as sf
        except ImportError:
            logger.error(
                "sounddevice or soundfile not installed. "
                "Run: pip install sounddevice soundfile"
            )
            self._recording = False
            self._tail_active = False
            self._current_file = None
            return

        def audio_callback(indata, frames, time_info, status):
            if status:
                logger.warning("Audio callback status: %s", status)
            self._audio_queue.put(indata.copy())

        try:
            with sf.SoundFile(
                filepath,
                mode="w",
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                subtype="PCM_16",
            ) as wav_file:

                with sd.InputStream(
                    samplerate=SAMPLE_RATE,
                    channels=CHANNELS,
                    dtype=DTYPE,
                    callback=audio_callback,
                ):
                    logger.info("Audio stream open → %s", filepath.name)

                    tail_start = None

                    while True:
                        # Drain audio queue into WAV
                        try:
                            chunk = self._audio_queue.get(timeout=0.1)
                            wav_file.write(chunk)
                        except queue.Empty:
                            pass

                        # Check if we're in tail mode
                        if not self._recording and self._tail_active:
                            if tail_start is None:
                                tail_start = time.monotonic()
                                logger.debug("Tail started.")
                            elif time.monotonic() - tail_start >= TAIL_SECONDS:
                                logger.debug("Tail complete.")
                                break

                        # Not recording and not in tail — done
                        if not self._recording and not self._tail_active:
                            break

                    # Drain any remaining queued audio
                    while not self._audio_queue.empty():
                        try:
                            wav_file.write(self._audio_queue.get_nowait())
                        except queue.Empty:
                            break

            logger.info(
                "Recording saved: %s (%.1f s)",
                filepath.name,
                self.elapsed_seconds,
            )

        except Exception as exc:
            logger.error("Recording error: %s", exc)
            if filepath.exists():
                filepath.unlink()

        finally:
            self._recording = False
            self._tail_active = False
            self._start_time = None
            # Keep _current_file set so the UI can show the last saved name
