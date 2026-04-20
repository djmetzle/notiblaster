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

export type Subscription = {
  subject: string;
  stop: () => Promise<void>;
};

const WS_URL = `ws://${window.location.hostname}:8090`;
const STREAM = 'NOTIFICATIONS';

export async function connect(): Promise<NatsConnection> {
  return await natsConnect({ servers: [WS_URL] });
}

// Start an ephemeral ordered JetStream consumer filtered to `subject`.
// `replay: true`  → deliver the whole stream history for that subject, then live-tail.
// `replay: false` → deliver new messages only.
//
// Note: DeliverPolicy.All with ordered consumers in nats.ws 1.30 produces an
// invalid request that NATS 2.12 drops silently; we use StartSequence+1 as the
// equivalent replay-all policy.
export async function subscribe(
  nc: NatsConnection,
  subject: string,
  opts: { replay: boolean },
  onMessage: (n: Notification) => void,
): Promise<Subscription> {
  const js = nc.jetstream();
  const consumer = await js.consumers.get(STREAM, {
    filterSubjects: subject,
    ...(opts.replay
      ? { deliver_policy: DeliverPolicy.StartSequence, opt_start_seq: 1 }
      : { deliver_policy: DeliverPolicy.New }),
  });
  const messages = await consumer.consume();

  const loop = (async () => {
    for await (const m of messages) {
      onMessage({
        subject: m.subject,
        data: m.string(),
        receivedAt: new Date(),
      });
    }
  })();

  return {
    subject,
    stop: async () => {
      messages.stop();
      await loop;
    },
  };
}
