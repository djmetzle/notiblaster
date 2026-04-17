import { connect as natsConnect, type NatsConnection } from 'nats.ws';

export type Notification = {
  subject: string;
  data: string;
  receivedAt: Date;
};

const WS_URL = `ws://${window.location.hostname}:8090`;

export async function connect(): Promise<NatsConnection> {
  return await natsConnect({ servers: [WS_URL] });
}

// Core subscribe on the broadcast subject. JetStream-published messages on
// `notify.broadcast` are delivered to core subs too, so this is sufficient for
// live-only viewing. A durable JetStream consumer would be needed to replay
// messages received while offline — out of scope for this first cut.
export async function* subscribeBroadcast(
  nc: NatsConnection,
): AsyncGenerator<Notification> {
  const sub = nc.subscribe('notify.broadcast');
  for await (const msg of sub) {
    yield {
      subject: msg.subject,
      data: msg.string(),
      receivedAt: new Date(),
    };
  }
}
