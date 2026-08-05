import type { Metadata } from "next";
import "./globals.css";
import AppFrame from "../src/ui/app-frame";

export const metadata: Metadata = {
  title: "EstimatorAI",
  description: "Accuracy-first estimating and tender intelligence for contractors"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AppFrame>{children}</AppFrame></body>
    </html>
  );
}
