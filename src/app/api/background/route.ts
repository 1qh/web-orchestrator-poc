import { NextResponse } from "next/server";
import { z } from "zod";

import { startBackgroundDelegation } from "@/lib/background/runner";
import { ensureThread } from "@/lib/store";

const requestSchema = z.object({
  threadId: z.string().min(1),
  agent: z.string().min(1),
  prompt: z.string().min(1),
  title: z.string().min(1).optional(),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = (await request.json().catch(() => null)) as unknown;
  const parsed = requestSchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        detail: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const input = parsed.data;
  await ensureThread(input.threadId);

  const task = await startBackgroundDelegation({
    threadId: input.threadId,
    agent: input.agent,
    prompt: input.prompt,
    title: input.title ?? `Background delegation: ${input.agent}`,
  });

  return NextResponse.json({ task });
}
