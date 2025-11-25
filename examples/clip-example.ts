/**
 * Example: Using OpenAI CLIP with PostHog tracking
 *
 * This example demonstrates the primary use case for posthog-replicate:
 * Running the openai/clip model with automatic PostHog analytics.
 *
 * To run this example:
 * 1. Set REPLICATE_API_TOKEN environment variable
 * 2. Set POSTHOG_API_KEY environment variable
 * 3. Run: bun examples/clip-example.ts
 */

import { Replicate } from "../src/index";
import { PostHog } from "posthog-node";

async function main() {
  // Initialize PostHog client
  const phClient = new PostHog(
    process.env.POSTHOG_API_KEY || "<your_posthog_api_key>",
    { host: "https://us.i.posthog.com" }
  );

  // Initialize Replicate with PostHog tracking
  const replicate = new Replicate({
    posthog: phClient,
    // auth: process.env.REPLICATE_API_TOKEN, // Optional, defaults to env var
  });

  // Define the input for CLIP
  const input = {
    image: "https://picsum.photos/id/237/200/300",
  };

  console.log("Running openai/clip model...");
  console.log("Input:", JSON.stringify(input, null, 2));

  try {
    // Run the model with PostHog tracking options
    const output = await replicate.run("openai/clip", {
      input,
      // PostHog tracking options (all optional)
      posthogDistinctId: "user_123",
      posthogTraceId: "trace_" + Date.now(),
      posthogProperties: {
        $ai_span_name: "clip_image_analysis",
        use_case: "image_embedding",
      },
      posthogGroups: {
        company: "acme_corp",
      },
    });

    console.log("\nOutput:", JSON.stringify(output, null, 2));
    console.log("\n✅ PostHog event captured: $ai_generation");
  } catch (error) {
    console.error("Error running model:", error);
    console.log("\n⚠️  PostHog error event captured: $ai_generation (with $ai_is_error: true)");
  } finally {
    // Important: Flush PostHog events before exiting
    await phClient.shutdown();
    console.log("\n📊 PostHog events flushed");
  }
}

main();
