<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { connect, subscribe, type Notification, type Subscription } from './nats';
import type { NatsConnection } from 'nats.ws';

type BroadcastCategory = 'news' | 'marketing' | 'community';
type PublishCategory = BroadcastCategory | 'user';

const BROADCAST_CATEGORIES: BroadcastCategory[] = ['news', 'marketing', 'community'];

const status = ref<'connecting' | 'connected' | 'error'>('connecting');
const errorMsg = ref('');
const messages = ref<Notification[]>([]);

const toggles = reactive<Record<BroadcastCategory, boolean>>({
  news: false,
  marketing: false,
  community: false,
});

// Vue's v-model on <input type="number"> may yield either a string (empty)
// or a number, so we pass through parseUserId, which accepts both.
const userIdInput = ref<string | number>('');

const publishCategory = ref<PublishCategory>('news');
const publishUserId = ref<string | number>('');
const publishMessage = ref('');
const publishing = ref(false);
const publishError = ref('');

let nc: NatsConnection | null = null;
const subs = new Map<string, Subscription>();
const activeSubs = reactive(new Set<string>());

// Every JetStream message has a stream-wide seq. Using it as a dedup key means
// re-subscribing (e.g. switching back to a previously-viewed userid) replays
// without producing duplicate rows.
const seenSeqs = new Set<number>();

const onMessage = (n: Notification) => {
  if (seenSeqs.has(n.seq)) return;
  seenSeqs.add(n.seq);
  messages.value.unshift(n);
};

function parseUserId(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

async function addSub(key: string, subject: string, replay: boolean) {
  if (!nc) return;
  const existing = subs.get(key);
  if (existing) await existing.stop();
  const s = await subscribe(nc, subject, { replay }, onMessage);
  subs.set(key, s);
  activeSubs.add(key);
}

async function removeSub(key: string) {
  const s = subs.get(key);
  if (!s) return;
  subs.delete(key);
  activeSubs.delete(key);
  await s.stop();
}

onMounted(async () => {
  try {
    nc = await connect();
    status.value = 'connected';

    for (const cat of BROADCAST_CATEGORIES) {
      watch(
        () => toggles[cat],
        async (on) => {
          if (on) await addSub(cat, `notify.${cat}`, false);
          else await removeSub(cat);
        },
      );
    }

    watch(userIdInput, async (raw) => {
      const id = parseUserId(raw);
      if (id === null) {
        await removeSub('user');
      } else {
        await addSub('user', `notify.user.${id}`, true);
      }
    });
  } catch (err) {
    status.value = 'error';
    errorMsg.value = (err as Error).message;
  }
});

onBeforeUnmount(async () => {
  for (const s of subs.values()) await s.stop();
  subs.clear();
  if (nc) await nc.drain();
});

async function onPublish() {
  publishError.value = '';
  publishing.value = true;
  try {
    const body: Record<string, unknown> = {
      category: publishCategory.value,
      message: publishMessage.value,
    };
    if (publishCategory.value === 'user') {
      const id = parseUserId(publishUserId.value);
      if (id === null) throw new Error('target userid must be a non-negative integer');
      body.userId = id;
    }
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
    }
    publishMessage.value = '';
  } catch (err) {
    publishError.value = (err as Error).message;
  } finally {
    publishing.value = false;
  }
}
</script>

<template>
  <main>
    <header>
      <h1>notiblaster</h1>
      <p class="status" :data-status="status">
        NATS: {{ status }}<span v-if="errorMsg"> — {{ errorMsg }}</span>
      </p>
    </header>

    <section>
      <h2>identity</h2>
      <label class="row">
        my userid
        <input
          v-model="userIdInput"
          type="number"
          min="0"
          step="1"
          placeholder="e.g. 42"
        />
        <span
          v-if="userIdInput !== '' && parseUserId(userIdInput) === null"
          class="error"
        >
          must be a non-negative integer
        </span>
        <span v-else-if="activeSubs.has('user')" class="muted">
          subscribed to notify.user.{{ parseUserId(userIdInput) }} (with replay)
        </span>
      </label>
    </section>

    <section>
      <h2>subscriptions</h2>
      <div class="toggles">
        <label v-for="cat in BROADCAST_CATEGORIES" :key="cat">
          <input type="checkbox" v-model="toggles[cat]" />
          {{ cat }}
        </label>
      </div>
      <p class="muted">broadcast categories are new-only; your user inbox replays history.</p>
    </section>

    <section>
      <h2>publish</h2>
      <form @submit.prevent="onPublish" class="publish-form">
        <label class="to-field">
          to
          <select v-model="publishCategory">
            <option value="news">News</option>
            <option value="marketing">Marketing</option>
            <option value="community">Community</option>
            <option value="user">User</option>
          </select>
        </label>
        <label class="target-userid" v-show="publishCategory === 'user'">
          userid
          <input
            v-model="publishUserId"
            type="number"
            min="0"
            step="1"
            placeholder="target userid"
          />
        </label>
        <label class="message-field">
          message
          <input v-model="publishMessage" required placeholder="hello…" />
        </label>
        <button class="publish-btn" type="submit" :disabled="publishing">
          {{ publishing ? 'publishing…' : 'publish' }}
        </button>
        <p v-if="publishError" class="error">{{ publishError }}</p>
      </form>
    </section>

    <section>
      <h2>messages <small>({{ messages.length }})</small></h2>
      <p v-if="messages.length === 0" class="muted">
        toggle a category or set your userid to start receiving.
      </p>
      <ul>
        <li v-for="m in messages" :key="m.seq">
          <time>{{ m.receivedAt.toLocaleTimeString() }}</time>
          <code>{{ m.subject }}</code>
          <span>{{ m.data }}</span>
        </li>
      </ul>
    </section>
  </main>
</template>

<style>
body { font-family: system-ui, sans-serif; margin: 0; background: #0e1116; color: #e6edf3; }
main { max-width: 760px; margin: 0 auto; padding: 2rem 1rem; }
h1 { margin: 0 0 0.25rem; }
h2 { margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #30363d; padding-bottom: 0.25rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; }
.status { font-size: 0.9rem; color: #8b949e; margin: 0 0 1rem; }
.status[data-status="connected"] { color: #3fb950; }
.status[data-status="error"] { color: #f85149; }
.row { display: flex; align-items: center; gap: 0.75rem; font-size: 0.9rem; color: #8b949e; }
input, select { background: #161b22; border: 1px solid #30363d; color: inherit; padding: 0.4rem 0.5rem; border-radius: 4px; font: inherit; }
input[type=number] { width: 8rem; }
.toggles { display: flex; gap: 1.25rem; }
.toggles label { display: flex; align-items: center; gap: 0.4rem; color: #e6edf3; text-transform: capitalize; cursor: pointer; }
.muted { color: #8b949e; font-size: 0.85rem; margin: 0.5rem 0 0; }
.error { color: #f85149; font-size: 0.85rem; }
.publish-form {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  grid-template-areas:
    "to user message button"
    "err err err err";
  gap: 0.75rem;
  align-items: end;
}
.publish-form label { display: flex; flex-direction: column; font-size: 0.75rem; color: #8b949e; gap: 0.2rem; }
.publish-form .to-field { grid-area: to; }
.publish-form .target-userid { grid-area: user; }
.publish-form .message-field { grid-area: message; min-width: 0; }
.publish-form .message-field input { width: 100%; }
.publish-form .publish-btn { grid-area: button; padding: 0.5rem 1rem; background: #238636; border: 0; color: white; border-radius: 4px; font: inherit; cursor: pointer; height: 2.1rem; }
.publish-form .publish-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.publish-form .error { grid-area: err; margin: 0; }
ul { list-style: none; padding: 0; margin: 0; }
li { display: grid; grid-template-columns: auto auto 1fr; gap: 0.75rem; padding: 0.5rem 0; border-bottom: 1px solid #21262d; font-size: 0.95rem; }
time { color: #8b949e; font-variant-numeric: tabular-nums; }
code { color: #79c0ff; }
</style>
