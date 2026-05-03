import { Redis } from '@upstash/redis';

const KEY = 'paycheck-tracker:state';

export default async function handler(req, res) {
  const password = process.env.STATE_PASSWORD;
  if (!password) {
    return res.status(500).json({ error: 'STATE_PASSWORD not configured' });
  }
  const auth = req.headers['x-auth'];
  if (auth !== password) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let redis;
  try {
    redis = Redis.fromEnv();
  } catch (e) {
    return res.status(500).json({ error: 'redis not configured', detail: String(e) });
  }

  try {
    if (req.method === 'GET') {
      const data = await redis.get(KEY);
      if (data == null) return res.status(204).end();
      return res.status(200).json(data);
    }
    if (req.method === 'PUT') {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'invalid body' });
      }
      const updatedAt = Date.now();
      const stored = { ...body, _updatedAt: updatedAt };
      await redis.set(KEY, stored);
      return res.status(200).json({ ok: true, updatedAt });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'internal', detail: String(e) });
  }
}
