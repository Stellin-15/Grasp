[Folder](_folder.md) · [Index](../../../index.md)

# `src/auth/token.ts`

TypeScript · source · 30 lines · 6 symbols

## Contents

| Symbol | Kind | Lines | Exported | Summary |
| --- | --- | --- | --- | --- |
| [`TokenService`](#sym-TokenService) | class | 4-30 | yes | Issues and checks signed session tokens. |
| [`TokenService.constructor`](#sym-TokenService-constructor) | method | 5-5 | yes |  |
| [`TokenService.issue`](#sym-TokenService-issue) | method | 11-13 | yes | Signs a token for a user. |
| [`TokenService.verify`](#sym-TokenService-verify) | method | 16-23 | yes | Returns false instead of throwing so callers can map it to a 401. |
| [`TokenService.decode`](#sym-TokenService-decode) | method | 25-27 | no |  |
| [`TokenService.fromEnv`](#sym-TokenService-fromEnv) | method | 29-29 | yes |  |

## Imports

| Line | Module | Names | Resolves to |
| --- | --- | --- | --- |
| 1 | `jsonwebtoken` | default as jwt | package `jsonwebtoken` |

## Imported by

- [`src/server.ts:3`](../server.ts.md)

## Symbols

<a id="sym-TokenService"></a>

### `TokenService` · class

```ts
export class TokenService
```

Lines 4-30 · exported

> Issues and checks signed session tokens.

**Members:** [`constructor`](#sym-TokenService-constructor), [`issue`](#sym-TokenService-issue), [`verify`](#sym-TokenService-verify), [`decode`](#sym-TokenService-decode), [`fromEnv`](#sym-TokenService-fromEnv)

**Called by** (2):

- [`src/auth/token.ts:29`](token.ts.md) in [`TokenService.fromEnv`](token.ts.md#sym-TokenService-fromEnv)
- [`src/server.ts:13`](../server.ts.md) in [`createServer`](../server.ts.md#sym-createServer)

**History:** introduced around `aaaaaaa` "add token service" (2024-01-01, Ada); last changed in `bbbbbbb` "harden token verification" (2024-03-01, Ada); 2 commits own its current lines.

<a id="sym-TokenService-constructor"></a>

#### `TokenService.constructor` · method

```ts
constructor(private readonly secret: string)
```

Lines 5-5 · exported · member of [`TokenService`](token.ts.md#sym-TokenService)

**Parameters**

| Name | Type | Default |
| --- | --- | --- |
| `secret` | `string` |  |

**History:** introduced around `aaaaaaa` "add token service" (2024-01-01, Ada); 1 commit owns its current lines.

<a id="sym-TokenService-issue"></a>

#### `TokenService.issue` · method

```ts
issue(subject: string, ttlSeconds = 3600): string
```

Lines 11-13 · exported · member of [`TokenService`](token.ts.md#sym-TokenService)

> Signs a token for a user.
> @param subject user id stored in the `sub` claim

**Parameters**

| Name | Type | Default |
| --- | --- | --- |
| `subject` | `string` |  |
| `ttlSeconds` |  | `3600` |

**Returns:** `string`

**Called by** (1):

- [`src/server.ts:26`](../server.ts.md) in [`createServer`](../server.ts.md#sym-createServer)

**Also calls** (outside this repo or dynamic): `jwt.sign`

**History:** introduced around `bbbbbbb` "harden token verification" (2024-03-01, Ada); 1 commit owns its current lines.

<a id="sym-TokenService-verify"></a>

#### `TokenService.verify` · method

```ts
verify(token: string): boolean
```

Lines 16-23 · exported · member of [`TokenService`](token.ts.md#sym-TokenService)

> Returns false instead of throwing so callers can map it to a 401.

**Parameters**

| Name | Type | Default |
| --- | --- | --- |
| `token` | `string` |  |

**Returns:** `boolean`

**Called by** (1):

- [`src/server.ts:22`](../server.ts.md) in [`createServer`](../server.ts.md#sym-createServer)

**Calls:** [`TokenService.decode`](token.ts.md#sym-TokenService-decode)

**History:** introduced around `bbbbbbb` "harden token verification" (2024-03-01, Ada); 1 commit owns its current lines.

<a id="sym-TokenService-decode"></a>

#### `TokenService.decode` · method

```ts
private decode(token: string)
```

Lines 25-27 · internal · member of [`TokenService`](token.ts.md#sym-TokenService)

**Parameters**

| Name | Type | Default |
| --- | --- | --- |
| `token` | `string` |  |

**Called by** (1):

- [`src/auth/token.ts:18`](token.ts.md) in [`TokenService.verify`](token.ts.md#sym-TokenService-verify)

**Also calls** (outside this repo or dynamic): `jwt.verify`, `token.replace`

**History:** introduced around `bbbbbbb` "harden token verification" (2024-03-01, Ada); 1 commit owns its current lines.

<a id="sym-TokenService-fromEnv"></a>

#### `TokenService.fromEnv` · method

```ts
static fromEnv = (): TokenService
```

Lines 29-29 · exported · member of [`TokenService`](token.ts.md#sym-TokenService)

**Returns:** `TokenService`

**Calls:** [`TokenService`](token.ts.md#sym-TokenService)

**History:** introduced around `bbbbbbb` "harden token verification" (2024-03-01, Ada); 1 commit owns its current lines.
