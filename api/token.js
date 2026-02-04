import { AccessToken } from 'livekit-server-sdk';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { livekitUrl } = req.body;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    const participantName = 'User-' + Math.floor(Math.random() * 10000);
    const at = new AccessToken(apiKey, apiSecret, {
        identity: participantName,
        ttl: '10m',
    });

    at.addGrant({ roomJoin: true, room: 'appointment-room', canPublish: true, canSubscribe: true });

    const token = await at.toJwt();

    res.status(200).json({ token, identity: participantName, room: 'appointment-room' });
}
