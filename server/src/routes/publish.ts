import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { publish } from '../nats.js';

const PublishBody = Type.Object({
  subject: Type.String({ pattern: '^notify\\..+' }),
  message: Type.String({ minLength: 1 }),
});

const PublishReply = Type.Object({
  ok: Type.Literal(true),
  stream: Type.String(),
  seq: Type.Number(),
});

const publishRoute: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/api/publish',
    { schema: { body: PublishBody, response: { 200: PublishReply } } },
    async (req) => {
      const { subject, message } = req.body;
      const ack = await publish(subject, message);
      return { ok: true as const, ...ack };
    },
  );
};

export default publishRoute;
