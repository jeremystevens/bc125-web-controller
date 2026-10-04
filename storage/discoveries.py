"""
Discovery Inbox — unknown frequencies found in Search mode.

A discovery is a frequency the scanner stopped on while searching:
no channel number and no channel name in transmission history. (Rows
logged before 0.9.0 have channel_id 0 even on programmed channels — GLG
was mis-parsed — so the empty name is what separates them.) Hits are
grouped by frequency
and compared against the cached channel list: a frequency that is already
programmed counts as "added", not as a new discovery.

Effective status per frequency:
    new      — no decision yet (no discovery_status row, not programmed)
    watch    — pinned; the browser notifies when it is heard again
    ignored  — hidden from the inbox
    blocked  — added to the Smart Resume blocklist
    added    — programmed into a channel (by the inbox or found in the cache)
"""

from typing import Any

from .db import _connect, utc_now_iso

STATUSES = ("new", "watch", "ignored", "blocked", "added")
SETTABLE_STATUSES = ("new", "watch", "ignored", "blocked")   # "added" only via programming
MATCH_MHZ = 0.005          # ±5 kHz — BC125AT minimum step
TOTAL_CHANNELS = 500


def _freq_key(frequency_mhz: float) -> float:
    return round(float(frequency_mhz), 4)


# ---------------------------------------------------------------------------
# Channel cache
# ---------------------------------------------------------------------------

def cache_channels(channels: list[dict[str, Any]]) -> None:
    """Store channel dicts as returned by the scanner layer (or a subset of their keys)."""
    now = utc_now_iso()
    rows = []
    for ch in channels:
        try:
            num = int(ch.get("channel", 0))
        except (TypeError, ValueError):
            continue
        if not 1 <= num <= TOTAL_CHANNELS:
            continue
        rows.append((
            num,
            str(ch.get("name", "") or ""),
            float(ch.get("frequency_mhz", 0) or 0),
            str(ch.get("modulation", "") or ""),
            now,
        ))
    if not rows:
        return
    with _connect() as conn:
        conn.executemany(
            """
            INSERT INTO channel_cache (channel, name, frequency_mhz, modulation, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(channel) DO UPDATE SET
                name = excluded.name,
                frequency_mhz = excluded.frequency_mhz,
                modulation = excluded.modulation,
                updated_at = excluded.updated_at
            """,
            rows,
        )


def invalidate_channels(channel_numbers: list[int]) -> None:
    """Forget cached channels whose scanner contents are no longer known (e.g. after an import)."""
    nums = [int(n) for n in channel_numbers if isinstance(n, int) or str(n).isdigit()]
    if not nums:
        return
    with _connect() as conn:
        conn.executemany("DELETE FROM channel_cache WHERE channel = ?", [(n,) for n in nums])


def _load_cache(conn) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT channel, name, frequency_mhz, modulation, updated_at FROM channel_cache ORDER BY channel"
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Inbox
# ---------------------------------------------------------------------------

def list_discoveries() -> dict[str, Any]:
    """Grouped search hits with status, programmed match, sample recording and empty slots."""
    with _connect() as conn:
        groups = conn.execute(
            """
            SELECT
                t.frequency_mhz                      AS frequency,
                COUNT(*)                             AS hits,
                MIN(t.timestamp)                     AS first_heard,
                MAX(t.timestamp)                     AS last_heard,
                ROUND(SUM(t.duration_s), 1)          AS total_duration_s,
                MAX(t.duration_s)                    AS longest_s,
                (SELECT t2.modulation FROM transmissions t2
                  WHERE t2.channel_id = 0 AND t2.channel_name = ''
                    AND t2.frequency_mhz = t.frequency_mhz
                  ORDER BY t2.timestamp DESC LIMIT 1) AS modulation,
                s.status                             AS status,
                s.channel                            AS status_channel,
                s.updated_at                         AS status_updated_at,
                SUM(CASE WHEN s.updated_at IS NOT NULL AND t.timestamp > s.updated_at
                         THEN 1 ELSE 0 END)          AS hits_since_status
            FROM transmissions t
            LEFT JOIN discovery_status s ON s.frequency_mhz = t.frequency_mhz
            WHERE t.channel_id = 0 AND t.channel_name = ''
              AND t.frequency_mhz BETWEEN 25 AND 512   -- BC125AT range; drops garbage reads
            GROUP BY t.frequency_mhz
            """
        ).fetchall()
        cache = _load_cache(conn)
        recordings = conn.execute(
            """
            SELECT url, frequency_mhz, created_at, duration_s
            FROM recordings
            WHERE frequency_mhz > 0
            ORDER BY created_at DESC
            """
        ).fetchall()

    programmed = [c for c in cache if c["frequency_mhz"] > 0]
    items = []
    for g in groups:
        item = dict(g)
        freq = item["frequency"]

        match = next(
            (c for c in programmed if abs(c["frequency_mhz"] - freq) <= MATCH_MHZ), None
        )
        item["programmed_channel"] = match["channel"] if match else None
        item["programmed_name"] = match["name"] if match else ""

        status = item.pop("status")
        if status:
            item["status"] = status
        elif match:
            item["status"] = "added"
        else:
            item["status"] = "new"
        if item["status"] == "added" and not item["programmed_channel"]:
            item["programmed_channel"] = item.get("status_channel")
        item.pop("status_channel", None)

        rec = next((r for r in recordings if abs(r["frequency_mhz"] - freq) <= MATCH_MHZ), None)
        item["recording_url"] = rec["url"] if rec else None
        items.append(item)

    # Watched first, then most recently heard
    items.sort(key=lambda i: i["last_heard"] or "", reverse=True)
    items.sort(key=lambda i: i["status"] != "watch")

    counts = {s: 0 for s in STATUSES}
    for item in items:
        counts[item["status"]] += 1

    cached = len(cache)
    return {
        "items": items,
        "counts": counts,
        "channel_cache": {
            "cached": cached,
            "complete": cached >= TOTAL_CHANNELS,
            "updated_at": max((c["updated_at"] for c in cache), default=None),
        },
        "empty_slots": [c["channel"] for c in cache if c["frequency_mhz"] <= 0],
    }


def set_status(frequency_mhz: float, status: str, channel: int | None = None) -> None:
    """Record a decision for a frequency. 'new' clears any decision."""
    if status not in STATUSES:
        raise ValueError(f"Unknown discovery status: {status}")
    key = _freq_key(frequency_mhz)
    with _connect() as conn:
        if status == "new":
            conn.execute("DELETE FROM discovery_status WHERE frequency_mhz = ?", (key,))
            return
        conn.execute(
            """
            INSERT INTO discovery_status (frequency_mhz, status, channel, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(frequency_mhz) DO UPDATE SET
                status = excluded.status,
                channel = excluded.channel,
                updated_at = excluded.updated_at
            """,
            (key, status, channel, utc_now_iso()),
        )
