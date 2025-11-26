import { test, expect, mock, beforeEach, describe } from "bun:test";
import type { PostHog } from "posthog-node";

// Type for our mock capture calls
interface MockCaptureCall {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
  groups?: Record<string, string>;
}

// Mock Replicate SDK - must be before any imports that use it
const mockRun = mock(() => Promise.resolve({ result: "test output" }));
const mockStream = mock(async function* () {
  yield { event: "output", data: "Hello " };
  yield { event: "output", data: "World" };
  yield { event: "done", data: "" };
});
const mockPredictionsCreate = mock(() =>
  Promise.resolve({ id: "pred_123", status: "starting" })
);

// Set up module mock before importing our code
// Methods must be on prototype for super.method() to work
mock.module("replicate", () => ({
  default: class MockReplicate {
    predictions = {
      create: mockPredictionsCreate,
      get: mock(() => Promise.resolve({})),
      cancel: mock(() => Promise.resolve({})),
      list: mock(() => Promise.resolve({})),
    };
    models = {};
    deployments = {};
    hardware = {};
    collections = {};
    webhooks = {};

    // Methods must be defined this way for super.method() calls to work
    run(_model: string, _options: object) {
      return mockRun();
    }
    stream(_model: string, _options: object) {
      return mockStream();
    }
  },
}));

// Now import our code after the mock is set up
const { Replicate } = await import("./index");
const { captureGeneration, createTimer } = await import("./capture");
const { POSTHOG_CONSTANTS } = await import("./types");

type PredictionCreateOptions = import("./index").PredictionCreateOptions;

// Mock PostHog client
function createMockPostHog() {
  const captureMock = mock((_options: MockCaptureCall) => {});
  return {
    capture: captureMock,
    shutdown: mock(() => Promise.resolve()),
    // Helper to get capture calls with proper typing
    getCaptureCall: (index: number): MockCaptureCall | undefined => {
      const calls = captureMock.mock.calls;
      if (calls && calls.length > index) {
        return calls[index]?.[0] as MockCaptureCall;
      }
      return undefined;
    },
  };
}

describe("Replicate Wrapper", () => {
  let mockPostHog: ReturnType<typeof createMockPostHog>;

  beforeEach(() => {
    mockPostHog = createMockPostHog();
    mockRun.mockClear();
    mockStream.mockClear();
    mockPredictionsCreate.mockClear();
  });

  describe("constructor", () => {
    test("creates instance with PostHog client", () => {
      const replicate = new Replicate({
        posthog: mockPostHog as unknown as PostHog,
      });

      expect(replicate).toBeDefined();
      expect(replicate.run).toBeDefined();
      expect(replicate.stream).toBeDefined();
      expect(replicate.predictions).toBeDefined();
    });
  });

  describe("run()", () => {
    test("calls underlying SDK and captures event", async () => {
      const replicate = new Replicate({
        posthog: mockPostHog as unknown as PostHog,
      });

      const output = await replicate.run("openai/clip", {
        input: { image: "https://example.com/image.jpg" },
        posthogDistinctId: "user_123",
      });

      // Verify SDK was called
      expect(mockRun).toHaveBeenCalledTimes(1);

      // Verify PostHog capture was called
      expect(mockPostHog.capture).toHaveBeenCalledTimes(1);

      const captureCall = mockPostHog.getCaptureCall(0);
      expect(captureCall).toBeDefined();
      expect(captureCall!.event).toBe("$ai_generation");
      expect(captureCall!.distinctId).toBe("user_123");
      expect(captureCall!.properties.$ai_provider).toBe("replicate");
      expect(captureCall!.properties.$ai_model).toBe("openai/clip");
      expect(captureCall!.properties.$ai_is_error).toBe(false);
      expect(captureCall!.properties.$ai_stream).toBe(false);
      expect(typeof captureCall!.properties.$ai_latency).toBe("number");
    });

    test("includes input and output in event", async () => {
      const replicate = new Replicate({
        posthog: mockPostHog as unknown as PostHog,
      });

      await replicate.run("openai/clip", {
        input: { image: "https://example.com/test.jpg" },
      });

      const captureCall = mockPostHog.getCaptureCall(0);
      expect(captureCall).toBeDefined();
      expect(captureCall!.properties.$ai_input).toEqual([
        { role: "user", content: { image: "https://example.com/test.jpg" } },
      ]);
      expect(captureCall!.properties.$ai_output_choices).toBeDefined();
    });

    test("respects privacy mode", async () => {
      const replicate = new Replicate({
        posthog: mockPostHog as unknown as PostHog,
      });

      await replicate.run("openai/clip", {
        input: { image: "https://example.com/private.jpg" },
        posthogPrivacyMode: true,
      });

      const captureCall = mockPostHog.getCaptureCall(0);
      expect(captureCall).toBeDefined();
      expect(captureCall!.properties.$ai_input).toBeUndefined();
      expect(captureCall!.properties.$ai_output_choices).toBeUndefined();
    });

    test("includes trace ID when provided", async () => {
      const replicate = new Replicate({
        posthog: mockPostHog as unknown as PostHog,
      });

      await replicate.run("openai/clip", {
        input: { image: "https://example.com/image.jpg" },
        posthogTraceId: "trace_abc123",
      });

      const captureCall = mockPostHog.getCaptureCall(0);
      expect(captureCall).toBeDefined();
      expect(captureCall!.properties.$ai_trace_id).toBe("trace_abc123");
    });

    test("includes custom properties", async () => {
      const replicate = new Replicate({
        posthog: mockPostHog as unknown as PostHog,
      });

      await replicate.run("openai/clip", {
        input: { image: "https://example.com/image.jpg" },
        posthogProperties: {
          $ai_span_name: "image_analysis",
          custom_field: "custom_value",
        },
      });

      const captureCall = mockPostHog.getCaptureCall(0);
      expect(captureCall).toBeDefined();
      expect(captureCall!.properties.$ai_span_name).toBe("image_analysis");
      expect(captureCall!.properties.custom_field).toBe("custom_value");
    });

    test("includes groups when provided", async () => {
      const replicate = new Replicate({
        posthog: mockPostHog as unknown as PostHog,
      });

      await replicate.run("openai/clip", {
        input: { image: "https://example.com/image.jpg" },
        posthogGroups: { company: "acme_corp" },
      });

      const captureCall = mockPostHog.getCaptureCall(0);
      expect(captureCall).toBeDefined();
      expect(captureCall!.groups).toEqual({ company: "acme_corp" });
    });

    test("captures error events", async () => {
      const testError = new Error("API rate limit exceeded");
      mockRun.mockImplementationOnce(() => Promise.reject(testError));

      const replicate = new Replicate({
        posthog: mockPostHog as unknown as PostHog,
      });

      await expect(
        replicate.run("openai/clip", {
          input: { image: "https://example.com/image.jpg" },
          posthogDistinctId: "user_123",
        })
      ).rejects.toThrow("API rate limit exceeded");

      // Verify error was captured
      const captureCall = mockPostHog.getCaptureCall(0);
      expect(captureCall).toBeDefined();
      expect(captureCall!.properties.$ai_is_error).toBe(true);
      expect(captureCall!.properties.$ai_error).toBeDefined();
      const errorObj = captureCall!.properties.$ai_error as Record<string, unknown>;
      expect(errorObj.message).toBe("API rate limit exceeded");
    });

    test("uses anonymous as default distinctId", async () => {
      const replicate = new Replicate({
        posthog: mockPostHog as unknown as PostHog,
      });

      await replicate.run("openai/clip", {
        input: { image: "https://example.com/image.jpg" },
      });

      const captureCall = mockPostHog.getCaptureCall(0);
      expect(captureCall).toBeDefined();
      expect(captureCall!.distinctId).toBe("anonymous");
    });
  });

  describe("stream()", () => {
    test("streams output and captures event on completion", async () => {
      const replicate = new Replicate({
        posthog: mockPostHog as unknown as PostHog,
      });

      const chunks: string[] = [];
      const stream = replicate.stream("meta/llama-2-70b-chat", {
        input: { prompt: "Hello" },
        posthogDistinctId: "user_456",
      });

      for await (const event of stream) {
        if (event.event === "output") {
          chunks.push(event.data);
        }
      }

      expect(chunks).toEqual(["Hello ", "World"]);

      // Verify capture was called after stream completed
      expect(mockPostHog.capture).toHaveBeenCalledTimes(1);

      const captureCall = mockPostHog.getCaptureCall(0);
      expect(captureCall).toBeDefined();
      expect(captureCall!.properties.$ai_stream).toBe(true);
      expect(captureCall!.properties.$ai_model).toBe("meta/llama-2-70b-chat");
    });
  });

  describe("predictions.create()", () => {
    test("creates prediction and captures event", async () => {
      const replicate = new Replicate({
        posthog: mockPostHog as unknown as PostHog,
      });

      // Cast to our extended type that includes PostHog options
      const createWithTracking = replicate.predictions.create as (options: PredictionCreateOptions) => Promise<unknown>;
      const prediction = await createWithTracking({
        model: "stability-ai/sdxl",
        input: { prompt: "A beautiful sunset" },
        posthogDistinctId: "user_789",
      });

      expect(prediction).toMatchObject({ id: "pred_123", status: "starting" });

      // Verify capture includes async prediction marker
      const captureCall = mockPostHog.getCaptureCall(0);
      expect(captureCall).toBeDefined();
      expect(captureCall!.properties.$ai_async_prediction).toBe(true);
      expect(captureCall!.properties.$ai_prediction_id).toBe("pred_123");
    });
  });
});

describe("captureGeneration", () => {
  test("captures basic generation event", () => {
    const mockPostHog = createMockPostHog();

    captureGeneration(mockPostHog as unknown as PostHog, {
      model: "test/model",
      latency: 1.5,
      httpStatus: 200,
      isError: false,
      input: { prompt: "test" },
      output: "response",
      distinctId: "user_123",
    });

    expect(mockPostHog.capture).toHaveBeenCalledTimes(1);

    const call = mockPostHog.getCaptureCall(0);
    expect(call).toBeDefined();
    expect(call!.event).toBe("$ai_generation");
    expect(call!.distinctId).toBe("user_123");
    expect(call!.properties.$ai_provider).toBe("replicate");
    expect(call!.properties.$ai_model).toBe("test/model");
    expect(call!.properties.$ai_latency).toBe(1.5);
    expect(call!.properties.$ai_http_status).toBe(200);
    expect(call!.properties.$ai_base_url).toBe("https://api.replicate.com");
    expect(call!.properties.$ai_is_error).toBe(false);
  });

  test("excludes input/output in privacy mode", () => {
    const mockPostHog = createMockPostHog();

    captureGeneration(mockPostHog as unknown as PostHog, {
      model: "test/model",
      latency: 1.0,
      httpStatus: 200,
      isError: false,
      input: { secret: "data" },
      output: "private response",
      privacyMode: true,
    });

    const call = mockPostHog.getCaptureCall(0);
    expect(call).toBeDefined();
    expect(call!.properties.$ai_input).toBeUndefined();
    expect(call!.properties.$ai_output_choices).toBeUndefined();
  });
});

describe("createTimer", () => {
  test("measures elapsed time in seconds", async () => {
    const getElapsed = createTimer();

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));

    const elapsed = getElapsed();
    expect(elapsed).toBeGreaterThan(0.09);
    expect(elapsed).toBeLessThan(0.2);
  });
});

describe("POSTHOG_CONSTANTS", () => {
  test("has correct values", () => {
    expect(POSTHOG_CONSTANTS.PROVIDER).toBe("replicate");
    expect(POSTHOG_CONSTANTS.BASE_URL).toBe("https://api.replicate.com");
    expect(POSTHOG_CONSTANTS.EVENT_NAME).toBe("$ai_generation");
  });
});
