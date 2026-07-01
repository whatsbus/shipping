"use server";

import { db } from "@/db";
import { shopSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentShop } from "@/lib/data";

export async function updateSettings(formData: FormData) {
  const shop = await getCurrentShop();

  const notificationEmail = String(formData.get("notificationEmail") ?? "").trim();
  const alertThreshold = String(formData.get("alertThreshold") ?? "0");
  const weeklyDigestEnabled = formData.get("weeklyDigestEnabled") === "on";
  const instantAlertsEnabled = formData.get("instantAlertsEnabled") === "on";
  const refundLeakEnabled = formData.get("refundLeakEnabled") === "on";
  const shippingLeakEnabled = formData.get("shippingLeakEnabled") === "on";

  await db
    .update(shopSettings)
    .set({
      notificationEmail: notificationEmail || "ops@example.com",
      alertThreshold,
      weeklyDigestEnabled,
      instantAlertsEnabled,
      refundLeakEnabled,
      shippingLeakEnabled,
      updatedAt: new Date(),
    })
    .where(eq(shopSettings.shopId, shop.id));

  revalidatePath("/settings");
}
