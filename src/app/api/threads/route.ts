import { NextResponse } from "next/server";

import { createThread, listThreads } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const threads = await listThreads();
  return NextResponse.json({ threads });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { title?: string };
  const thread = await createThread(body.title);
  return NextResponse.json({ thread });
}
