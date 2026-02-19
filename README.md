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
- `predictions.get()` - prediction status polling (captures output when complete)
- `deployments.predictions.create()` - deployment prediction creation

### Async Predictions

Tracking options are automatically linked between `create()` and `get()` calls:

```typescript
// Pass tracking options once at creation
const prediction = await replicate.predictions.create({
  model: 'stability-ai/sdxl',
  input: { prompt: 'A sunset' },
  posthogDistinctId: 'user_123'
});

// Options are automatically inherited - no need to pass them again
const result = await replicate.predictions.get(prediction.id);
```

### Deployments

Predictions created through deployments are tracked the same way:

```typescript
const prediction = await replicate.deployments.predictions.create(
  'your-org',
  'your-deployment',
  {
    input: { prompt: 'A sunset' },
    posthogDistinctId: 'user_123'
  }
);

// predictions.get() auto-links tracking params from the create call
const result = await replicate.predictions.get(prediction.id);
```

Deployment events include `$ai_is_deployment: true` and use `owner/name` as the model identifier.

## What's Not Tracked

- `predictions.list()`, `predictions.cancel()`
- `models.*`, `hardware.*` and other non-generation methods

## Caveats

- **Call `posthog.shutdown()`** before your app exits to flush pending events
- **Input/output is tracked by default** - use `posthogPrivacyMode: true` to disable
- **Requires Node.js 20+**
