"""Serve BRIDGE over HTTPS on your local network so phones can use the microphone.

Phone browsers only allow microphone access on secure (https) pages. This
script creates a self-signed certificate for this computer's LAN address and
runs the API + exported web app on https://<lan-ip>:8443.

Your phone will warn that the certificate isn't trusted (it's self-signed):
tap "Advanced" → "Proceed" once. For real deployments use a proper domain
with HTTPS from your host (see docs/deployment.md).

Usage (from services/api, after `npm run build` in apps/web):
    python scripts/dev_https.py
"""

from __future__ import annotations

import datetime as dt
import ipaddress
import os
import socket
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parents[1]
CERT_DIR = ROOT / ".certs"
PORT = int(os.environ.get("HTTPS_PORT", "8443"))


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packets are sent
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def make_cert(ip: str) -> tuple[Path, Path]:
    CERT_DIR.mkdir(exist_ok=True)
    key_path, cert_path = CERT_DIR / "dev-key.pem", CERT_DIR / "dev-cert.pem"
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "BRIDGE local dev")])
    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=30))
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1")), x509.IPAddress(ipaddress.ip_address(ip))]
            ),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption())
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return key_path, cert_path


def main() -> None:
    ip = lan_ip()
    key, cert = make_cert(ip)
    web_out = ROOT.parent.parent / "apps" / "web" / "out"
    if not web_out.is_dir():
        sys.exit("Build the web app first:  cd apps/web && npm run build")
    os.environ.setdefault("STATIC_DIR", str(web_out))
    os.environ.setdefault("CORS_ORIGINS", f"https://{ip}:{PORT},https://localhost:{PORT}")
    print(f"\n  BRIDGE is running at  https://{ip}:{PORT}\n  Open it on phones connected to the same Wi-Fi.\n")
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, ssl_keyfile=str(key), ssl_certfile=str(cert))


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    os.chdir(ROOT)
    main()
