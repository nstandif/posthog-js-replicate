import ReplicateOriginal from "replicate";
import type { PostHog } from "posthog-node";
import { captureGeneration, createTimer } from "./capture.js";
import type {
  ReplicateOptions,
  RunOptions,
  StreamOptions,
  PredictionCreateOptions,
  PredictionGetOptions,
  PostHogTrackingOptions,
} from "./types.js";

/**
 * Extracts PostHog tracking options from combined options object
 * Returns the PostHog params and the remaining Replicate options
 */
function extractPostHogParams<T extends PostHogTrackingOptions>(
  options: T
): {
  posthogParams: PostHogTrackingOptions;
  replicateOptions: Omit<T, keyof PostHogTrackingOptions>;
} {
  const {
    posthogDistinctId,
    posthogTraceId,
    posthogProperties,
    posthogGroups,
    posthogPrivacyMode,
    ...replicateOptions
  } = options;

  return {
    posthogParams: {
      posthogDistinctId,
      posthogTraceId,
      posthogProperties,
      posthogGroups,
      posthogPrivacyMode,
    },
    replicateOptions: replicateOptions as Omit<T, keyof PostHogTrackingOptions>,
  };
}

// Re-export types for consumers
export type {
  ReplicateOptions,
  RunOptions,
  StreamOptions,
  PredictionCreateOptions,
  PredictionGetOptions,
  PostHogTrackingOptions,
} from "./types.js";

/**
 * PostHog-instrumented extension of the Replicate SDK
 *
 * This class extends the official Replicate SDK and automatically sends
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
export class PostHogReplicate extends ReplicateOriginal {
  private posthog: PostHog;
  private originalPredictionsCreate: ReplicateOriginal["predictions"]["create"];
  private originalPredictionsGet: ReplicateOriginal["predictions"]["get"];
  /** Map prediction IDs to their PostHog tracking params from create() */
  private predictionTrackingParams: Map<string, PostHogTrackingOptions> = new Map();

  constructor(options: ReplicateOptions) {
    const { posthog, ...replicateOptions } = options;
    super(replicateOptions);
    this.posthog = posthog;

    // Store references to original predictions methods before wrapping
    this.originalPredictionsCreate = this.predictions.create.bind(this.predictions);
    this.originalPredictionsGet = this.predictions.get.bind(this.predictions);

    // Wrap predictions methods with PostHog tracking
    const self = this;
    const wrappedCreate = (options: PredictionCreateOptions) => self.createPrediction(options);
    const wrappedGet = (predictionId: string, options?: PredictionGetOptions) => self.getPrediction(predictionId, options);
    (this.predictions as Record<string, unknown>).create = wrappedCreate;
    (this.predictions as Record<string, unknown>).get = wrappedGet;
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
  override async run(model: `${string}/${string}` | `${string}/${string}:${string}`, options: RunOptions): Promise<object> {
    const { posthogParams, replicateOptions } = extractPostHogParams(options);

    const getElapsed = createTimer();
    let output: object | undefined;
    let isError = false;
    let error: unknown;
    let httpStatus = 200;

    try {
      // Call parent class run method
      output = await super.run(model, replicateOptions as Parameters<ReplicateOriginal["run"]>[1]);
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
        distinctId: posthogParams.posthogDistinctId,
        traceId: posthogParams.posthogTraceId,
        customProperties: posthogParams.posthogProperties,
        groups: posthogParams.posthogGroups,
        privacyMode: posthogParams.posthogPrivacyMode,
        stream: false,
      });
    }

    return output as object;
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
  override async *stream(
    model: `${string}/${string}` | `${string}/${string}:${string}`,
    options: StreamOptions
  ): AsyncGenerator<{ event: string; data: string; id?: string }> {
    const { posthogParams, replicateOptions } = extractPostHogParams(options);

    const getElapsed = createTimer();
    let collectedOutput = "";
    let isError = false;
    let error: unknown;
    let httpStatus = 200;

    try {
      const stream = super.stream(model, replicateOptions);

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
        distinctId: posthogParams.posthogDistinctId,
        traceId: posthogParams.posthogTraceId,
        customProperties: posthogParams.posthogProperties,
        groups: posthogParams.posthogGroups,
        privacyMode: posthogParams.posthogPrivacyMode,
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
    const { posthogParams, replicateOptions } = extractPostHogParams(options);

    const getElapsed = createTimer();
    let prediction: Record<string, unknown> | undefined;
    let isError = false;
    let error: unknown;
    let httpStatus = 200;

    try {
      const result = await this.originalPredictionsCreate(replicateOptions as Parameters<ReplicateOriginal["predictions"]["create"]>[0]);
      prediction = result as unknown as Record<string, unknown>;

      // Store tracking params for later predictions.get() calls
      const predictionId = prediction?.id as string | undefined;
      if (predictionId && Object.values(posthogParams).some(v => v !== undefined)) {
        this.predictionTrackingParams.set(predictionId, posthogParams);
      }

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
        distinctId: posthogParams.posthogDistinctId,
        traceId: posthogParams.posthogTraceId,
        customProperties: {
          ...posthogParams.posthogProperties,
          // Mark this as an async prediction creation
          $ai_async_prediction: true,
        },
        groups: posthogParams.posthogGroups,
        privacyMode: posthogParams.posthogPrivacyMode,
        predictionId: prediction?.id as string | undefined,
      });
    }
  }

  /**
   * Get a prediction by ID
   *
   * This method retrieves a prediction's current status. When the prediction
   * is complete (status: "succeeded"), the PostHog event captures the output.
   *
   * @param predictionId - The prediction ID to retrieve
   * @param options - Optional settings including PostHog tracking options
   * @returns The prediction object
   */
  private async getPrediction(predictionId: string, options?: PredictionGetOptions): Promise<unknown> {
    // Merge stored params from create() with any provided options (provided options take precedence)
    const storedParams = this.predictionTrackingParams.get(predictionId) || {};
    const providedParams = options ? extractPostHogParams(options).posthogParams : {};
    const posthogParams: PostHogTrackingOptions = { ...storedParams, ...providedParams };
    const replicateOptions = options ? { signal: options.signal } : undefined;

    const getElapsed = createTimer();
    let prediction: Record<string, unknown> | undefined;
    let isError = false;
    let error: unknown;
    let httpStatus = 200;

    try {
      const result = await this.originalPredictionsGet(predictionId, replicateOptions);
      prediction = result as unknown as Record<string, unknown>;
      return result;
    } catch (err) {
      isError = true;
      error = err;
      httpStatus = this.extractHttpStatus(err) || 500;
      throw err;
    } finally {
      const latency = getElapsed();

      // Extract model info from prediction if available
      const model = prediction?.model as string || prediction?.version as string || "unknown";
      const status = prediction?.status as string;
      const isCompleted = status === "succeeded" || status === "failed" || status === "canceled";

      // Clean up stored params when prediction completes
      if (isCompleted) {
        this.predictionTrackingParams.delete(predictionId);
      }

      captureGeneration(this.posthog, {
        model: String(model),
        latency,
        httpStatus,
        isError: isError || status === "failed",
        error: error || (status === "failed" ? prediction?.error : undefined),
        input: prediction?.input,
        // Only include output if prediction completed successfully
        output: status === "succeeded" ? prediction?.output : undefined,
        distinctId: posthogParams.posthogDistinctId,
        traceId: posthogParams.posthogTraceId,
        customProperties: {
          ...posthogParams.posthogProperties,
          $ai_prediction_status: status,
          $ai_prediction_get: true,
          $ai_prediction_completed: isCompleted,
        },
        groups: posthogParams.posthogGroups,
        privacyMode: posthogParams.posthogPrivacyMode,
        predictionId,
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

// Export PostHogReplicate as Replicate for drop-in compatibility
export { PostHogReplicate as Replicate };

// Default export for convenience
export default PostHogReplicate;
