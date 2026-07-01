import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the app to be embedded in Shopify Admin (removes X-Frame-Options: DENY)
  // Shopify requires apps to be embeddable in their iframe.
  async headers() {
    return [
      {
        // Apply to all app routes (not API routes — those handle their own headers)
        source: "/(dashboard|findings|billing|settings)(.*)",
        headers: [
          {
            // Allow Shopify admin to embed this app in an iframe
            key: "Content-Security-Policy",
            value: [
              "frame-ancestors",
              "https://admin.shopify.com",
              "https://*.myshopify.com",
            ].join(" "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
