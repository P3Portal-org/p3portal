# p3portal.org
from __future__ import annotations

from pydantic import BaseModel


class NodeInfo(BaseModel):
    name: str
    status: str  # "online" | "offline" | "unknown"


class IsoEntry(BaseModel):
    filename: str   # e.g. "debian-13.3.0-amd64-netinst.iso"
    volid: str      # e.g. "local:iso/debian-13.3.0-amd64-netinst.iso"
    size: int       # bytes


class QueryUrlRequest(BaseModel):
    url: str


class QueryUrlResponse(BaseModel):
    filename: str
    size: int | None = None
    content_type: str | None = None


class StorageInfo(BaseModel):
    name: str
    type: str


class IsoDownloadRequest(BaseModel):
    node: str | None = None  # optional – defaults to PROXMOX_NODE from config
    storage: str | None = None  # optional – Ziel-Storage (default: 'local')
    filename: str
    url: str
    checksum_algorithm: str | None = None  # None | "md5" | "sha1" | "sha224" | "sha256" | "sha384" | "sha512"
    checksum: str | None = None
    verify_certificates: bool = True
