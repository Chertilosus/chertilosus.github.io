#!/usr/bin/env python3
"""Sniper AR — FastAPI + HTTPS (self-signed)"""

import datetime, ipaddress, json, socket, sys
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def make_cert(ip: str):
    certs = Path(__file__).parent / "certs"
    certs.mkdir(exist_ok=True)
    kf, cf = certs / "key.pem", certs / "cert.pem"

    # Не перевыпускать если уже есть
    if kf.exists() and cf.exists():
        return str(kf), str(cf)

    key = rsa.generate_private_key(65537, 2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, ip)])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName([
            x509.IPAddress(ipaddress.ip_address(ip)),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
            x509.DNSName("localhost"),
        ]), critical=False)
        .sign(key, hashes.SHA256())
    )
    kf.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ))
    cf.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return str(kf), str(cf)


LOCAL_IP = get_local_ip()
KEY_PATH, CERT_PATH = make_cert(LOCAL_IP)

app = FastAPI()
display_ws: Optional[WebSocket] = None


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    global display_ws
    await ws.accept()
    role: Optional[str] = None
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            mtype = msg.get("type")
            if mtype == "register":
                role = msg.get("role")
                if role == "display":
                    display_ws = ws
                    print("[+] Display connected")
                elif role == "controller":
                    print("[+] Controller connected")
            elif mtype in ("orientation", "log", "gamestate"):
                if display_ws:
                    try:
                        await display_ws.send_text(raw)
                    except Exception:
                        display_ws = None
                if mtype == "log":
                    tag = {"error": "!!!", "warn": ">>>", "info": "   "}.get(msg.get("level", "info"), "   ")
                    print(f'[PHONE {tag}] {msg.get("msg", "")}')
    except WebSocketDisconnect:
        if ws is display_ws:
            display_ws = None
            print("[-] Display disconnected")
        elif role == "controller":
            print("[-] Controller disconnected")


app.mount("/", StaticFiles(directory=str(Path(__file__).parent / "public"), html=True), name="static")

PORT = 3443

if __name__ == "__main__":
    print(f"\n  https://{LOCAL_IP}:{PORT}/display.html     <- PC")
    print(f"  https://{LOCAL_IP}:{PORT}/controller.html  <- Phone")
    print(f"\n  В браузере нажать 'Дополнительно' -> 'Продолжить'\n")
    uvicorn.run("server:app", host="0.0.0.0", port=PORT,
                ssl_keyfile=KEY_PATH, ssl_certfile=CERT_PATH,
                log_level="warning", reload=True, reload_includes=["*.py"])
