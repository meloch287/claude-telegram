#!/usr/bin/env python3
"""
Собирает конфиг xray из двух VPN-подписок: основной и резервной.

    SUBSCRIPTION_URL=… BACKUP_SUBSCRIPTION_URL=… python3 scripts/make-proxy-config.py
    OUT_DIR=/tmp/x … — куда положить xray.json (по умолчанию ./proxy)

Порты постоянные, чтобы пул бота не менялся от пересборки к пересборке (иначе
бота пришлось бы перезапускать и рвать задачи):

    10800        — главный вход. Балансировщик по серверам основной подписки;
                   если живых среди них нет, трафик сам уходит на резерв
                   (выход loopback → вход резервного балансировщика). Бот
                   живёт здесь и падений отдельных серверов не замечает.
    10830        — резервный балансировщик напрямую: второй вход бота.
    10801–10815  — по серверу на порт: сперва основные, потом резервные.
                   Лишние порты ведут в главный вход.

Xray раз в минуту меряет каждый сервер тремя пробами (burstObservatory) и
не пускает в балансировку тех, кто не ответил; из живых берёт самый
стабильный (leastLoad — на испытании 25.09.2026 он держал 19 запросов из 20
при мёртвой основной подписке против 18 у leastPing). fallbackTag умеет указывать
только на выход, не на другой балансировщик, поэтому переход на резерв
сделан через выход loopback — это штатный способ в xray.

Подписка у провайдеров бывает двух видов, и они меняют её без предупреждения:
JSON с готовыми конфигами xray (отдают клиенту v2rayNG) или список ссылок в
base64 (клиенту v2rayN). Разбираются оба; каждую подписку качаем с трёх
попыток, удачный ответ кладём в кэш и при недоступности собираем из него.

Выходы в страны, где Anthropic закрыт (Россия, Гонконг, Китай…), отброшены
по названию сервера; у «Russia -> Europe» смотрим на то, что после стрелки.

Файл на выходе содержит ключи от VPN: права 400, владелец 65532 (под ним
работает distroless-образ xray).
"""
import base64, json, os, re, sys, time, urllib.parse, urllib.request

OUT_DIR = os.environ.get("OUT_DIR", "./proxy")
STATE = os.environ.get("STATE_DIR", "/var/lib/claude-telegram")
PREFER = os.environ.get("COUNTRY", "Germany")
SOURCES = [
    # (метка, префикс тегов, адрес, файл кэша, сколько отдельных портов)
    ("основная", "p", os.environ.get("SUBSCRIPTION_URL", ""), os.path.join(STATE, "subscription.cache"), 10),
    ("резервная", "b", os.environ.get("BACKUP_SUBSCRIPTION_URL", ""), os.path.join(STATE, "subscription-backup.cache"), 5),
]
ENTRY_PORT = 10800
BACKUP_PORT = 10830
FIRST_PORT = 10801
SLOTS = 15
ATTEMPTS = 3
BLOCKED = re.compile(r"russia|росси|\bhk\b|hong ?kong|china|кита|iran|belarus|беларус|syria|north korea|cuba", re.I)
PROBE_URL = "https://www.gstatic.com/generate_204"


def fetch(url, ua):
    """Три попытки с паузой: провайдер иногда отвечает не с первого раза."""
    last = None
    for attempt in range(ATTEMPTS):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua})
            return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
        except Exception as e:
            last = e
            if attempt < ATTEMPTS - 1:
                time.sleep(2 + attempt * 3)
    raise last


def from_json(body):
    data = json.loads(body)
    if isinstance(data, dict):
        data = [data]
    found = []
    for cfg in data:
        name = str(cfg.get("remarks") or "")
        # Свой балансировщик провайдера («Auto») — дубли тех же серверов.
        if cfg.get("routing", {}).get("balancers") and len(cfg.get("outbounds", [])) > 5:
            continue
        for ob in cfg.get("outbounds", []):
            if ob.get("protocol") in ("freedom", "blackhole", "dns", "loopback"):
                continue
            if ((ob.get("streamSettings") or {}).get("sockopt") or {}).get("dialerProxy"):
                continue  # цепочки через другой выход не переносим
            found.append({"name": name, "outbound": ob})
    return found


def parse_vless(line):
    u = urllib.parse.urlparse(line)
    q = dict(urllib.parse.parse_qsl(u.query))
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
        stream["tlsSettings"] = {"serverName": q.get("sni", u.hostname), "fingerprint": q.get("fp", "chrome")}
        if q.get("alpn"):
            stream["tlsSettings"]["alpn"] = q["alpn"].split(",")
    net = stream["network"]
    if net == "ws":
        stream["wsSettings"] = {"path": q.get("path", "/"), "headers": {"Host": q.get("host", "")}}
    elif net == "grpc":
        stream["grpcSettings"] = {"serviceName": q.get("serviceName", "")}
    elif net == "xhttp":
        x = {"path": q.get("path", "/"), "mode": q.get("mode", "auto")}
        if q.get("host"):
            x["host"] = q["host"]
        if q.get("extra"):
            try:
                x["extra"] = json.loads(q["extra"])
            except Exception:
                pass
        stream["xhttpSettings"] = x
    return {
        "name": urllib.parse.unquote(u.fragment or ""),
        "outbound": {
            "protocol": "vless",
            "settings": {"vnext": [{"address": u.hostname, "port": u.port or 443, "users": [{"id": u.username, "encryption": q.get("encryption", "none"), "flow": q.get("flow", "")}]}]},
            "streamSettings": stream,
        },
    }


def from_links(body):
    text = body.strip()
    if "://" not in text:
        try:
            text = base64.b64decode(text + "=" * (-len(text) % 4)).decode("utf-8", "replace")
        except Exception:
            return []
    return [parse_vless(l.strip()) for l in text.splitlines() if l.strip().startswith("vless://")]


def load(label, url, cache):
    """JSON (v2rayNG) → ссылки (v2rayN) → кэш. Возвращает (серверы, откуда, ошибки)."""
    errors = []
    if url:
        for ua, parse in (("v2rayNG/1.8.0", from_json), ("v2rayN/7.0", from_links)):
            try:
                body = fetch(url, ua)
                servers = parse(body)
                if servers:
                    try:
                        os.makedirs(os.path.dirname(cache), exist_ok=True)
                        with open(cache, "w") as f:
                            json.dump({"ua": ua, "body": body, "at": int(time.time())}, f)
                        os.chmod(cache, 0o600)
                    except OSError:
                        pass
                    return servers, f"подписка ({ua})", errors
                errors.append(f"{ua}: серверов нет")
            except Exception as e:
                errors.append(f"{ua}: {e}")
    try:
        with open(cache) as f:
            cached = json.load(f)
        parse = from_json if cached["ua"].startswith("v2rayNG") else from_links
        servers = parse(cached["body"])
        if servers:
            age = (time.time() - cached.get("at", time.time())) / 3600
            return servers, f"кэш ({age:.0f} ч)", errors
    except FileNotFoundError:
        errors.append("кэша нет")
    except Exception as e:
        errors.append(f"кэш: {e}")
    return [], "недоступна", errors


def exit_name(name):
    # «Russia -> Europe»: выходим там, куда указывает стрелка.
    return re.split(r"->|→", name)[-1]


def key(ob):
    s = ob.get("settings", {})
    first = (s.get("vnext") or s.get("servers") or [s])[0]
    return (ob.get("protocol"), first.get("address"), first.get("port"), (ob.get("streamSettings") or {}).get("network"))


groups = {}
report = []
seen = set()
for label, prefix, url, cache, slots in SOURCES:
    servers, source, errors = load(label, url, cache)
    picked, dropped = [], 0
    for sv in servers:
        if BLOCKED.search(exit_name(sv["name"])):
            dropped += 1
            continue
        k = key(sv["outbound"])
        if k in seen:
            continue
        seen.add(k)
        picked.append(sv)
    picked.sort(key=lambda sv: 0 if PREFER.lower() in sv["name"].lower() else 1)
    groups[prefix] = picked
    report.append(f"{label}: {source}, серверов {len(picked)}, отброшено по стране {dropped}" + (f"; ошибки: {'; '.join(errors)}" if errors and not picked else ""))

if not groups["p"] and not groups["b"]:
    print("\n".join(report))
    raise SystemExit("ни одна подписка не дала годных серверов")

outbounds = []
for prefix, picked in groups.items():
    for i, sv in enumerate(picked):
        ob = dict(sv["outbound"])
        ob["tag"] = f"{prefix}{i}"
        outbounds.append(ob)


def http_in(tag, port):
    return {"tag": tag, "listen": "0.0.0.0", "port": port, "protocol": "http", "sniffing": {"enabled": True, "destOverride": ["http", "tls"]}}


inbounds = [http_in("entry", ENTRY_PORT), http_in("backup", BACKUP_PORT), http_in("to-backup-in", 0)]
inbounds.pop()  # loopback-вход не слушает порт: его объявлять не нужно
rules, balancers = [], []
extra_out = []

has_p, has_b = bool(groups["p"]), bool(groups["b"])
if has_b:
    balancers.append({"tag": "bal-b", "selector": ["b"], "strategy": {"type": "leastLoad"}, "fallbackTag": "b0"})
if has_p:
    bal = {"tag": "bal-p", "selector": ["p"], "strategy": {"type": "leastLoad"}, "fallbackTag": "p0"}
    if has_b:
        # Все основные мертвы — на резерв через loopback во вход «backup».
        bal["fallbackTag"] = "to-backup"
        extra_out.append({"tag": "to-backup", "protocol": "loopback", "settings": {"inboundTag": "backup"}})
    balancers.append(bal)
entry_bal = "bal-p" if has_p else "bal-b"
rules.append({"type": "field", "inboundTag": ["entry"], "balancerTag": entry_bal})
rules.append({"type": "field", "inboundTag": ["backup"], "balancerTag": "bal-b" if has_b else entry_bal})

# Отдельные порты: сперва основные, потом резервные, лишние — во вход.
slot_list = [(f"p{i}", sv) for i, sv in enumerate(groups["p"][: SOURCES[0][4]])]
slot_list += [(f"b{i}", sv) for i, sv in enumerate(groups["b"][: SOURCES[1][4]])]
slot_list = slot_list[:SLOTS]
spare = []
for s in range(SLOTS):
    port = FIRST_PORT + s
    if s < len(slot_list):
        tag = slot_list[s][0]
        inbounds.append(http_in(f"s-{tag}", port))
        rules.append({"type": "field", "inboundTag": [f"s-{tag}"], "outboundTag": tag})
    else:
        inbounds.append(http_in(f"s-spare{s}", port))
        spare.append(f"s-spare{s}")
if spare:
    rules.append({"type": "field", "inboundTag": spare, "balancerTag": entry_bal})

selectors = (["p"] if has_p else []) + (["b"] if has_b else [])
config = {
    "log": {"loglevel": "warning"},
    "inbounds": inbounds,
    "outbounds": outbounds + extra_out + [{"protocol": "freedom", "tag": "direct"}],
    "routing": {"domainStrategy": "AsIs", "rules": rules, "balancers": balancers},
    # Раз в минуту по три пробы на сервер: мёртвый выпадает за минуту-две,
    # оживший возвращается сам.
    "burstObservatory": {"subjectSelector": selectors, "pingConfig": {"destination": PROBE_URL, "interval": "1m", "sampling": 3, "timeout": "10s"}},
}

os.makedirs(OUT_DIR, exist_ok=True)
path = os.path.join(OUT_DIR, "xray.json")
with open(path, "w") as f:
    json.dump(config, f, indent=2, ensure_ascii=False)
os.chmod(path, 0o400)
try:
    os.chown(path, 65532, 65532)
except PermissionError:
    print("не удалось сменить владельца на 65532 — xray не прочитает конфиг")

print("\n".join(report))
print(f"  порт {ENTRY_PORT} -> главный вход ({'основная' if has_p else 'резервная'}{', при отказе — резерв' if has_p and has_b else ''})")
print(f"  порт {BACKUP_PORT} -> резервный балансировщик")
for s, (tag, sv) in enumerate(slot_list):
    print(f"  порт {FIRST_PORT + s} -> [{'основная' if tag[0] == 'p' else 'резерв'}] {sv['name']}  ({sv['outbound'].get('protocol')})")
ports = [ENTRY_PORT, BACKUP_PORT] + [FIRST_PORT + s for s in range(SLOTS)]
print("PROXY_POOL=" + ",".join(f"http://claude-proxy:{p}" for p in ports))
