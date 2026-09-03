import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "JerryPay — Agentic Commerce Gateway",
  description:
    "JerryPay is an Agentic Commerce Gateway that lets AI agents initiate, manage, and reconcile payments through Razorpay — built for the Razorpay AI Buildathon.",
  keywords: ["AI", "payments", "agentic commerce", "Razorpay", "workflow", "automation", "LLM", "agent"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-gray-950 text-gray-100 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
