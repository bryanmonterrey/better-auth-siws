import { siwsPlugin } from './index.cjs';
import 'better-call';
import 'zod';

declare const siwsClientPlugin: () => {
    id: "siws";
    $InferServerPlugin: ReturnType<typeof siwsPlugin>;
};

export { siwsClientPlugin };
