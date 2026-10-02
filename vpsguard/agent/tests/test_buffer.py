"""Tests for the SQLite offline buffer."""

from __future__ import annotations

import json
import threading
import time

import pytest

from vpsguard_agent.buffer import PayloadBuffer


@pytest.fixture()
def payload_buffer(tmp_path):
    buffer = PayloadBuffer(str(tmp_path / "buffer.db"), max_rows=5, retention_hours=1)
    yield buffer
    buffer.close()


def test_enqueue_and_fetch_preserves_order(payload_buffer):
    for index in range(3):
        payload_buffer.enqueue(json.dumps({"n": index}))

    batch = payload_buffer.fetch_batch(10)

    assert [json.loads(body)["n"] for _row_id, body in batch] == [0, 1, 2]
    assert payload_buffer.count() == 3


def test_fetch_batch_respects_the_limit(payload_buffer):
    for index in range(5):
        payload_buffer.enqueue(str(index))

    assert len(payload_buffer.fetch_batch(2)) == 2


def test_delete_removes_only_the_given_rows(payload_buffer):
    ids = [payload_buffer.enqueue(str(index)) for index in range(4)]

    removed = payload_buffer.delete(ids[:2])

    assert removed == 2
    assert payload_buffer.count() == 2
    assert [body for _row_id, body in payload_buffer.fetch_batch(10)] == ["2", "3"]


def test_delete_with_no_ids_is_a_noop(payload_buffer):
    payload_buffer.enqueue("x")

    assert payload_buffer.delete([]) == 0
    assert payload_buffer.count() == 1


def test_flush_cycle_drains_the_buffer(payload_buffer):
    """Simulate the scheduler: fetch a batch, deliver it, delete it."""
    for index in range(4):
        payload_buffer.enqueue(str(index))

    delivered = []
    while True:
        batch = payload_buffer.fetch_batch(2)
        if not batch:
            break
        delivered.extend(body for _row_id, body in batch)
        payload_buffer.delete([row_id for row_id, _body in batch])

    assert delivered == ["0", "1", "2", "3"]
    assert payload_buffer.count() == 0


def test_eviction_drops_the_oldest_rows(payload_buffer):
    for index in range(8):
        payload_buffer.enqueue(str(index))

    assert payload_buffer.count() == 5
    assert [body for _row_id, body in payload_buffer.fetch_batch(10)] == [
        "3",
        "4",
        "5",
        "6",
        "7",
    ]


def test_enforce_limit_trims_after_a_size_change(tmp_path):
    buffer = PayloadBuffer(str(tmp_path / "buffer.db"), max_rows=100, retention_hours=1)
    for index in range(10):
        buffer.enqueue(str(index))

    buffer.max_rows = 4
    dropped = buffer.enforce_limit()

    assert dropped == 6
    assert buffer.count() == 4
    buffer.close()


def test_retention_purges_old_rows(payload_buffer):
    now = int(time.time())
    payload_buffer.enqueue("old", created_at=now - 7200)
    payload_buffer.enqueue("also-old", created_at=now - 3601)
    payload_buffer.enqueue("fresh", created_at=now)

    removed = payload_buffer.purge_expired(now=now)

    assert removed == 2
    assert [body for _row_id, body in payload_buffer.fetch_batch(10)] == ["fresh"]


def test_maintain_purges_expired_rows(tmp_path):
    # max_rows is generous so enqueue-time eviction cannot remove the aged rows
    # before maintain() gets to apply the retention window.
    buffer = PayloadBuffer(str(tmp_path / "buffer.db"), max_rows=10, retention_hours=1)
    now = int(time.time())
    buffer.enqueue("expired-1", created_at=now - 7200)
    buffer.enqueue("expired-2", created_at=now - 3601)
    buffer.enqueue("fresh-1", created_at=now)
    buffer.enqueue("fresh-2", created_at=now)

    expired, evicted = buffer.maintain(now=now)

    assert expired == 2
    # Nothing left to evict: the buffer was already within max_rows.
    assert evicted == 0
    assert [body for _row_id, body in buffer.fetch_batch(10)] == ["fresh-1", "fresh-2"]
    buffer.close()


def test_enqueue_evicts_oldest_beyond_max_rows(tmp_path):
    buffer = PayloadBuffer(str(tmp_path / "buffer.db"), max_rows=2, retention_hours=24)
    now = int(time.time())
    for index in range(5):
        buffer.enqueue(f"payload-{index}", created_at=now)

    # Eviction happens eagerly on insert, so only the newest max_rows survive.
    assert buffer.count() == 2
    assert [body for _row_id, body in buffer.fetch_batch(10)] == ["payload-3", "payload-4"]
    assert buffer.maintain(now=now) == (0, 0)
    buffer.close()


def test_oldest_created_at_and_clear(payload_buffer):
    now = int(time.time())
    payload_buffer.enqueue("a", created_at=now - 100)
    payload_buffer.enqueue("b", created_at=now)

    assert payload_buffer.oldest_created_at() == now - 100
    assert payload_buffer.clear() == 2
    assert payload_buffer.count() == 0
    assert payload_buffer.oldest_created_at() is None


def test_buffer_survives_reopening(tmp_path):
    path = str(tmp_path / "buffer.db")
    first = PayloadBuffer(path, max_rows=10, retention_hours=24)
    first.enqueue("persisted")
    first.close()

    second = PayloadBuffer(path, max_rows=10, retention_hours=24)
    try:
        assert [body for _row_id, body in second.fetch_batch(10)] == ["persisted"]
    finally:
        second.close()


def test_context_manager_closes_the_connection(tmp_path):
    with PayloadBuffer(str(tmp_path / "buffer.db")) as buffer:
        buffer.enqueue("x")
    # Reconnects transparently instead of raising on a closed connection.
    assert buffer.count() == 1
    buffer.close()


def test_concurrent_writers_do_not_corrupt_the_buffer(tmp_path):
    buffer = PayloadBuffer(str(tmp_path / "buffer.db"), max_rows=1000, retention_hours=24)

    def worker(worker_id: int) -> None:
        for index in range(20):
            buffer.enqueue(f"{worker_id}-{index}")

    threads = [threading.Thread(target=worker, args=(worker_id,)) for worker_id in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert buffer.count() == 80
    buffer.close()


def test_parent_directory_is_created(tmp_path):
    path = tmp_path / "nested" / "dir" / "buffer.db"
    buffer = PayloadBuffer(str(path))
    try:
        assert path.parent.is_dir()
    finally:
        buffer.close()
