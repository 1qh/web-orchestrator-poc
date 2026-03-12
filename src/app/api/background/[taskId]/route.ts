import { NextResponse } from "next/server";

import { pollBackgroundTask } from "@/lib/background/runner";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { taskId } = await context.params;
  const task = await pollBackgroundTask(taskId);

  if (!task) {
    return NextResponse.json({ error: "task_not_found" }, { status: 404 });
  }

  return NextResponse.json({ task });
}
