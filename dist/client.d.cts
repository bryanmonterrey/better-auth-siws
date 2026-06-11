import { siwsPlugin } from './index.cjs';
import 'better-call';
import 'zod/v3';

declare const siwsClientPlugin: () => {
    id: "siws";
    $InferServerPlugin: ReturnType<typeof siwsPlugin>;
};

export { siwsClientPlugin };
