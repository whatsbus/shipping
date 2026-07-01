"use server";

import { db } from "@/db";
import { billingSubscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentShop } from "@/lib/data";

type PlanName = "starter" | "growth" | "pro";

const PLAN_PRICES: Record<PlanName, string> = {
  starter: "49.00",
  growth: "129.00",
  pro: "299.00",
};

export async function changePlan(planName: PlanName) {
  const shop = await getCurrentShop();
  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + 30);

  await db
    .update(billingSubscriptions)
    .set({
      planName,
      priceMonthly: PLAN_PRICES[planName],
      status: "active",
      currentPeriodEnd: periodEnd,
      updatedAt: new Date(),
    })
    .where(eq(billingSubscriptions.shopId, shop.id));

  revalidatePath("/billing");
}
