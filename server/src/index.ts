import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { initNats, closeNats } from './nats.js';
import publishRoute from './routes/publish.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';
const PORT = Number(process.env.PORT ?? 3000);
// server/src/index.ts and server/dist/index.js both sit two levels below the
// workspace root, so ../public resolves to server/public in both dev and build.
const STATIC_DIR = resolve(__dirname, '../public');

async function main() {
  const app = Fastify({ logger: true }).withTypeProvider<TypeBoxTypeProvider>();

  await initNats(NATS_URL);
  await app.register(publishRoute);

  if (existsSync(STATIC_DIR)) {
    await app.register(fastifyStatic, { root: STATIC_DIR });
    app.log.info({ staticDir: STATIC_DIR }, 'serving static assets');
  } else {
    app.log.warn(
      { staticDir: STATIC_DIR },
      'static dir not found — run `pnpm -F web build` or use the Vite dev server',
    );
  }

  const shutdown = async () => {
    app.log.info('shutting down');
    await app.close();
    await closeNats();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ host: '0.0.0.0', port: PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
