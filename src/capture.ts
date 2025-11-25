import type { PostHog } from "posthog-node";
import type { CaptureOptions } from "./types";
import { POSTHOG_CONSTANTS } from "./types";

/**
 * Captures an AI generation event to PostHog
 *
 * This function sends a `$ai_generation` event with all relevant properties
 * following the PostHog LLM analytics schema.
 *
 * @param posthog - The PostHog client instance
 * @param options - Options containing all the data to capture
 */
export function captureGeneration(
  posthog: PostHog,
  options: CaptureOptions
): void {
  const properties: Record<string, unknown> = {
    // Core properties (always captured)
    $ai_provider: POSTHOG_CONSTANTS.PROVIDER,
    $ai_model: options.model,
    $ai_latency: options.latency,
    $ai_http_status: options.httpStatus,
    $ai_base_url: POSTHOG_CONSTANTS.BASE_URL,
    $ai_is_error: options.isError,
  };

  // Add error details if present
  if (options.isError && options.error) {
    properties.$ai_error = formatError(options.error);
  }

  // Add input/output unless privacy mode is enabled
  if (!options.privacyMode) {
    if (options.input !== undefined) {
      properties.$ai_input = formatInput(options.input);
    }
    if (options.output !== undefined) {
      properties.$ai_output_choices = formatOutput(options.output);
    }
  }

  // Add trace ID if provided
  if (options.traceId) {
    properties.$ai_trace_id = options.traceId;
  }

  // Add streaming flag if applicable
  if (options.stream !== undefined) {
    properties.$ai_stream = options.stream;
  }

  // Add prediction ID as a custom property (Replicate-specific)
  if (options.predictionId) {
    properties.$ai_prediction_id = options.predictionId;
  }

  // Merge in any custom properties (they can include $ai_span_name, $ai_session_id, etc.)
  if (options.customProperties) {
    Object.assign(properties, options.customProperties);
  }

  // Send the event to PostHog
  posthog.capture({
    distinctId: options.distinctId || "anonymous",
    event: POSTHOG_CONSTANTS.EVENT_NAME,
    properties,
    groups: options.groups,
  });
}

/**
 * Formats input for PostHog event
 * Converts to the expected array format with role/content structure
 */
function formatInput(input: unknown): Array<{ role: string; content: unknown }> {
  // Replicate inputs are typically objects, not message arrays
  // We wrap them in a standard format for consistency with PostHog schema
  return [
    {
      role: "user",
      content: input,
    },
  ];
}

/**
 * Formats output for PostHog event
 * Converts to the expected array format with role/content structure
 */
function formatOutput(output: unknown): Array<{ role: string; content: unknown }> {
  // Replicate outputs vary by model - could be string, array, object, URL, etc.
  // We wrap them in a standard format for consistency with PostHog schema
  return [
    {
      role: "assistant",
      content: output,
    },
  ];
}

/**
 * Formats an error for inclusion in PostHog event
 */
function formatError(error: unknown): string | Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    return error as Record<string, unknown>;
  }
  return String(error);
}

/**
 * Utility to measure execution time
 * Returns a function that when called returns the elapsed time in seconds
 */
export function createTimer(): () => number {
  const start = performance.now();
  return () => (performance.now() - start) / 1000;
}
