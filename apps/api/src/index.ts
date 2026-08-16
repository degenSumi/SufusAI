import { app } from "./app.js";

// Vercel's entrypoint search hits src/index before src/server, so the handler
// lives here. Must stay side-effect free — apps/web imports AppType from it.
export default app;

export { app, type AppType } from "./app.js";
export type { SupportUIMessage } from "./types/ui-message.js";
