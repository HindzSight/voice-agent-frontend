import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "module";
import { resolve } from "path";

const require = createRequire(import.meta.url);
const { config } = require("dotenv");

config({ path: resolve(process.cwd(), "../voice-agent-backend/.env") });

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "livekit-token-dev",
      configureServer(server) {
        server.middlewares.use("/api/token", async (req, res) => {
          const { AccessToken } = require("livekit-server-sdk");
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method not allowed");
            return;
          }

          const apiKey = process.env.LIVEKIT_API_KEY;
          const apiSecret = process.env.LIVEKIT_API_SECRET;
          const defaultRoom = process.env.LIVEKIT_ROOM ?? "test-room";
          const defaultIdentity = process.env.LIVEKIT_IDENTITY ?? "tester";

          if (!apiKey || !apiSecret) {
            res.statusCode = 500;
            res.end("Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET");
            return;
          }

          const token = new AccessToken(apiKey, apiSecret, {
            identity: defaultIdentity,
            ttl: "1h",
          });

          token.addGrant({
            roomJoin: true,
            room: defaultRoom,
            canPublish: true,
            canSubscribe: true,
            agent: true,
          });

          const jwt = await token.toJwt();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ token: jwt, identity: defaultIdentity, room: defaultRoom }));
        });

      },
    },
  ],
});
