import { createAuthEndpoint } from "better-auth/api";
import type { BetterAuthPlugin, User } from "better-auth";
import bs58 from "bs58";
import * as ed25519 from "@noble/ed25519";
import { z } from "zod/v3";
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
      await ctx.context.internalAdapter.deleteVerificationValue(`siws:${address}`);

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
      const existingAccount = await ctx.context.internalAdapter.findAccount(buildAccountId(address));

      let userObject: User;
      if (!existingAccount) {
        const user = await ctx.context.internalAdapter.createOAuthUser({
          email: address,
          emailVerified: true,
          name: `sol:${address.slice(0, 4)}…${address.slice(-4)}`,
        }, {
          providerId: "siws",
          accountId: buildAccountId(address),
        }, ctx);
        userObject = user.user;
      } else {
        const user = await ctx.context.internalAdapter.findUserById(existingAccount.userId);
        userObject = user!;
      }

      const session = await ctx.context.internalAdapter.createSession(userObject.id, ctx);
      await setSessionCookie(ctx, { session, user: userObject });

      return ctx.json({ user: userObject.id, session });
    }),
  },
} satisfies BetterAuthPlugin);

const buildAccountId = (address: string) => {
  return `siws:${address}`;
};


