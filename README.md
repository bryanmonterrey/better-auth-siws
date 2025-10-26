## better-auth-siws — Sign-In With Solana (SIWS) for Better Auth

Simple SIWS plugin for Better Auth. It provides two endpoints — `start` and `verify` — and a helper to build the canonical SIWS message.

- Server plugin: `siwsPlugin`
- Client plugin: `siwsClientPlugin`
- Message helper: `buildSiwsMessage`

### Installation

```bash
pnpm add better-auth-siws better-auth bs58
```

You will also need a wallet on the client that can `signMessage` (e.g. via `@solana/wallet-adapter`). For tests or Node-only examples, you can use `@solana/web3.js` or `tweetnacl`.

---

## Server setup (Better Auth)

```ts
import { betterAuth } from "better-auth";
import { siwsPlugin } from "better-auth-siws";

export const auth = betterAuth({
  baseURL: "https://app.example.com/api/auth",
  security: {
    trustedOrigins: ["https://app.example.com"],
  },
  plugins: [
    siwsPlugin({
      domain: "app.example.com",          // required; must match your app domain (no protocol)
      statement: "Sign in with Solana to MyApp.", // optional
      nonceTtlSeconds: 300,                // optional; default 300 seconds
    }),
  ],
});
```

The plugin registers two endpoints under your `baseURL`:

- `POST /siws/start` → returns `{ nonce, domain, uri }`
- `POST /siws/verify` → verifies signature, creates a Better Auth session, and sets cookies

When used through Better Auth, these are exposed as `auth.api.start` and `auth.api.verify`.

---

## Client setup (Better Auth client)

```ts
import { createAuthClient } from "better-auth/client";
import { siwsClientPlugin } from "better-auth-siws/client";

export const clientAuth = createAuthClient({
  baseURL: "https://app.example.com/api/auth",
  plugins: [siwsClientPlugin()],
});
```

This exposes `clientAuth.api.start` and `clientAuth.api.verify` in the browser.

---

## End-to-end flow (browser)

Below is a minimal browser flow using a wallet that supports `signMessage`.

```ts
import bs58 from "bs58";
import { buildSiwsMessage } from "better-auth-siws";
import { clientAuth } from "./clientAuth"; // your file that creates the client

async function signInWithSolana(wallet: { publicKey: { toBase58: () => string }, signMessage: (data: Uint8Array) => Promise<Uint8Array> }) {
  // 1) Ask server for a nonce
  const address = wallet.publicKey.toBase58();
  const { nonce, domain, uri } = await clientAuth.api.start({
    body: { address },
  });

  // 2) Build the canonical SIWS message
  const message = buildSiwsMessage({
    domain,
    address,
    uri,
    nonce,
    issuedAt: new Date().toISOString(),
    // optionally add: statement, expirationTime, resources
  });

  // 3) Have the wallet sign the message
  const signatureBytes = await wallet.signMessage(new TextEncoder().encode(message));
  const signature = bs58.encode(signatureBytes);

  // 4) Verify with the server → sets Better Auth session cookies on success
  const result = await clientAuth.api.verify({
    body: { address, message, signature },
  });

  // `result` includes the user and session; cookies are set by the server response
  return result;
}
```

Cookies are set by the server via Better Auth, so subsequent requests are authenticated automatically.

---

## Node-only example (using @solana/web3.js)

```ts
import { betterAuth } from "better-auth";
import { buildSiwsMessage, siwsPlugin } from "better-auth-siws";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

const auth = betterAuth({
  baseURL: "http://localhost:3000/api/auth",
  security: { trustedOrigins: ["http://localhost:3000"] },
  plugins: [siwsPlugin({ domain: "app.example.com" })],
});

async function nodeFlow() {
  const kp = Keypair.generate();
  const address = kp.publicKey.toBase58();

  const { nonce, domain, uri } = await auth.api.start({
    body: { address },
    headers: { origin: "http://localhost:3000" },
  });

  const message = buildSiwsMessage({
    domain,
    address,
    uri,
    nonce,
    issuedAt: new Date().toISOString(),
  });

  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)
  );

  const result = await auth.api.verify({
    body: { address, message, signature },
    headers: { origin: "http://localhost:3000" },
  });

  console.log(result);
}
```

---

## API Reference

### `siwsPlugin(options)`

```ts
interface SiwsOptions {
  domain: string;            // e.g., "app.example.com" (no protocol)
  statement?: string;
  nonceTtlSeconds?: number;  // default 300
}
```

- **start** (`POST /siws/start`): accepts `{ address }`, returns `{ nonce, domain, uri }` and stores a one-time nonce.
- **verify** (`POST /siws/verify`): accepts `{ address, message, signature }`, verifies signature, binds `domain`, creates a session, and sets cookies.

### `siwsClientPlugin()`

Registers the same endpoints on the client instance so you can call `clientAuth.api.start/verify` from the browser.

### `buildSiwsMessage(input)`

```ts
const message = buildSiwsMessage({
  domain: string,
  address: string,      // base58
  uri: string,          // server baseURL
  statement?: string,
  nonce: string,
  issuedAt: string,     // ISO timestamp
  expirationTime?: string,
  resources?: string[],
});
```

Returns a canonical SIWS message string that the wallet must sign.

---

## cURL

```bash
# Start
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"address":"<BASE58_PUBLIC_KEY>"}' \
  https://app.example.com/api/auth/siws/start

# Verify (after you build the message and produce base58 signature)
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "address":"<BASE58_PUBLIC_KEY>",
    "message":"<RAW_MESSAGE_STRING>",
    "signature":"<BASE58_SIGNATURE>"
  }' \
  https://app.example.com/api/auth/siws/verify -i
```

---

## Notes & Troubleshooting

- **Domain binding**: The message must start with your configured `domain`. If you rename domains or use multiple environments, ensure `options.domain` matches where your client runs.
- **Nonce TTL**: Defaults to 300s. `verify` deletes the nonce after one use.
- **Cookies**: On success, the server sets Better Auth session cookies. Ensure the client is on the same site or that your fetch layer forwards and accepts cookies as needed.
- **Invalid signature (401)**: Usually the signature was produced by a different key than the `address` (or message mutated). Rebuild message and re-sign.
- **Nonce invalid/expired (400)**: Call `start` again and sign a fresh message.

---

## License

MIT © João Veiga


