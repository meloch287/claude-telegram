import json, pathlib, sys
root, session = pathlib.Path(sys.argv[1]), sys.argv[2]
files = list((root / 'sessions').rglob('*' + session + '.jsonl'))
if len(files) != 1:
    raise RuntimeError('Cannot locate a unique Codex session usage log')
usage = dict(input_tokens=0, cached_input_tokens=0, output_tokens=0)
with files[0].open() as source:
    for line in source:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        payload = event.get('payload', {})
        if event.get('type') == 'event_msg' and payload.get('type') == 'token_count' and payload.get('info'):
            current = payload['info'].get('total_token_usage')
            if current is not None:
                usage = {key: current.get(key, 0) for key in usage}
print(json.dumps(usage))
