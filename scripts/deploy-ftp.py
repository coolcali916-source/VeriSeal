#!/usr/bin/env python3
"""Deploy VeriSeal production build (dist/) + PHP backend (php-host/) to shared FTP hosting."""

import ftplib
import os
import posixpath
import sys
from pathlib import Path


def ensure_remote_dir(ftp: ftplib.FTP, remote_dir: str) -> None:
  parts = [p for p in remote_dir.split("/") if p]
  cur = ""
  for part in parts:
    cur = f"{cur}/{part}" if cur else f"/{part}"
    try:
      ftp.mkd(cur)
    except ftplib.error_perm:
      pass


def upload_file(ftp: ftplib.FTP, local_path: Path, remote_path: str) -> None:
  ensure_remote_dir(ftp, posixpath.dirname(remote_path))
  with local_path.open("rb") as fh:
    ftp.storbinary(f"STOR {remote_path}", fh)


def upload_tree(ftp: ftplib.FTP, local_dir: Path, remote_base: str) -> int:
  count = 0
  for item in sorted(local_dir.rglob("*")):
    if not item.is_file():
      continue
    rel = item.relative_to(local_dir).as_posix()
    if rel == "api/config.php":
      continue
    remote_path = posixpath.join(remote_base, rel)
    upload_file(ftp, item, remote_path)
    print(f"Uploaded: {remote_path} ({item.stat().st_size} bytes)")
    count += 1
  return count


def main() -> int:
  host = os.environ.get("FTP_HOST", "").strip()
  port = int(os.environ.get("FTP_PORT", "21") or "21")
  user = os.environ.get("FTP_USER", "").strip()
  password = os.environ.get("FTP_PASS", "").strip()
  target_dir = "/" + os.environ.get("FTP_TARGET_DIR", "htdocs").strip("/")

  if not host or not user or not password:
    print(
      "Missing FTP_HOST, FTP_USER, or FTP_PASS environment variables.",
      file=sys.stderr,
    )
    return 1

  root = Path.cwd()
  dist_dir = root / "dist"
  php_dir = root / "php-host"

  if not dist_dir.is_dir() or not (dist_dir / "index.html").is_file():
    print("dist/index.html missing. Run `npm run build` first.", file=sys.stderr)
    return 1
  if not php_dir.is_dir():
    print("php-host/ directory missing.", file=sys.stderr)
    return 1

  print(f"Connecting to FTP {host}:{port} as {user} -> {target_dir} ...")
  ftp = ftplib.FTP()
  ftp.connect(host, port, timeout=30)
  ftp.login(user, password)
  ftp.set_pasv(True)

  try:
    ensure_remote_dir(ftp, target_dir)
    ensure_remote_dir(ftp, posixpath.join(target_dir, "api/.veriseal-data/files"))

    uploaded = 0
    uploaded += upload_tree(ftp, dist_dir, target_dir)
    uploaded += upload_tree(ftp, php_dir, target_dir)

    # Remove default hosting placeholder if present so VeriSeal index.html is authoritative
    try:
      items = ftp.nlst(target_dir)
      basenames = {posixpath.basename(x) for x in items}
      if "index2.html" in basenames:
        ftp.delete(posixpath.join(target_dir, "index2.html"))
        print(f"Removed default placeholder {target_dir}/index2.html")
    except Exception:
      pass

    print(f"FTP deployment complete. Total files uploaded: {uploaded}")
  finally:
    try:
      ftp.quit()
    except Exception:
      ftp.close()

  return 0


if __name__ == "__main__":
  raise SystemExit(main())
