import ReplicateSDK from "replicate";
import type { PostHog } from "posthog-node";
import { captureGeneration, createTimer } from "./capture.js";
import type {
  ReplicateOptions,
  RunOptions,
  StreamOptions,
  PredictionCreateOptions,
  PostHogTrackingOptions,
  ReplicateClient,
} from "./types.js";
import { POSTHOG_CONSTANTS } from "./types.js";

// Re-export types for consumers
export type {
  ReplicateOptions,
  RunOptions,
  StreamOptions,
  PredictionCreateOptions,
  PostHogTrackingOptions,
} from "./types.js";

/**
 * PostHog-instrumented wrapper for the Replicate SDK
 *
 * This class wraps the official Replicate SDK and automatically sends
 * `$ai_generation` events to PostHog for LLM analytics.
 *
 * @example
 * ```typescript
 * import { Replicate } from 'posthog-replicate';
 * import { PostHog } from 'posthog-node';
 *
 * const phClient = new PostHog('<api_key>', { host: 'https://us.i.posthog.com' });
 * const replicate = new Replicate({ posthog: phClient });
 *
 * const output = await replicate.run("openai/clip", {
 *   input: { image: "https://example.com/image.jpg" },
 *   posthogDistinctId: 'user_123',
 * });
 *
 * await phClient.shutdown();
 * ```
 */
export class Replicate {
  private client: ReplicateClient;
  private posthog: PostHog;

  /** Access to the predictions API with PostHog tracking */
  public predictions: {
    create: (options: PredictionCreateOptions) => Promise<unknown>;
    get: (id: string) => Promise<unknown>;
    cancel: (id: string) => Promise<unknown>;
    list: () => Promise<unknown>;
  };

  /** Access to the models API (passthrough, no tracking) */
  public models: ReplicateClient["models"];

  /** Access to the deployments API (passthrough, no tracking) */
  public deployments: ReplicateClient["deployments"];

  /** Access to the hardware API (passthrough, no tracking) */
  public hardware: ReplicateClient["hardware"];

  /** Access to the collections API (passthrough, no tracking) */
  public collections: ReplicateClient["collections"];

  /** Access to the webhooks API (passthrough, no tracking) */
  public webhooks: ReplicateClient["webhooks"];

  constructor(options: ReplicateOptions) {
    const { posthog, ...replicateOptions } = options;

    this.posthog = posthog;
    this.client = new ReplicateSDK(replicateOptions);

    // Set up predictions namespace with tracking
    this.predictions = {
      create: this.createPrediction.bind(this),
      get: this.client.predictions.get.bind(this.client.predictions),
      cancel: this.client.predictions.cancel.bind(this.client.predictions),
      list: this.client.predictions.list.bind(this.client.predictions),
    };

    // Pass through other namespaces without modification
    this.models = this.client.models;
    this.deployments = this.client.deployments;
    this.hardware = this.client.hardware;
    this.collections = this.client.collections;
    this.webhooks = this.client.webhooks;
  }

  /**
   * Run a model and wait for the output
   *
   * This is the primary method for running Replicate models. It automatically
   * tracks the execution with PostHog, including latency, model info, and
   * input/output (unless privacy mode is enabled).
   *
   * @param model - Model identifier (e.g., "openai/clip" or "owner/name:version")
   * @param options - Run options including input and PostHog tracking options
   * @returns The model output
   *
   * @example
   * ```typescript
   * const output = await replicate.run("openai/clip", {
   *   input: { image: "https://example.com/image.jpg" },
   *   posthogDistinctId: 'user_123',
   *   posthogTraceId: 'trace_abc',
   * });
   * ```
   */
  async run(model: `${string}/${string}` | `${string}/${string}:${string}`, options: RunOptions): Promise<unknown> {
    const {
      posthogDistinctId,
      posthogTraceId,
      posthogProperties,
      posthogGroups,
      posthogPrivacyMode,
      ...replicateOptions
    } = options;

    const getElapsed = createTimer();
    let output: unknown;
    let isError = false;
    let error: unknown;
    let httpStatus = 200;

    try {
      // Cast to satisfy the Replicate SDK's stricter types
      output = await this.client.run(model, replicateOptions as Parameters<typeof this.client.run>[1]);
    } catch (err) {
      isError = true;
      error = err;
      httpStatus = this.extractHttpStatus(err) || 500;
      throw err;
    } finally {
      const latency = getElapsed();

      captureGeneration(this.posthog, {
        model,
        latency,
        httpStatus,
        isError,
        error,
        input: replicateOptions.input,
        output,
        distinctId: posthogDistinctId,
        traceId: posthogTraceId,
        customProperties: posthogProperties,
        groups: posthogGroups,
        privacyMode: posthogPrivacyMode,
        stream: false,
      });
    }

    return output;
  }

  /**
   * Stream output from a model
   *
   * This method streams the model output as Server-Sent Events. The PostHog
   * event is captured when the stream completes or errors.
   *
   * @param model - Model identifier (e.g., "meta/llama-2-70b-chat")
   * @param options - Stream options including input and PostHog tracking options
   * @returns An async generator yielding stream events
   *
   * @example
   * ```typescript
   * const stream = replicate.stream("meta/llama-2-70b-chat", {
   *   input: { prompt: "Hello, how are you?" },
   *   posthogDistinctId: 'user_123',
   * });
   *
   * for await (const event of stream) {
   *   process.stdout.write(event.data);
   * }
   * ```
   */
  async *stream(
    model: `${string}/${string}` | `${string}/${string}:${string}`,
    options: StreamOptions
  ): AsyncGenerator<{ event: string; data: string; id?: string }> {
    const {
      posthogDistinctId,
      posthogTraceId,
      posthogProperties,
      posthogGroups,
      posthogPrivacyMode,
      ...replicateOptions
    } = options;

    const getElapsed = createTimer();
    let collectedOutput = "";
    let isError = false;
    let error: unknown;
    let httpStatus = 200;

    try {
      const stream = this.client.stream(model, replicateOptions);

      for await (const event of stream) {
        // Collect output for tracking
        if (event.event === "output") {
          collectedOutput += event.data;
        }
        yield event;
      }
    } catch (err) {
      isError = true;
      error = err;
      httpStatus = this.extractHttpStatus(err) || 500;
      throw err;
    } finally {
      const latency = getElapsed();

      captureGeneration(this.posthog, {
        model,
        latency,
        httpStatus,
        isError,
        error,
        input: replicateOptions.input,
        output: collectedOutput || undefined,
        distinctId: posthogDistinctId,
        traceId: posthogTraceId,
        customProperties: posthogProperties,
        groups: posthogGroups,
        privacyMode: posthogPrivacyMode,
        stream: true,
      });
    }
  }

  /**
   * Create a prediction (async, doesn't wait for completion)
   *
   * This method creates a prediction and returns immediately. The PostHog
   * event is captured when the prediction is created, not when it completes.
   *
   * @param options - Prediction options including model/version and input
   * @returns The created prediction object
   */
  private async createPrediction(options: PredictionCreateOptions): Promise<unknown> {
    const {
      posthogDistinctId,
      posthogTraceId,
      posthogProperties,
      posthogGroups,
      posthogPrivacyMode,
      ...replicateOptions
    } = options;

    const getElapsed = createTimer();
    let prediction: Record<string, unknown> | undefined;
    let isError = false;
    let error: unknown;
    let httpStatus = 200;

    try {
      const result = await this.client.predictions.create(replicateOptions as Parameters<typeof this.client.predictions.create>[0]);
      prediction = result as unknown as Record<string, unknown>;
      return result;
    } catch (err) {
      isError = true;
      error = err;
      httpStatus = this.extractHttpStatus(err) || 500;
      throw err;
    } finally {
      const latency = getElapsed();

      // For predictions.create, we track the creation, not completion
      // The model is either from options.model or derived from options.version
      const model = replicateOptions.model || replicateOptions.version || "unknown";

      captureGeneration(this.posthog, {
        model: String(model),
        latency,
        httpStatus,
        isError,
        error,
        input: replicateOptions.input,
        // Output is not available yet for async predictions
        output: undefined,
        distinctId: posthogDistinctId,
        traceId: posthogTraceId,
        customProperties: {
          ...posthogProperties,
          // Mark this as an async prediction creation
          $ai_async_prediction: true,
        },
        groups: posthogGroups,
        privacyMode: posthogPrivacyMode,
        predictionId: prediction?.id as string | undefined,
      });
    }
  }

  /**
   * Extract HTTP status code from an error
   */
  private extractHttpStatus(err: unknown): number | undefined {
    if (err && typeof err === "object") {
      const errorObj = err as Record<string, unknown>;
      if (typeof errorObj.status === "number") {
        return errorObj.status;
      }
      if (typeof errorObj.statusCode === "number") {
        return errorObj.statusCode;
      }
      // Replicate errors often have a response object
      if (errorObj.response && typeof errorObj.response === "object") {
        const response = errorObj.response as Record<string, unknown>;
        if (typeof response.status === "number") {
          return response.status;
        }
      }
    }
    return undefined;
  }
}

// Default export for convenience
export default Replicate;
