import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonBlock label="正在加载工作台" className="pt-2 md:pt-5">
      <Skeleton className="mb-2 h-4 w-28" />
      <Skeleton className="mb-7 h-9 w-48" />
      <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-[18px]" />
        ))}
      </div>
      <Skeleton className="mb-4 h-9 w-72 rounded-full" />
      <Skeleton className="h-80 rounded-card" />
    </SkeletonBlock>
  );
}
