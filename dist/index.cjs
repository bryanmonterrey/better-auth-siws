var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  buildSiwsMessage: () => buildSiwsMessage,
  siwsPlugin: () => siwsPlugin
});
module.exports = __toCommonJS(index_exports);
var import_api = require("better-auth/api");
var import_bs58 = __toESM(require("bs58"), 1);
var ed25519 = __toESM(require("@noble/ed25519"), 1);
var import_v3 = require("zod/v3");
var import_cookies = require("better-auth/cookies");
function buildSiwsMessage(i) {
  const lines = [
    `${i.domain} wants you to sign in with your Solana account:`,
    `${i.address}`,
    "",
    i.statement ?? "Sign in with Solana to the app.",
    "",
    `URI: ${i.uri}`,
    `Version: 1`,
    `Nonce: ${i.nonce}`,
    `Issued At: ${i.issuedAt}`
  ];
  if (i.expirationTime) lines.push(`Expiration Time: ${i.expirationTime}`);
  if (i.resources?.length) lines.push(`Resources:
- ${i.resources.join("\n- ")}`);
  return lines.join("\n");
}
var siwsPlugin = (options) => ({
  id: "siws",
  endpoints: {
    // POST /siws/start -> { nonce, domain, uri }
    start: (0, import_api.createAuthEndpoint)("/siws/start", {
      method: "POST",
      body: import_v3.z.object({
        address: import_v3.z.string().min(32)
      })
    }, async (ctx) => {
      const { address } = ctx.body;
      const nonce = import_bs58.default.encode(crypto.getRandomValues(new Uint8Array(16)));
      const expiresAt = new Date(
        Date.now() + (options.nonceTtlSeconds ?? 300) * 1e3
      );
      await ctx.context.internalAdapter.createVerificationValue({
        identifier: `siws:${address}`,
        value: nonce,
        expiresAt
      });
      return ctx.json({
        nonce,
        domain: options.domain,
        uri: ctx.context.baseURL
      });
    }),
    // POST /siws/verify -> verify signature, bind domain, upsert user, create session
    verify: (0, import_api.createAuthEndpoint)("/siws/verify", {
      method: "POST",
      body: import_v3.z.object({
        address: import_v3.z.string().min(32),
        message: import_v3.z.string(),
        signature: import_v3.z.string()
      })
    }, async (ctx) => {
      const { address, message, signature } = ctx.body;
      const nonceLine = message.split("\n").find((l) => l.startsWith("Nonce: "));
      const nonceFromMsg = nonceLine?.slice("Nonce: ".length).trim();
      if (!nonceFromMsg) return new Response("Nonce missing", { status: 400 });
      const v = await ctx.context.internalAdapter.findVerificationValue(`siws:${address}`);
      if (!v || new Date(v.expiresAt) <= /* @__PURE__ */ new Date()) {
        return new Response("Nonce invalid or expired", { status: 400 });
      }
      await ctx.context.internalAdapter.deleteVerificationByIdentifier(`siws:${address}`);
      const expectedDomain = options.domain;
      if (!message.startsWith(`${expectedDomain} wants you to sign in`)) {
        return new Response("Domain mismatch", { status: 400 });
      }
      const verified = await ed25519.verifyAsync(
        import_bs58.default.decode(signature),
        new TextEncoder().encode(message),
        import_bs58.default.decode(address)
      );
      if (!verified) return new Response("Invalid signature", { status: 401 });
      const existingAccount = await ctx.context.internalAdapter.findAccount(buildAccountId(address));
      let userObject;
      if (!existingAccount) {
        const user = await ctx.context.internalAdapter.createOAuthUser({
          email: address,
          emailVerified: true,
          name: `sol:${address.slice(0, 4)}\u2026${address.slice(-4)}`
        }, {
          providerId: "siws",
          accountId: buildAccountId(address)
        }, ctx);
        userObject = user.user;
      } else {
        const user = await ctx.context.internalAdapter.findUserById(existingAccount.userId);
        userObject = user;
      }
      const session = await ctx.context.internalAdapter.createSession(userObject.id, ctx);
      await (0, import_cookies.setSessionCookie)(ctx, { session, user: userObject });
      return ctx.json({ user: userObject.id, session });
    })
  }
});
var buildAccountId = (address) => {
  return `siws:${address}`;
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildSiwsMessage,
  siwsPlugin
});
//# sourceMappingURL=index.cjs.map