declare module 'better-auth-siws' {
  export interface SiwsOptions {
    domain: string;
    statement?: string;
    nonceTtlSeconds?: number;
  }

  export function siwsPlugin(options: SiwsOptions): any;

  export function buildSiwsMessage(input: {
    domain: string;
    address: string;
    uri: string;
    statement?: string;
    nonce: string;
    issuedAt: string;
    expirationTime?: string;
    resources?: string[];
  }): string;
}

declare module 'better-auth-siws/client' {
  export function siwsClientPlugin(): any;
}

declare module 'better-auth-siws/server' {
  export function siwsPlugin(options: any): any;
}
