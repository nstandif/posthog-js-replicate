import type { PostHog } from "posthog-node";

/**
 * PostHog-specific options that can be passed to any wrapped method
 */
export interface PostHogTrackingOptions {
  /** The distinct ID to associate with this event (usually user ID) */
  posthogDistinctId?: string;
  /** A trace ID to group related AI events together */
  posthogTraceId?: string;
  /** Custom properties to include in the PostHog event */
  posthogProperties?: Record<string, unknown>;
  /** Group identifiers for PostHog group analytics */
  posthogGroups?: Record<string, string>;
  /** When true, excludes input/output from the event (for privacy) */
  posthogPrivacyMode?: boolean;
}

/**
 * Configuration options for the Replicate wrapper
 */
export interface ReplicateOptions {
  /** PostHog client instance for sending events */
  posthog: PostHog;
  /** Replicate API token (defaults to REPLICATE_API_TOKEN env var) */
  auth?: string;
  /** Custom user agent string */
  userAgent?: string;
  /** Base URL for the Replicate API */
  baseUrl?: string;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
}

/**
 * Options for the run() method, combining Replicate options with PostHog tracking
 */
export interface RunOptions extends PostHogTrackingOptions {
  /** Input parameters for the model */
  input: object;
  /** Wait options for polling */
  wait?: {
    /** Polling interval in milliseconds */
    interval?: number;
    /** Maximum wait mode */
    mode?: "poll" | "block";
    /** Timeout in milliseconds */
    timeout?: number;
  };
  /** Webhook URL for async notifications */
  webhook?: string;
  /** Webhook events filter */
  webhook_events_filter?: Array<"start" | "output" | "logs" | "completed">;
  /** Signal for aborting the request */
  signal?: AbortSignal;
}

/**
 * Options for predictions.create(), combining Replicate options with PostHog tracking
 */
export interface PredictionCreateOptions extends PostHogTrackingOptions {
  /** Model version ID or model identifier */
  model?: string;
  /** Model version ID */
  version?: string;
  /** Input parameters for the model */
  input: object;
  /** Webhook URL for async notifications */
  webhook?: string;
  /** Webhook events filter */
  webhook_events_filter?: Array<"start" | "output" | "logs" | "completed">;
  /** Whether to stream the output */
  stream?: boolean;
  /** Wait timeout in ms, boolean, or options */
  wait?: number | boolean | { interval?: number };
  /** Signal for aborting the request */
  signal?: AbortSignal;
}

/**
 * Options for the stream() method, combining Replicate options with PostHog tracking
 */
export interface StreamOptions extends PostHogTrackingOptions {
  /** Input parameters for the model */
  input: object;
  /** Webhook URL for async notifications */
  webhook?: string;
  /** Webhook events filter */
  webhook_events_filter?: Array<"start" | "output" | "logs" | "completed">;
  /** Signal for aborting the request */
  signal?: AbortSignal;
}

/**
 * Internal options for capturing PostHog events
 */
export interface CaptureOptions {
  /** The model identifier (e.g., "openai/clip") */
  model: string;
  /** Time taken for the API call in seconds */
  latency: number;
  /** HTTP status code of the response */
  httpStatus: number;
  /** Whether the request resulted in an error */
  isError: boolean;
  /** Error message or object if isError is true */
  error?: unknown;
  /** Input sent to the model */
  input?: unknown;
  /** Output received from the model */
  output?: unknown;
  /** Distinct ID for PostHog */
  distinctId?: string;
  /** Trace ID for grouping related events */
  traceId?: string;
  /** Custom properties to include */
  customProperties?: Record<string, unknown>;
  /** Group identifiers */
  groups?: Record<string, string>;
  /** Whether to exclude input/output from tracking */
  privacyMode?: boolean;
  /** Whether this was a streaming request */
  stream?: boolean;
  /** Prediction ID from Replicate */
  predictionId?: string;
}

/**
 * Constants for the PostHog events
 */
export const POSTHOG_CONSTANTS = {
  PROVIDER: "replicate",
  BASE_URL: "https://api.replicate.com",
  EVENT_NAME: "$ai_generation",
} as const;

