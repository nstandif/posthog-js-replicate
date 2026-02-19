/**
 * Example: Using deployments.predictions.create() with PostHog tracking
 *
 * This example demonstrates creating a prediction via a Replicate deployment
 * with automatic PostHog analytics.
 *
 * To run this example:
 * 1. Set REPLICATE_API_TOKEN environment variable
 * 2. Set POSTHOG_API_KEY environment variable
 * 3. Run: bun examples/deployment-test.ts
 */

import { Replicate } from "../src/index";
import { PostHog } from "posthog-node";

async function main() {
  const phClient = new PostHog(
    process.env.POSTHOG_API_KEY || "<your_posthog_api_key>",
    { host: "https://us.i.posthog.com" }
  );

  const replicate = new Replicate({
    posthog: phClient,
  });

  // Replace with your own deployment owner and name
  const owner = "your-org";
  const name = "your-deployment";

  console.log(`Creating deployment prediction via ${owner}/${name}...\n`);

  try {
    const prediction = await (replicate.deployments.predictions.create as Function)(
      owner,
      name,
      {
        input: { prompt: "Hello, how are you?" },
        posthogDistinctId: "user_123",
        posthogTraceId: "trace_deploy_" + Date.now(),
        posthogProperties: {
          $ai_span_name: "deployment_example",
        },
        posthogGroups: { company: "my_company" },
      }
    );

    console.log("Prediction created:", JSON.stringify(prediction, null, 2));
    console.log("\nPostHog event captured with $ai_is_deployment: true");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await phClient.shutdown();
    console.log("PostHog events flushed");
  }
}

main();
