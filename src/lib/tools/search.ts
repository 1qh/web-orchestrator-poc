import { google, type GoogleGenerativeAIProviderMetadata } from "@ai-sdk/google";
import { generateText } from "ai";

import { GROUNDING_MODEL } from "@/lib/config";

export async function runGroundedSearch(query: string): Promise<{
  query: string;
  summary: string;
  sources: Array<{ title?: string; url?: string }>;
  groundingMetadata: GoogleGenerativeAIProviderMetadata["groundingMetadata"] | undefined;
}> {
  const result = await generateText({
    model: google(GROUNDING_MODEL),
    tools: {
      google_search: google.tools.googleSearch({}),
    },
    prompt: query,
  });

  const providerMetadata = result.providerMetadata?.google as
    | GoogleGenerativeAIProviderMetadata
    | undefined;

  const sources = (result.sources ?? []).map((source) => {
    if (source.type === "source") {
      if (source.sourceType === "url") {
        return {
          title: source.title,
          url: source.url,
        };
      }

      return {
        title: source.title,
        url: undefined,
      };
    }

    return {};
  });

  return {
    query,
    summary: result.text,
    sources,
    groundingMetadata: providerMetadata?.groundingMetadata,
  };
}
