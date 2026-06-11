import * as better_call from 'better-call';
import { z } from 'zod/v3';

interface SiwsOptions {
    domain: string;
    statement?: string;
    nonceTtlSeconds?: number;
}
declare function buildSiwsMessage(i: {
    domain: string;
    address: string;
    uri: string;
    statement?: string;
    nonce: string;
    issuedAt: string;
    expirationTime?: string;
    resources?: string[];
}): string;
declare const siwsPlugin: (options: SiwsOptions) => {
    id: "siws";
    endpoints: {
        start: better_call.StrictEndpoint<"/siws/start", {
            method: "POST";
            body: z.ZodObject<{
                address: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                address?: string;
            }, {
                address?: string;
            }>;
        }, {
            nonce: string;
            domain: string;
            uri: string;
        }>;
        verify: better_call.StrictEndpoint<"/siws/verify", {
            method: "POST";
            body: z.ZodObject<{
                address: z.ZodString;
                message: z.ZodString;
                signature: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                message?: string;
                address?: string;
                signature?: string;
            }, {
                message?: string;
                address?: string;
                signature?: string;
            }>;
        }, Response | {
            user: string;
            session: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                userId: string;
                expiresAt: Date;
                token: string;
                ipAddress?: string;
                userAgent?: string;
            };
        }>;
    };
};

export { type SiwsOptions, buildSiwsMessage, siwsPlugin };
