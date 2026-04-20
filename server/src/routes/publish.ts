import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { publish } from '../nats.js';

const PublishBody = Type.Object({
  category: Type.Union([
    Type.Literal('news'),
    Type.Literal('marketing'),
    Type.Literal('community'),
    Type.Literal('user'),
  ]),
  userId: Type.Optional(Type.Integer({ minimum: 0 })),
  message: Type.String({ minLength: 1 }),
});

const PublishReply = Type.Object({
  ok: Type.Literal(true),
  subject: Type.String(),
  stream: Type.String(),
  seq: Type.Number(),
});

const ErrorReply = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  statusCode: Type.Optional(Type.Number()),
  code: Type.Optional(Type.String()),
});

const publishRoute: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/api/publish',
    {
      schema: {
        body: PublishBody,
        response: { 200: PublishReply, 400: ErrorReply },
      },
    },
    async (req, reply) => {
      const { category, userId, message } = req.body;

      if (category === 'user' && userId === undefined) {
        return reply.code(400).send({
          error: 'userId is required when category is "user"',
        });
      }

      const subject =
        category === 'user' ? `notify.user.${userId}` : `notify.${category}`;
      const ack = await publish(subject, message);
      return { ok: true as const, subject, ...ack };
    },
  );
};

export default publishRoute;
