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
  <header class="container">
    <h1>Notiblaster</h1>
    <p>
      <small>
        NATS: {{ status }}<span v-if="errorMsg"> — {{ errorMsg }}</span>
      </small>
    </p>
  </header>
  <main class="container">
    <article>
      <h2>Identity</h2>
      <label>
        My userid
        <input
          v-model="userIdInput"
          type="number"
          min="0"
          step="1"
          placeholder="e.g. 42"
          aria-describedby="userid-help"
          :aria-invalid="
            userIdInput !== '' && parseUserId(userIdInput) === null
              ? 'true'
              : undefined
          "
        />
      </label>
      <small
        id="userid-help"
        v-if="userIdInput !== '' && parseUserId(userIdInput) === null"
      >
        Must be a non-negative integer.
      </small>
      <small id="userid-help" v-else-if="activeSubs.has('user')">
        Subscribed to <code>notify.user.{{ parseUserId(userIdInput) }}</code>
        (with replay).
      </small>
    </article>

    <article>
      <h2>Subscriptions</h2>
      <fieldset class="grid">
        <label v-for="cat in BROADCAST_CATEGORIES" :key="cat">
          <input type="checkbox" v-model="toggles[cat]" />
          {{ cat }}
        </label>
      </fieldset>
      <footer>
        <small>
          Broadcast categories deliver new messages only; your user inbox
          replays history on subscribe.
        </small>
      </footer>
    </article>

    <article>
      <h2>Publish</h2>
      <form @submit.prevent="onPublish">
        <fieldset class="grid">
          <label>
            To
            <select v-model="publishCategory">
              <option value="news">News</option>
              <option value="marketing">Marketing</option>
              <option value="community">Community</option>
              <option value="user">User</option>
            </select>
          </label>
          <label v-show="publishCategory === 'user'">
            Target userid
            <input
              v-model="publishUserId"
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 42"
            />
          </label>
        </fieldset>
        <label>
          Message
          <input
            v-model="publishMessage"
            required
            placeholder="hello…"
            aria-describedby="publish-error"
          />
        </label>
        <small v-if="publishError" id="publish-error" role="alert">
          {{ publishError }}
        </small>
        <button type="submit" :aria-busy="publishing" :disabled="publishing">
          {{ publishing ? 'Publishing…' : 'Publish' }}
        </button>
      </form>
    </article>

    <article>
      <h2>Messages <small>({{ messages.length }})</small></h2>
      <p v-if="messages.length === 0">
        <small>
          Toggle a category or set your userid to start receiving.
        </small>
      </p>
      <table v-else class="striped">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Subject</th>
            <th scope="col">Message</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in messages" :key="m.seq">
            <td><time>{{ m.receivedAt.toLocaleTimeString() }}</time></td>
            <td><code>{{ m.subject }}</code></td>
            <td>{{ m.data }}</td>
          </tr>
        </tbody>
      </table>
    </article>
  </main>
</template>
