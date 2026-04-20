import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { publish } from '../nats.js';

const BroadcastBody = Type.Object({
  category: Type.Union([
    Type.Literal('news'),
    Type.Literal('marketing'),
    Type.Literal('community'),
  ]),
  message: Type.String({ minLength: 1 }),
});

const UserBody = Type.Object({
  category: Type.Literal('user'),
  userId: Type.Integer({ minimum: 0 }),
  message: Type.String({ minLength: 1 }),
});

const PublishBody = Type.Union([BroadcastBody, UserBody]);

const PublishReply = Type.Object({
  ok: Type.Literal(true),
  subject: Type.String(),
  stream: Type.String(),
  seq: Type.Number(),
});

const publishRoute: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/api/publish',
    { schema: { body: PublishBody, response: { 200: PublishReply } } },
    async (req) => {
      const body = req.body;
      const subject =
        body.category === 'user'
          ? `notify.user.${body.userId}`
          : `notify.${body.category}`;
      const ack = await publish(subject, body.message);
      return { ok: true as const, subject, ...ack };
    },
  );
};

export default publishRoute;
