# Devin integration

This branch adds an optional Devin-compatible gateway to Cursor BYOK. It is
isolated from the existing Cursor listener and is disabled by default.

## What is integrated

- Devin Connect request framing, gzip, protobuf-like fields, streaming text,
  thinking, tool calls, signatures, stop reasons, and usage.
- Devin model catalog responses backed by the existing Cursor BYOK model store.
- `AssignModel` sessions with opaque 12-hour tokens. The implementation does
  not copy the reference router's commercial license or JWT behavior.
- Devin model UID to Cursor BYOK model-hash bindings, persisted in the existing
  settings store. API keys remain in the existing model records.
- The existing provider router and Devin tool definitions are reused. Devin
  remains responsible for executing its tools; Cursor BYOK supplies model
  inference and forwards model events.
- An opt-in host patch boundary for a known Devin/Windsurf `extension.js`.
  The user must provide an absolute file path. The patcher requires all four
  endpoint anchors, creates a SHA-256-verified backup, replaces atomically, and
  refuses unknown or partially patched files.

## Ports and setup

The settings page is available under the Devin section. Defaults are:

| Listener | Default |
| --- | ---: |
| API / catalog | `43110` |
| inference | `43111` |
| local API | `43112` |

Enable the gateway, add at least one enabled model binding, and save. The
process reads listener settings at startup, so restart Cursor BYOK after
changing enabled state or ports.

The gateway binds only to `127.0.0.1`. An optional token can be supplied with
`x-devin-router-token` or `Authorization: Bearer ...`. Requests larger than
24 MiB are rejected.

For native Devin integration, first inspect the exact host `extension.js` path
in the settings page. Only after the status reports a compatible clean version
and the Devin gateway is enabled should “应用补丁” be used. The receipt-backed
“恢复原文件” action refuses to restore if the host file or backup changed.

## Intentional limits

The current integration does not automatically discover, edit, or SSH into a
vendor installation. It also does not copy the reference application's
commercial authorization, remote patching, SQLite mutation, or proprietary
status-extension behavior. Unknown host versions fail closed.

This is intentional: the Devin adapter is a separate opt-in path, and the
Cursor listener/harness continues to run independently when Devin is disabled
or when the Devin listener stops.
