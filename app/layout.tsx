import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BidPilot",
  description: "Transparent tender intelligence for Canadian contractors"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
