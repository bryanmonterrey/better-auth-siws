import type { BetterAuthClientPlugin } from "better-auth/client";
import { siwsPlugin } from "./index";

export const siwsClientPlugin = () =>
({
  id: "siws",
  $InferServerPlugin: {} as ReturnType<typeof siwsPlugin>,
} satisfies BetterAuthClientPlugin);


