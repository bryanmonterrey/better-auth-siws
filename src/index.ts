import { createAuthEndpoint } from "better-auth/api";
import type { BetterAuthPlugin, User } from "better-auth";
import bs58 from "bs58";
import * as ed25519 from "@noble/ed25519";
import { z } from "zod";
import { setSessionCookie } from "better-auth/cookies";

/* -------------------------------- Options -------------------------------- */

export interface SiwsOptions {
  domain: string;            // e.g., "app.example.com" (no protocol)
  statement?: string;
  nonceTtlSeconds?: number;  // default 300
}

/* ------------------------- Canonical message builder ---------------------- */

export function buildSiwsMessage(i: {
  domain: string;
  address: string;      // base58
  uri: string;
  statement?: string;
  nonce: string;
  issuedAt: string;        // ISO
  expirationTime?: string; // ISO
  resources?: string[];
}) {
  const lines = [
    `${i.domain} wants you to sign in with your Solana account:`,
    `${i.address}`,
    "",
    i.statement ?? "Sign in with Solana to the app.",
    "",
    `URI: ${i.uri}`,
    `Version: 1`,
    `Nonce: ${i.nonce}`,
    `Issued At: ${i.issuedAt}`,
  ];
  if (i.expirationTime) lines.push(`Expiration Time: ${i.expirationTime}`);
  if (i.resources?.length) lines.push(`Resources:\n- ${i.resources.join("\n- ")}`);
  return lines.join("\n");
}

/* --------------------- internalAdapter version bridge --------------------- */

const SIWS_PROVIDER_ID = "siws";

/**
 * The account issuer better-auth >=1.7 stores for a plugin-owned (non-OAuth)
 * provider. It mirrors `createLocalAccountIssuer(providerId)` from
 * `@better-auth/core/db`, which is inlined rather than imported: that helper
 * does not exist on 1.6, and this plugin supports both. The value has to match
 * byte for byte or an existing account is never found and a duplicate user is
 * created on every sign-in.
 */
const SIWS_ISSUER = `local:${encodeURIComponent(SIWS_PROVIDER_ID)}`;

type SiwsAccount = { userId: string } | null | undefined;

interface AdapterShape {
  /**
   * better-auth >= 1.7. The KEY changed inside the 1.7 line: 1.7.0–1.7.2 read
   * `{ issuer, accountId }`, 1.7.3+ went back to `{ providerId, accountId }`
   * and ignores issuer. Each destructures only the field it knows, so both are
   * always passed.
   */
  findAccountByKey?: (key: { providerId: string; issuer: string; accountId: string }) => Promise<SiwsAccount>;
  /** better-auth >= 1.6, removed in 1.7. */
  findAccountByProviderId?: (accountId: string, providerId: string) => Promise<SiwsAccount>;
}

/** 1.7 keys accounts on (issuer, accountId); 1.6 keys them on (accountId, providerId). */
const usesIssuerIdentity = (adapter: AdapterShape) => typeof adapter.findAccountByKey === "function";

async function findSiwsAccount(adapter: AdapterShape, accountId: string): Promise<SiwsAccount> {
  if (usesIssuerIdentity(adapter)) {
    // Passing only `issuer` matched nothing on 1.7.3+ (providerId undefined),
    // which does not error — it mints a duplicate user on every sign-in.
    return adapter.findAccountByKey!({ providerId: SIWS_PROVIDER_ID, issuer: SIWS_ISSUER, accountId });
  }
  if (typeof adapter.findAccountByProviderId === "function") {
    return adapter.findAccountByProviderId(accountId, SIWS_PROVIDER_ID);
  }
  throw new Error(
    "better-auth's internalAdapter exposes neither findAccountByKey (>=1.7) nor findAccountByProviderId (>=1.6)",
  );
}

/* ------------------------------ Server plugin ---------------------------- */

export const siwsPlugin = (options: SiwsOptions) =>
({
  id: "siws",
  endpoints: {
    // POST /siws/start -> { nonce, domain, uri }
    start: createAuthEndpoint("/siws/start", {
      method: "POST", body: z.object({
        address: z.string().min(32),
      }),
    }, async (ctx) => {
      const { address } = ctx.body;

      const nonce = bs58.encode(crypto.getRandomValues(new Uint8Array(16)));
      const expiresAt = new Date(
        Date.now() + (options.nonceTtlSeconds ?? 300) * 1000
      );

      await ctx.context.internalAdapter.createVerificationValue({
        identifier: `siws:${address}`,
        value: nonce,
        expiresAt,
      });

      return ctx.json({
        nonce,
        domain: options.domain,
        uri: ctx.context.baseURL,
      });
    }),

    // POST /siws/verify -> verify signature, bind domain, upsert user, create session
    verify: createAuthEndpoint("/siws/verify", {
      method: "POST", body: z.object({
        address: z.string().min(32),
        message: z.string(),
        signature: z.string(),
      }),
    }, async (ctx) => {
      const { address, message, signature } = ctx.body;

      // 1) Extract nonce from message
      const nonceLine = message.split("\n").find((l: string) => l.startsWith("Nonce: "));
      const nonceFromMsg = nonceLine?.slice("Nonce: ".length).trim();
      if (!nonceFromMsg) return new Response("Nonce missing", { status: 400 });

      // 2) Find verification value
      const v = await ctx.context.internalAdapter.findVerificationValue(`siws:${address}`);
      if (!v || new Date(v.expiresAt) <= new Date()) {
        return new Response("Nonce invalid or expired", { status: 400 });
      }

      // 3) Delete it to enforce single-use
      await ctx.context.internalAdapter.deleteVerificationByIdentifier(`siws:${address}`);

      // 4) Domain binding
      const expectedDomain = options.domain;
      if (!message.startsWith(`${expectedDomain} wants you to sign in`)) {
        return new Response("Domain mismatch", { status: 400 });
      }

      // 5) Verify ed25519 signature
      const verified = await ed25519.verifyAsync(
        bs58.decode(signature),
        new TextEncoder().encode(message),
        bs58.decode(address),
      );
      if (!verified) return new Response("Invalid signature", { status: 401 });

      // 6) Upsert user + create session
      // The account lookup differs by better-auth major-minor: 1.6 replaced
      // `findAccount(accountId)` with `findAccountByProviderId(accountId,
      // providerId)`, and 1.7 replaced THAT with `findAccountByKey({ issuer,
      // accountId })`. findSiwsAccount picks whichever the host exposes.
      const adapter = ctx.context.internalAdapter as unknown as AdapterShape;
      const accountId = buildAccountId(address);
      const existingAccount = await findSiwsAccount(adapter, accountId);

      let userObject: User;
      if (!existingAccount) {
        // createOAuthUser is `(user, account)` in >=1.6; the request context is
        // read internally via async-local-storage, so no third arg is passed.
        // `issuer` is a required column on 1.7 and an unknown one on 1.6, so it
        // is sent only when the host is on the issuer-keyed model — an unknown
        // field fails the insert on 1.6 exactly as a missing required one fails
        // on 1.7. That also means the payload cannot satisfy both type shapes at
        // compile time; the cast is scoped to this one argument and borrows the
        // installed version's own parameter type, so it still tracks upstream.
        const accountPayload = {
          providerId: SIWS_PROVIDER_ID,
          accountId,
          ...(usesIssuerIdentity(adapter) ? { issuer: SIWS_ISSUER } : {}),
        } as Parameters<typeof ctx.context.internalAdapter.createOAuthUser>[1];

        const user = await ctx.context.internalAdapter.createOAuthUser({
          email: address,
          emailVerified: true,
          name: `sol:${address.slice(0, 4)}…${address.slice(-4)}`,
        }, accountPayload);
        userObject = user!.user;
      } else {
        const user = await ctx.context.internalAdapter.findUserById(existingAccount.userId);
        userObject = user!;
      }

      // createSession is `(userId, dontRememberMe?, …)` in >=1.6. The old code
      // passed `ctx` as the 2nd arg, which read as a truthy dontRememberMe and
      // silently capped sessions at 24h. ip/userAgent come from ALS now.
      const session = await ctx.context.internalAdapter.createSession(userObject.id);
      await setSessionCookie(ctx, { session, user: userObject });

      return ctx.json({ user: userObject.id, session });
    }),
  },
} satisfies BetterAuthPlugin);

const buildAccountId = (address: string) => {
  return `siws:${address}`;
};


