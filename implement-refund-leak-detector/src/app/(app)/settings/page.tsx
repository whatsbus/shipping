import { Store, Bell, Radar } from "lucide-react";
import { Topbar } from "@/components/app/topbar";
import { ToggleField } from "@/components/ui/toggle-field";
import { getCurrentShop, getSettingsForShop } from "@/lib/data";
import { formatDate, formatNumber } from "@/lib/format";
import { updateSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const shop = await getCurrentShop();
  const settings = await getSettingsForShop(shop.id);

  return (
    <div>
      <Topbar title="Settings" description="Manage your store connection and alert preferences." />

      <div className="mx-auto max-w-3xl px-8 py-8">
        <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
          <div className="flex items-center gap-2 text-slate-300">
            <Store className="h-4 w-4" />
            <h2 className="text-sm font-semibold text-white">Store connection</h2>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Store</dt>
              <dd className="mt-1 text-sm font-medium text-white">{shop.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Domain</dt>
              <dd className="mt-1 text-sm font-medium text-white">{shop.myshopifyDomain}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Connected since</dt>
              <dd className="mt-1 text-sm font-medium text-white">{formatDate(shop.connectedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Monthly order volume</dt>
              <dd className="mt-1 text-sm font-medium text-white">
                {formatNumber(shop.monthlyOrderVolume)} orders
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Connected and syncing normally
          </div>
        </section>

        <form action={updateSettings} className="mt-6 flex flex-col gap-6">
          <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
            <div className="flex items-center gap-2 text-slate-300">
              <Bell className="h-4 w-4" />
              <h2 className="text-sm font-semibold text-white">Notifications</h2>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label htmlFor="notificationEmail" className="text-xs text-slate-500">
                  Alert email
                </label>
                <input
                  id="notificationEmail"
                  name="notificationEmail"
                  type="email"
                  defaultValue={settings?.notificationEmail ?? ""}
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-white outline-none focus:border-violet-500/50"
                />
              </div>

              <div>
                <label htmlFor="alertThreshold" className="text-xs text-slate-500">
                  Only alert me for leaks above this monthly amount ($)
                </label>
                <input
                  id="alertThreshold"
                  name="alertThreshold"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={settings?.alertThreshold ?? "50"}
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-white outline-none focus:border-violet-500/50"
                />
              </div>

              <ToggleField
                name="weeklyDigestEnabled"
                label="Weekly digest"
                description="A summary of all active findings emailed every Monday."
                defaultChecked={settings?.weeklyDigestEnabled ?? true}
              />

              <ToggleField
                name="instantAlertsEnabled"
                label="Instant alerts"
                description="Get notified immediately when a new finding is detected above your threshold."
                defaultChecked={settings?.instantAlertsEnabled ?? true}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
            <div className="flex items-center gap-2 text-slate-300">
              <Radar className="h-4 w-4" />
              <h2 className="text-sm font-semibold text-white">Detectors</h2>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Enable or disable individual detectors for this store.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <ToggleField
                name="refundLeakEnabled"
                label="Refund Leak Detector"
                description="Scans refunds for patterns that erode margin."
                defaultChecked={settings?.refundLeakEnabled ?? true}
              />
              <ToggleField
                name="shippingLeakEnabled"
                label="Shipping Leak Detector"
                description="Scans orders for shipping cost vs. charged rate gaps."
                defaultChecked={settings?.shippingLeakEnabled ?? true}
              />
            </div>
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
            >
              Save settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
