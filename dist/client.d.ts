import { siwsPlugin } from './index.js';
import 'better-call';
import 'zod';

declare const siwsClientPlugin: () => {
    id: "siws";
    $InferServerPlugin: ReturnType<typeof siwsPlugin>;
};

export { siwsClientPlugin };
