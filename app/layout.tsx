import type { Metadata } from "next";
import "./globals.css";
import AppFrame from "../src/ui/app-frame";

export const metadata: Metadata = {
  title: "BidPilot",
  description: "Transparent tender intelligence for Canadian contractors"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AppFrame>{children}</AppFrame></body>
    </html>
  );
}
