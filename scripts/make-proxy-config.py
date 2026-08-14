#!/usr/bin/env python3
"""
Собирает конфиг xray из VPN-подписки, оставляя серверы нужной страны.

Каждый отобранный сервер получает собственный локальный HTTP-порт. Переключение
между ними делает сам бот: он пробует порты по очереди и берёт первый живой,
поэтому в /status видно, какой именно канал активен и почему.

    SUBSCRIPTION_URL=https://... python3 scripts/make-proxy-config.py [страна]

По умолчанию страна — Germany, каталог вывода — ./proxy.

Файл на выходе содержит ключи от VPN. Права ставим 400 и владельца 65532 —
под этим UID работает distroless-образ xray, иначе он не прочитает конфиг.
"""
import base64, json, os, sys, urllib.parse, urllib.request

SUB = os.environ.get("SUBSCRIPTION_URL", "")
if not SUB:
    raise SystemExit("не задан SUBSCRIPTION_URL")
COUNTRY = sys.argv[1] if len(sys.argv) > 1 else "Germany"
OUT_DIR = os.environ.get("OUT_DIR", "./proxy")
BASE_PORT = 10801

req = urllib.request.Request(SUB, headers={"User-Agent": "v2rayNG/1.8.0"})
raw = urllib.request.urlopen(req, timeout=30).read().decode()
try:
    decoded = base64.b64decode(raw + "==").decode()
except Exception:
    decoded = raw

def parse_vless(line):
    u = urllib.parse.urlparse(line)
    q = dict(urllib.parse.parse_qsl(u.query))
    name = urllib.parse.unquote(u.fragment or "")
    stream = {"network": q.get("type", "tcp")}
    security = q.get("security", "none")
    if security == "reality":
        stream["security"] = "reality"
        stream["realitySettings"] = {
            "serverName": q.get("sni", ""),
            "fingerprint": q.get("fp", "chrome"),
            "publicKey": q.get("pbk", ""),
            "shortId": q.get("sid", ""),
            "spiderX": q.get("spx", "/"),
        }
    elif security == "tls":
        stream["security"] = "tls"
        stream["tlsSettings"] = {
            "serverName": q.get("sni", u.hostname),
            "fingerprint": q.get("fp", "chrome"),
            "allowInsecure": False,
        }
    if security in ("tls", "reality") and q.get("alpn"):
        key = "tlsSettings" if security == "tls" else "realitySettings"
        stream[key]["alpn"] = q["alpn"].split(",")

    net = stream["network"]
    if net == "ws":
        stream["wsSettings"] = {"path": q.get("path", "/"), "headers": {"Host": q.get("host", "")}}
    elif net == "grpc":
        stream["grpcSettings"] = {"serviceName": q.get("serviceName", "")}
    elif net == "xhttp":
        # xhttp — транспорт свежих сборок xray. Без path/host/mode и блока extra
        # сервер не отвечает вовсе: настройки не имеют разумных умолчаний.
        xhttp = {"path": q.get("path", "/"), "mode": q.get("mode", "auto")}
        if q.get("host"):
            xhttp["host"] = q["host"]
        if q.get("extra"):
            try:
                xhttp["extra"] = json.loads(q["extra"])
            except Exception:
                pass
        stream["xhttpSettings"] = xhttp
    return {
        "name": name,
        "outbound": {
            "protocol": "vless",
            "settings": {"vnext": [{
                "address": u.hostname,
                "port": u.port or 443,
                "users": [{
                    "id": u.username,
                    "encryption": q.get("encryption", "none"),
                    "flow": q.get("flow", ""),
                }],
            }]},
            "streamSettings": stream,
        },
    }

german = []
for line in decoded.splitlines():
    line = line.strip()
    if not line.startswith("vless://"):
        continue
    if COUNTRY not in urllib.parse.unquote(urllib.parse.urlparse(line).fragment or ""):
        continue
    german.append(parse_vless(line))

if not german:
    raise SystemExit(f"VLESS-серверов страны {COUNTRY} в подписке не нашлось")

inbounds, outbounds, rules = [], [], []
for i, server in enumerate(german):
    port = BASE_PORT + i
    tag_in, tag_out = f"in{i}", f"out{i}"
    inbounds.append({
        "tag": tag_in, "listen": "0.0.0.0", "port": port, "protocol": "http",
        "sniffing": {"enabled": True, "destOverride": ["http", "tls"]},
    })
    ob = dict(server["outbound"]); ob["tag"] = tag_out
    outbounds.append(ob)
    rules.append({"type": "field", "inboundTag": [tag_in], "outboundTag": tag_out})

config = {
    "log": {"loglevel": "warning"},
    "inbounds": inbounds,
    "outbounds": outbounds + [{"protocol": "freedom", "tag": "direct"}],
    "routing": {"domainStrategy": "AsIs", "rules": rules},
}

os.makedirs(OUT_DIR, exist_ok=True)
path = os.path.join(OUT_DIR, "xray.json")
with open(path, "w") as f:
    json.dump(config, f, indent=2)
os.chmod(path, 0o400)
try:
    os.chown(path, 65532, 65532)
except PermissionError:
    print("не удалось сменить владельца на 65532 — сделай это вручную, иначе xray не прочитает конфиг")

print(f"германских серверов: {len(german)}")
for i, s in enumerate(german):
    v = s["outbound"]["settings"]["vnext"][0]
    sec = s["outbound"]["streamSettings"].get("security", "none")
    print(f"  порт {BASE_PORT + i} -> {s['name']}  ({v['address']}:{v['port']}, {sec})")
print("PROXY_POOL=" + ",".join(f"http://claude-proxy:{BASE_PORT + i}" for i in range(len(german))))
