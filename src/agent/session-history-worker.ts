import { getSessionInfo, getSessionMessages, listSessions, renameSession, deleteSession } from "@anthropic-ai/claude-agent-sdk";

const request = JSON.parse(process.argv[2] ?? "{}");
let result: unknown;
switch (request.action) {
  case "list": result = await listSessions({ dir: request.dir, limit: 10, includeWorktrees: false }); break;
  case "listAll": result = await listSessions({ includeWorktrees: false }); break;
  case "delete": {
    const info = await getSessionInfo(request.id, { dir: request.dir });
    if (!info || info.cwd !== request.dir) throw new Error("Session unavailable");
    await deleteSession(request.id, { dir: request.dir });
    if (await getSessionInfo(request.id, { dir: request.dir })) throw new Error("Session deletion incomplete");
    result = true; break;
  }
  case "info": result = await getSessionInfo(request.id, request.dir ? { dir: request.dir } : undefined); break;
  case "messages": result = await getSessionMessages(request.id, { dir: request.dir }); break;
  case "rename": await renameSession(request.id, request.title, { dir: request.dir }); result = true; break;
  default: throw new Error("Unknown history operation");
}
process.stdout.write(JSON.stringify(result ?? null));
