import { AccessToken } from "livekit-server-sdk";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), "../voice-agent-backend/.env") });

const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
const defaultRoom = process.env.LIVEKIT_ROOM ?? "test-room";
const defaultIdentity = process.env.LIVEKIT_IDENTITY ?? "tester";

type TokenRequest = {
  method?: string;
  body?: {
    livekitUrl?: string;
  };
};

type TokenResponse = {
  status: (code: number) => TokenResponse;
  send: (body: string) => void;
  json: (body: unknown) => void;
};

export default async function handler(req: TokenRequest, res: TokenResponse) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  if (!apiKey || !apiSecret) {
    res.status(500).send("Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET");
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
  res.status(200).json({ token: jwt, identity: defaultIdentity, room: defaultRoom });
}
