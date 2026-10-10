import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ensureWorker, runInWorker, docker, readFile, dialogAction } from "./worker.mjs";

const a = 1057399602,
  b = 482961058;
await ensureWorker(a);
await ensureWorker(b);
const dialogA = randomUUID(),
  dialogB = randomUUID();
await dialogAction(a, dialogA, "prepare");
await dialogAction(b, dialogB, "prepare");
const marker = `private-${Date.now()}`;
await runInWorker(b, [
  "python3",
  "-c",
  "import pathlib,sys;p=pathlib.Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(sys.argv[2])",
  `/app/workspaces/${b}/.dialogs/${dialogB}/.isolation-test`,
  marker,
]);
const probe = await runInWorker(a, [
  "python3",
  "-c",
  `import os,json,socket
paths=['/opt/ai-bot/app/.env','/var/run/docker.sock','/app/workspaces/${b}/.dialogs/${dialogB}/.isolation-test','/opt/gpt-migration/original/.env']
assert os.getuid()==1000
assert all(not os.path.exists(p) for p in paths),paths
cap=[x for x in open('/proc/self/status') if x.startswith('CapEff:')][0].split()[1]
assert int(cap,16)==0,cap
try:
 open('/etc/isolation-test','w')
 raise AssertionError('Root filesystem was writable')
except OSError:pass
for host,port in [('172.30.0.1',22),('200.165.236.8',22),('169.254.169.254',80)]:
 s=socket.socket();s.settimeout(2)
 try:s.connect((host,port));raise AssertionError('Forbidden network reachable: '+host)
 except (OSError,TimeoutError):pass
 finally:s.close()
print(json.dumps({'uid':os.getuid(),'capabilities':cap,'private_files':'inaccessible','rootfs':'read-only','host_and_metadata':'blocked'}))`,
]);
console.log("Tenant A:", probe.stdout.trim());
const other = JSON.parse((await docker(["inspect", `ai-user-${b}`])).stdout)[0];
const ip = other.NetworkSettings.Networks["ai-workers"].IPAddress;
await docker([
  "exec",
  "-d",
  `ai-user-${b}`,
  "python3",
  "-m",
  "http.server",
  "18999",
  "--bind",
  "0.0.0.0",
  "--directory",
  "/tmp",
]);
await runInWorker(a, [
  "python3",
  "-c",
  `import socket
s=socket.socket();s.settimeout(2)
try:s.connect((${JSON.stringify(ip)},18999));raise AssertionError('Sibling network reachable')
except (OSError,TimeoutError):print('Sibling network blocked')
finally:s.close()`,
]);
await runInWorker(a, [
  "python3",
  "-c",
  `import pathlib;p=pathlib.Path('/app/workspaces/${a}/.dialogs/${dialogA}/.escape-test');p.unlink(missing_ok=True);p.symlink_to('/home/agent/.codex/auth.json')`,
]);
await assert.rejects(readFile(a, "default", ".escape-test", dialogA));
await runInWorker(a, [
  "python3",
  "-c",
  `from pathlib import Path;Path('/app/workspaces/${a}/.dialogs/${dialogA}/.escape-test').unlink(missing_ok=True)`,
]);
await runInWorker(b, [
  "python3",
  "-c",
  `from pathlib import Path;Path('/app/workspaces/${b}/.dialogs/${dialogB}/.isolation-test').unlink(missing_ok=True)`,
]);
await docker(["restart", "--time", "1", `ai-user-${b}`]);
await dialogAction(a, dialogA, "erase");
await dialogAction(b, dialogB, "erase");
console.log(
  "PASS: separate files, unprivileged processes, blocked sibling/host networks, symlink download rejected",
);
