#!/usr/bin/env python3
"""Verify or restore a Conflux backup. Restore only to a new directory while the service is stopped."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import tempfile
import uuid
import zipfile

MAX_JOURNAL = 32 * 1024 * 1024
NAME = re.compile(r"[a-f0-9]{64}\.updates")


def crc32c(data):
    table = []
    for value in range(256):
        for _ in range(8):
            value = (value >> 1) ^ (0x82F63B78 if value & 1 else 0)
        table.append(value)
    value = 0xFFFFFFFF
    for byte in data:
        value = table[(value ^ byte) & 255] ^ (value >> 8)
    return value ^ 0xFFFFFFFF


def journal_valid(data):
    offset = count = 0
    while offset < len(data):
        if offset + 4 > len(data):
            raise ValueError("Incomplete journal tail")
        marker, = struct.unpack_from(">i", data, offset)
        size = abs(marker)
        count += 1
        maximum = 8 * 1024 * 1024 if marker < 0 else 2 * 1024 * 1024 + 24
        if size < (1 if marker < 0 else 25) or size > maximum or count > 10000 or offset + size + 8 > len(data):
            raise ValueError("Invalid journal record")
        expected, = struct.unpack_from(">I", data, offset + 4 + size)
        if crc32c(memoryview(data)[offset + 4:offset + 4 + size]) != expected:
            raise ValueError("Journal checksum mismatch")
        offset += size + 8


def manifest(zip_file, max_bytes):
    names = zip_file.namelist()
    if len(names) != len(set(names)) or len(names) > 10001 or "manifest.json" not in names:
        raise ValueError("Duplicate, excessive, or missing backup entries")
    info = zip_file.getinfo("manifest.json")
    if info.file_size > 8 * 1024 * 1024:
        raise ValueError("Manifest too large")
    value = json.loads(zip_file.read(info))
    if value.get("format") != 1 or not isinstance(value.get("files"), list) or not value.get("createdAt"):
        raise ValueError("Unsupported backup manifest")
    expected = {"manifest.json"}
    total = 0
    for entry in value["files"]:
        name, size, digest = entry["name"], entry["size"], entry["sha256"]
        if not NAME.fullmatch(name) or name in expected or type(size) is not int or not 0 <= size <= MAX_JOURNAL:
            raise ValueError("Invalid backup path or size")
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid backup checksum")
        total += size
        if total > max_bytes or zip_file.getinfo(name).file_size != size:
            raise ValueError("Backup exceeds size limit or is incomplete")
        expected.add(name)
    if set(names) != expected:
        raise ValueError("Unexpected backup entries")
    return value


def payload(zip_file, entry):
    data = zip_file.read(entry["name"])
    if len(data) != entry["size"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise ValueError("Backup checksum mismatch")
    journal_valid(data)
    return data


def recover(archive, target=None, max_bytes=2 * 1024 ** 3):
    with zipfile.ZipFile(archive) as zip_file:
        value = manifest(zip_file, max_bytes)
        # Validate all files before creating any destination. The archive stays open throughout restore.
        for entry in value["files"]:
            payload(zip_file, entry)
        if target is None:
            return len(value["files"])
        target = Path(target)
        target.mkdir(mode=0o700, parents=False, exist_ok=False)
        with (target / ".lock").open("xb") as lock:
            fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            marker = target / ".restore-in-progress"
            with marker.open("xb") as output:
                output.write(b"Restore incomplete. Do not start the service.\n")
                output.flush(); os.fsync(output.fileno())
            sync_directory(target)
            for entry in value["files"]:
                with os.fdopen(os.open(target / entry["name"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
                    output.write(payload(zip_file, entry))
                    output.flush(); os.fsync(output.fileno())
            sync_directory(target)
            marker.unlink()
            sync_directory(target)
        return len(value["files"])


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def backup(data_directory, destination, max_bytes=2 * 1024 ** 3):
    data_directory, destination = Path(data_directory).resolve(), Path(destination).resolve()
    if destination == data_directory or data_directory in destination.parents:
        raise ValueError("Keep backups outside the live data directory")
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (data_directory / ".lock").open("r+b") as lock:
        fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sources = sorted(path for path in data_directory.iterdir() if NAME.fullmatch(path.name))
        if len(sources) > 10000 or any(path.is_symlink() or not path.is_file() for path in sources):
            raise ValueError("Invalid backup sources")
        if sum(path.stat().st_size for path in sources) > max_bytes:
            raise ValueError("Backup exceeds size limit")
        descriptor, temporary_name = tempfile.mkstemp(prefix=".conflux-backup-", suffix=".partial", dir=destination)
        temporary = Path(temporary_name)
        try:
            os.close(descriptor)
            entries = []
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for source in sources:
                    if source.stat().st_size > MAX_JOURNAL:
                        raise ValueError("Journal exceeds size limit")
                    content = source.read_bytes()
                    journal_valid(content)
                    entries.append({"name": source.name, "size": len(content), "sha256": hashlib.sha256(content).hexdigest()})
                    archive.writestr(source.name, content)
                archive.writestr("manifest.json", json.dumps({"format": 1, "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "files": entries}))
            with temporary.open("rb") as saved:
                os.fsync(saved.fileno())
            recover(temporary, max_bytes=max_bytes)
            completed = destination / f"conflux-{int(datetime.now().timestamp() * 1000)}-{uuid.uuid4()}.zip"
            temporary.rename(completed)
            sync_directory(destination)
            return completed
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["backup", "verify", "restore"])
    parser.add_argument("archive", type=Path)
    parser.add_argument("--target", type=Path, help="New, nonexistent directory; never overwrite the live data directory")
    parser.add_argument("--max-bytes", type=int, default=2 * 1024 ** 3)
    args = parser.parse_args()
    if args.action in ("backup", "restore") and args.target is None:
        parser.error(f"{args.action} requires --target")
    try:
        if args.action == "backup":
            print(f"Verified backup: {backup(args.archive, args.target, args.max_bytes)}")
        else:
            count = recover(args.archive, args.target if args.action == "restore" else None, args.max_bytes)
            print(f"{args.action}: {count} journals verified" + (f" in {args.target}" if args.target and args.action == "restore" else ""))
    except (OSError, ValueError, TypeError, KeyError, zipfile.BadZipFile) as failure:
        parser.exit(1, f"Recovery failed: {failure}\n")
