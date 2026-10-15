import { ChartCandlestick, Cpu, Globe, Landmark, Leaf, Zap, type LucideProps } from "lucide-react";
import type { UseCase } from "@/lib/types";

const ICONS = {
  candlestick: ChartCandlestick,
  landmark: Landmark,
  leaf: Leaf,
  zap: Zap,
  cpu: Cpu,
  globe: Globe,
} as const;

export function UseCaseIcon({ icon, ...props }: { icon: UseCase["icon"] } & LucideProps) {
  const Icon = ICONS[icon];
  return <Icon {...props} />;
}
