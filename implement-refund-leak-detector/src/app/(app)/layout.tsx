import type { ReactNode } from "react";
import { Sidebar } from "@/components/app/sidebar";
import { requireAuth } from "@/lib/shopify/auth-guard";
import { getShopById } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Enforce authentication — redirects to /auth/login if session is missing
  // or if the shop is no longer active (e.g., uninstalled between requests).
  const auth = await requireAuth();

  // Load the full shop record using the session-authenticated shopId.
  const shop = await getShopById(auth.shopId);

  return (
    <div className="flex min-h-screen bg-[#08090c]">
      <Sidebar shopName={shop.name} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
