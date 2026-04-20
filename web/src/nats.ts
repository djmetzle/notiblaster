import {
  connect as natsConnect,
  DeliverPolicy,
  type NatsConnection,
} from 'nats.ws';

export type Notification = {
  subject: string;
  data: string;
  receivedAt: Date;
};

const WS_URL = `ws://${window.location.hostname}:8090`;
const STREAM = 'NOTIFICATIONS';

export async function connect(): Promise<NatsConnection> {
  return await natsConnect({ servers: [WS_URL] });
}

// Ephemeral ordered JetStream consumer. Replays everything in the stream on
// connect, then live-tails new messages.
//
// Using StartSequence + opt_start_seq=1 as the "replay everything" policy.
// DeliverPolicy.All would be the obvious choice, but nats.ws 1.30 sends an
// invalid request for ordered consumers in that case (deliver_policy="all"
// alongside opt_start_seq=1), which NATS 2.12's strict JetStream mode drops
// silently — the client just hangs.
export async function* subscribeBroadcast(
  nc: NatsConnection,
): AsyncGenerator<Notification> {
  const js = nc.jetstream();
  const consumer = await js.consumers.get(STREAM, {
    filterSubjects: 'notify.broadcast',
    deliver_policy: DeliverPolicy.StartSequence,
    opt_start_seq: 1,
  });
  const messages = await consumer.consume();
  for await (const m of messages) {
    yield {
      subject: m.subject,
      data: m.string(),
      receivedAt: new Date(),
    };
  }
}
