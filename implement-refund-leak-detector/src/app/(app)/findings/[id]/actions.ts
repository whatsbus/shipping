"use server";

import { db } from "@/db";
import { findings } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentShop } from "@/lib/data";

type FindingStatus = "new" | "investigating" | "resolved" | "ignored";

export async function updateFindingStatus(findingId: string, status: FindingStatus) {
  const shop = await getCurrentShop();

  await db
    .update(findings)
    .set({
      status,
      resolvedAt: status === "resolved" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(findings.id, findingId), eq(findings.shopId, shop.id)));

  revalidatePath(`/findings/${findingId}`);
  revalidatePath("/findings");
  revalidatePath("/dashboard");
}
