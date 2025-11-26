# posthog-replicate

PostHog LLM observability for the Replicate SDK. Drop-in replacement that automatically tracks all your AI model calls.

## Install

```bash
npm install posthog-replicate posthog-node
```

## Usage

```typescript
import { Replicate } from 'posthog-replicate';
import { PostHog } from 'posthog-node';

const posthog = new PostHog('<your-api-key>');
const replicate = new Replicate({ posthog });

const output = await replicate.run('stability-ai/sdxl', {
  input: { prompt: 'A sunset over mountains' },
  posthogDistinctId: 'user_123'
});

await posthog.shutdown();
```

Every call sends a `$ai_generation` event to PostHog with model, latency, and input/output.

## What's Tracked

- `run()` - full execution with output
- `stream()` - streaming responses
- `predictions.create()` - async prediction creation

## What's Not Tracked

- `predictions.get()`, `predictions.list()`, `predictions.cancel()`
- `models.*`, `deployments.*`, `hardware.*` and other non-generation methods

## Caveats

- **Call `posthog.shutdown()`** before your app exits to flush pending events
- **Input/output is tracked by default** - use `posthogPrivacyMode: true` to disable
- **Requires Node.js 20+**
