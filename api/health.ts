export default async function handler(_: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): Promise<void> {
  res.status(200).json({
    status: 'ok',
    service: 'ritty-ai-vercel',
    time: new Date().toISOString(),
  });
}
