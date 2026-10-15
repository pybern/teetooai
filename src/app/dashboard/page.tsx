import type { Metadata } from "next";
import { PinnedBoard } from "@/components/pinned-board";

export const metadata: Metadata = { title: "Dashboard — Insightful" };

export default function DashboardPage() {
  return <PinnedBoard />;
}
