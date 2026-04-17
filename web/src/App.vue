<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { connect, subscribeBroadcast, type Notification } from './nats';
import type { NatsConnection } from 'nats.ws';

const status = ref<'connecting' | 'connected' | 'error'>('connecting');
const errorMsg = ref<string>('');
const messages = ref<Notification[]>([]);

const subject = ref('notify.broadcast');
const messageText = ref('');
const publishing = ref(false);
const publishError = ref<string>('');

let nc: NatsConnection | null = null;

onMounted(async () => {
  try {
    nc = await connect();
    status.value = 'connected';
    (async () => {
      for await (const n of subscribeBroadcast(nc!)) {
        messages.value.unshift(n);
      }
    })();
  } catch (err) {
    status.value = 'error';
    errorMsg.value = (err as Error).message;
  }
});

onBeforeUnmount(async () => {
  if (nc) await nc.drain();
});

async function onPublish() {
  publishError.value = '';
  publishing.value = true;
  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: subject.value, message: messageText.value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    messageText.value = '';
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

    <section class="publish">
      <h2>publish</h2>
      <form @submit.prevent="onPublish">
        <label>
          subject
          <input v-model="subject" required />
        </label>
        <label>
          message
          <input v-model="messageText" required placeholder="hello, world" />
        </label>
        <button type="submit" :disabled="publishing">
          {{ publishing ? 'publishing…' : 'publish' }}
        </button>
        <p v-if="publishError" class="error">{{ publishError }}</p>
      </form>
    </section>

    <section class="messages">
      <h2>messages <small>({{ messages.length }})</small></h2>
      <p v-if="messages.length === 0" class="empty">
        waiting for messages on <code>notify.broadcast</code>…
      </p>
      <ul>
        <li v-for="(m, i) in messages" :key="i">
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
main { max-width: 720px; margin: 0 auto; padding: 2rem 1rem; }
h1 { margin: 0 0 0.25rem; }
h2 { margin-top: 2rem; border-bottom: 1px solid #30363d; padding-bottom: 0.25rem; }
.status { font-size: 0.9rem; color: #8b949e; }
.status[data-status="connected"] { color: #3fb950; }
.status[data-status="error"] { color: #f85149; }
form { display: grid; gap: 0.5rem; grid-template-columns: 1fr 2fr auto; align-items: end; }
form label { display: flex; flex-direction: column; font-size: 0.8rem; color: #8b949e; }
form input { background: #161b22; border: 1px solid #30363d; color: inherit; padding: 0.5rem; border-radius: 4px; font: inherit; }
form button { padding: 0.5rem 1rem; background: #238636; border: 0; color: white; border-radius: 4px; font: inherit; cursor: pointer; }
form button:disabled { opacity: 0.6; cursor: not-allowed; }
.error { color: #f85149; grid-column: 1 / -1; }
.messages ul { list-style: none; padding: 0; margin: 0; }
.messages li { display: grid; grid-template-columns: auto auto 1fr; gap: 0.75rem; padding: 0.5rem 0; border-bottom: 1px solid #21262d; font-size: 0.95rem; }
.messages time { color: #8b949e; font-variant-numeric: tabular-nums; }
.messages code { color: #79c0ff; }
.empty { color: #8b949e; font-style: italic; }
</style>
