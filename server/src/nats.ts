import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  StringCodec,
} from 'nats';

const STREAM_NAME = 'NOTIFICATIONS';
const STREAM_SUBJECTS = ['notify.>'];

const sc = StringCodec();

let nc: NatsConnection | null = null;
let js: JetStreamClient | null = null;

export async function initNats(url: string): Promise<void> {
  nc = await connect({ servers: url, name: 'notiblaster-server' });

  const jsm = await nc.jetstreamManager();
  try {
    await jsm.streams.add({ name: STREAM_NAME, subjects: STREAM_SUBJECTS });
  } catch (err) {
    // Stream may already exist from a previous run — that's fine.
    const msg = (err as Error).message ?? '';
    if (!/already in use|stream name already/.test(msg)) throw err;
  }

  js = nc.jetstream();
}

export async function publish(subject: string, message: string) {
  if (!js) throw new Error('NATS not initialized');
  const ack = await js.publish(subject, sc.encode(message));
  return { stream: ack.stream, seq: ack.seq };
}

export async function closeNats(): Promise<void> {
  if (nc) await nc.drain();
  nc = null;
  js = null;
}
