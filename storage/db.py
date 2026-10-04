"""SQLite storage for transmission history and recording indexes."""

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from config import config

DATA_DIR = Path("data")
DB_PATH = DATA_DIR / "bc125at.db"


SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS transmissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    frequency_mhz REAL NOT NULL,
    channel_id INTEGER NOT NULL DEFAULT 0,
    channel_name TEXT NOT NULL DEFAULT '',
    modulation TEXT NOT NULL DEFAULT '',
    duration_s REAL NOT NULL DEFAULT 0,
    squelch_open INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    is_discovery INTEGER NOT NULL DEFAULT 0,
    recording_filename TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(timestamp, frequency_mhz)
);

CREATE INDEX IF NOT EXISTS idx_transmissions_timestamp
    ON transmissions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transmissions_frequency
    ON transmissions(frequency_mhz);
CREATE INDEX IF NOT EXISTS idx_transmissions_channel
    ON transmissions(channel_id);

CREATE TABLE IF NOT EXISTS recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    frequency_mhz REAL NOT NULL DEFAULT 0,
    channel_id INTEGER NOT NULL DEFAULT 0,
    channel_name TEXT NOT NULL DEFAULT '',
    modulation TEXT NOT NULL DEFAULT '',
    duration_s REAL NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recordings_created
    ON recordings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_frequency
    ON recordings(frequency_mhz);
"""


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create the SQLite database and tables if needed."""
    with _connect() as conn:
        conn.executescript(SCHEMA)


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def _normalise_transmission(entry: dict[str, Any]) -> dict[str, Any]:
    channel = entry.get("channel", entry.get("channel_id", 0))
    name = entry.get("name", entry.get("channel_name", ""))
    duration = entry.get("duration", entry.get("duration_s", 0))

    return {
        "timestamp": str(entry.get("timestamp") or datetime.now().isoformat()),
        "frequency_mhz": float(entry.get("frequency", entry.get("frequency_mhz", 0)) or 0),
        "channel_id": int(channel or 0),
        "channel_name": str(name or ""),
        "modulation": str(entry.get("modulation") or ""),
        "duration_s": float(duration or 0),
        "squelch_open": 1 if entry.get("squelch_open") else 0,
        "skipped": 1 if entry.get("skipped") else 0,
        "is_discovery": 1 if entry.get("is_discovery") else 0,
        "recording_filename": entry.get("recording_filename"),
    }


def add_transmission(entry: dict[str, Any]) -> int | None:
    """Insert a transmission and return its row id. Duplicates are ignored."""
    item = _normalise_transmission(entry)
    if item["frequency_mhz"] <= 0 or item["duration_s"] <= 0:
        return None

    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO transmissions (
                timestamp, frequency_mhz, channel_id, channel_name, modulation,
                duration_s, squelch_open, skipped, is_discovery, recording_filename
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["timestamp"],
                item["frequency_mhz"],
                item["channel_id"],
                item["channel_name"],
                item["modulation"],
                item["duration_s"],
                item["squelch_open"],
                item["skipped"],
                item["is_discovery"],
                item["recording_filename"],
            ),
        )
        return cur.lastrowid if cur.rowcount else None


def import_transmissions(entries: list[dict[str, Any]]) -> tuple[int, int]:
    """Import a batch of browser-local history entries."""
    imported = 0
    skipped = 0
    for entry in entries:
        if add_transmission(entry) is None:
            skipped += 1
        else:
            imported += 1
    return imported, skipped


def list_transmissions(limit: int = 500, offset: int = 0) -> list[dict[str, Any]]:
    limit = max(1, min(5000, int(limit)))
    offset = max(0, int(offset))
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                id,
                timestamp,
                frequency_mhz AS frequency,
                channel_id AS channel,
                channel_name AS name,
                modulation,
                duration_s AS duration,
                squelch_open,
                skipped,
                is_discovery,
                recording_filename
            FROM transmissions
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def clear_transmissions() -> int:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM transmissions")
        return cur.rowcount


def mark_last_transmission_skipped(frequency_mhz: float | None = None) -> bool:
    """Mark the most recent matching transmission skipped."""
    params: list[Any] = []
    where = ""
    if frequency_mhz and frequency_mhz > 0:
        where = "WHERE ABS(frequency_mhz - ?) <= 0.005"
        params.append(float(frequency_mhz))

    with _connect() as conn:
        cur = conn.execute(
            f"""
            UPDATE transmissions
            SET skipped = 1
            WHERE id = (
                SELECT id FROM transmissions
                {where}
                ORDER BY timestamp DESC
                LIMIT 1
            )
            """,
            params,
        )
        return cur.rowcount > 0


def history_stats() -> dict[str, Any]:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN skipped = 0 THEN 1 ELSE 0 END) AS heard,
                SUM(CASE WHEN skipped = 1 THEN 1 ELSE 0 END) AS skipped,
                AVG(duration_s) AS avg_duration_s,
                MIN(timestamp) AS first_seen,
                MAX(timestamp) AS last_seen
            FROM transmissions
            """
        ).fetchone()
        busiest = conn.execute(
            """
            SELECT
                frequency_mhz AS frequency,
                channel_name AS name,
                channel_id AS channel,
                COUNT(*) AS count,
                SUM(duration_s) AS total_duration_s
            FROM transmissions
            GROUP BY frequency_mhz
            ORDER BY count DESC, total_duration_s DESC
            LIMIT 8
            """
        ).fetchall()
    data = _row_to_dict(row)
    data["total"] = data.get("total") or 0
    data["heard"] = data.get("heard") or 0
    data["skipped"] = data.get("skipped") or 0
    data["avg_duration_s"] = data.get("avg_duration_s") or 0
    data["busiest"] = [_row_to_dict(r) for r in busiest]
    return data


def _load_sidecar(path: Path) -> dict[str, Any]:
    sidecar = path.with_suffix(".json")
    if not sidecar.exists():
        return {}
    try:
        return json.loads(sidecar.read_text())
    except Exception:
        return {}


def index_recordings() -> list[dict[str, Any]]:
    """Scan the recordings directory and upsert WAV metadata into SQLite."""
    rec_dir = Path(config.RECORDINGS_DIR)
    rec_dir.mkdir(parents=True, exist_ok=True)
    seen = []

    with _connect() as conn:
        for wav in sorted(rec_dir.glob("*.wav"), reverse=True):
            stat = wav.stat()
            meta = _load_sidecar(wav)
            created_dt = datetime.fromtimestamp(stat.st_mtime)
            created = created_dt.strftime("%Y-%m-%d %H:%M:%S")
            modified = datetime.fromtimestamp(stat.st_mtime).isoformat()
            metadata_json = json.dumps(meta) if meta else "{}"
            filename = wav.name
            seen.append(filename)

            conn.execute(
                """
                INSERT INTO recordings (
                    filename, url, size_bytes, created_at, modified_at,
                    frequency_mhz, channel_id, channel_name, modulation,
                    duration_s, metadata_json, indexed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(filename) DO UPDATE SET
                    url = excluded.url,
                    size_bytes = excluded.size_bytes,
                    created_at = excluded.created_at,
                    modified_at = excluded.modified_at,
                    frequency_mhz = excluded.frequency_mhz,
                    channel_id = excluded.channel_id,
                    channel_name = excluded.channel_name,
                    modulation = excluded.modulation,
                    duration_s = excluded.duration_s,
                    metadata_json = excluded.metadata_json,
                    indexed_at = CURRENT_TIMESTAMP
                """,
                (
                    filename,
                    f"/recordings/{filename}",
                    stat.st_size,
                    created,
                    modified,
                    float(meta.get("frequency_mhz", 0) or 0),
                    int(meta.get("channel_id", 0) or 0),
                    str(meta.get("channel_name", "") or ""),
                    str(meta.get("modulation", "") or ""),
                    float(meta.get("duration_s", 0) or 0),
                    metadata_json,
                ),
            )

        if seen:
            placeholders = ",".join("?" for _ in seen)
            conn.execute(
                f"DELETE FROM recordings WHERE filename NOT IN ({placeholders})",
                seen,
            )
        else:
            conn.execute("DELETE FROM recordings")

    return list_recordings_index()


def list_recordings_index() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                filename,
                ROUND(size_bytes / 1024.0, 1) AS size_kb,
                created_at AS created,
                url,
                CASE WHEN metadata_json != '{}' THEN 1 ELSE 0 END AS has_meta,
                frequency_mhz,
                channel_name,
                modulation,
                duration_s
            FROM recordings
            ORDER BY created_at DESC
            """
        ).fetchall()
    return [_row_to_dict(r) for r in rows]
