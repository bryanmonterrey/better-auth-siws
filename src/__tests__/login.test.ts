// verify.api.test.ts
import { betterAuth } from "better-auth";
import { buildSiwsMessage, siwsPlugin } from "../index";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

const auth = betterAuth({
  plugins: [
    siwsPlugin({
      domain: "app.example.com",
    }),
  ],
  baseURL: "http://localhost:3000/api/auth",
  security: { trustedOrigins: ["http://localhost:3000"] },
});

describe("SIWS verify (direct server API) — using @solana/web3.js", () => {
  it("returns ok on valid payload", async () => {
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
    const msgBytes = new TextEncoder().encode(message);
    const signature = bs58.encode(nacl.sign.detached(msgBytes, kp.secretKey));

    const result = await auth.api.verify({
      body: { address, message, signature },
      headers: { origin: "http://localhost:3000" },
    });

    expect(result).toEqual({
      user: expect.any(String),
      session: expect.objectContaining({
        id: expect.any(String),
        token: expect.any(String),
        userId: expect.any(String),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        expiresAt: expect.any(Date),
        ipAddress: expect.any(String),
        userAgent: expect.any(String),
      }),
    });
  });

  it("fails with invalid signature", async () => {
    // legit wallet
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();

    // start flow
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

    // attacker wallet signs instead
    const attacker = Keypair.generate();
    const fakeSignature = bs58.encode(
      nacl.sign.detached(new TextEncoder().encode(message), attacker.secretKey)
    );

    const response = await auth.api.verify({
        body: { address, message, signature: fakeSignature },
        headers: { origin: "http://localhost:3000" },
      });
    console.log(response);
    expect((response as any).status).toBe(401);
  });

  it("returns 400 (throws) on invalid payload", async () => {
    await expect(
      auth.api.verify({
        body: {},
        headers: { origin: "http://localhost:3000" },
      })
    ).rejects.toThrow();
  });

  it("can read Set-Cookie headers when needed", async () => {
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

    const { headers } = await auth.api.verify({
      body: { address, message, signature },
      headers: { origin: "http://localhost:3000" },
      returnHeaders: true,
    });

    expect(headers.get("set-cookie")).toBeTruthy();
  });
});
