import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/** 进行中的小转圈。装饰性：旁边的文字同时变化，不单靠动画表达状态。 */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-hidden="true" />;
}
