# Contract: Native Host ↔ Channel Server (Unix domain socket)

- Directory: `$XDG_RUNTIME_DIR/claude-pointer/` (fallback `/tmp/claude-pointer-<uid>/`),
  created with mode `0700`. The channel server refuses to start if the directory is not owned
  by the current user or is group/world accessible.
- Socket: `<sessionId>.sock`, mode `0600`. Created by the channel server at start; unlinked on
  exit (`SIGINT`, `SIGTERM`, stdin close).
- Framing: newline-delimited JSON, one request and one response per connection.
- Timeout: native host waits 1500 ms for a response.

## `info`

Request: `{"v":1,"type":"info"}`

Response:

```json
{ "v": 1, "ok": true, "session": { "id": "…", "projectDir": "…", "projectName": "…", "startedAt": "…" } }
```

The native host calls `info` on every socket for `list-sessions`. A socket that refuses
connection is stale: the native host unlinks it.

## `deliver`

Request: `{"v":1,"type":"deliver","batch":{ /* Batch */ }}`

Response: `{"v":1,"ok":true,"batchId":"…","deliveredAt":"…"}` after the MCP notification has
been written to the session's stdout (see [channel-prompt.md](./channel-prompt.md)), or an
error object with the codes from [native-messaging.md](./native-messaging.md).

The channel server validates the batch again (it does not trust the native host's checks).
