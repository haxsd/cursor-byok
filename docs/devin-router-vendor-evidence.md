# Devin router: vendor evidence vs this implementation

This note records what the commercial Devin Model Router actually stores on a
machine where it is installed, and where this branch's implementation differs.
It exists because several features were deferred for lack of real evidence; this
is the first real evidence, and it changes what is guesswork and what is not.

Source: the vendor product's own state files under
`%APPDATA%\devin-model-router\` (`route-state.json`, `config.json`) on the
development machine. Only structure, field names, and non-sensitive values are
recorded here. Credentials, license state, tokens and usage data are not copied
into the repository.

## What the vendor stores

`config.json` (version 2) is organised by concern:

| Key | Meaning |
| --- | --- |
| `runtime` | `apiPort`, `inferencePort`, `localApiPort`, `autoStart`, `devinPath` |
| `profiles` | Reusable provider targets: `id`, `name`, `provider`, `baseUrl`, `apiPath`, `apiKey`, `models`, `maxTokens`, `cacheMode`, `responsesTransport` |
| `slots` | Devin-facing model entries: `id`, `uid`, `displayName`, `profileId`, `modelId`, `enabled`, `defaultRouteId` |
| `bindings` | Route records: `id`, `kind`, `slotId`, `devinModelUid`, `devinFamilyUid`, `displayName`, `familyName`, `profileId`, `modelId`, `defaultRouteId`, `enabled`, plus per-kind extras such as `cacheNamespace` and `instructionEnabled` |
| `remoteSsh*` | Remote execution: connection settings plus `autoPatch`, `autoReconnect`, `autoConnect` |

Observed values worth noting:

- The vendor listens on `43100 / 43101 / 43102`. This branch defaults to
  `43110 / 43111 / 43112`, so both can run side by side without a port clash.
- Binding `kind` is not a single flag; three kinds appear in practice:
  - `legacy` — the BYOK compatibility mapping for classic UIDs such as
    `MODEL_CLAUDE_4_SONNET_BYOK`;
  - `auxiliary` — background work; the observed entry is the context-compression
    binding and carries a `cacheNamespace`;
  - `native` — a real Devin model UID such as `deepseek-v4-1-flash-high` grouped
    under a family UID (`deepseek-v4-1-flash`).
- `slots` and `bindings` are separate: a slot is what Devin sees, a binding is
  how it is served. The same `profileId`/`modelId` pair serves several slots.

`route-state.json` (version 2) is the runtime half:

```json
{
  "version": 2,
  "selection": { "family:<family-uid>": "<route-id>" },
  "health": {},
  "configuredDefaults": { "family:<family-uid>": "<route-id>" },
  "lastActiveGroupId": ""
}
```

Three things are worth copying conceptually: selection is keyed **per family**,
not per UID; `configuredDefaults` keeps what the user configured separate from
what is currently selected; and `health` is its own section rather than mixed
into selection.

## Where this branch differs

| Concern | Vendor | This branch |
| --- | --- | --- |
| Provider credentials | Reusable `profiles` | Reuses the existing Cursor BYOK model store; no second credential store |
| Devin-facing entry | `slots` (separate from bindings) | One binding serves as both, keyed by `model_uid` |
| Route records | `bindings` with `kind` and `defaultRouteId` | `routes` per binding with `active_route_id` |
| Selection scope | Per family | Per binding |
| Model families | `devinFamilyUid` / `familyName` | Not modelled |
| Background work | `kind: auxiliary` + `cacheNamespace` | `kind: context_compression`, no cache namespace |
| Runtime health | `health` section in route state | Not modelled |
| Remote execution | `remoteSsh` with auto patch/connect | Explicit local path only, never automatic |

## What is still not proven

The vendor's **wire** behaviour — which Devin RPC fields carry a family UID,
how an auxiliary request is distinguished from a chat request, and how the
vendor advertises native model UIDs in the catalog — is still unobserved. The
files above are its control plane, not its protocol. Any change to this branch's
Connect adapter therefore still needs a real capture from a Devin client talking
to the gateway.

What the evidence does settle: family-level selection, a separate configured
default, a `health` section, and a context-compression binding with its own
cache namespace are real vendor concepts, not speculations. Implementing any of
them is now a design decision with a reference, which is a different position
from the one recorded when those features were deferred.
