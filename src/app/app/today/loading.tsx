import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";
import { PageTransition } from "@/components/ui/transitions";

/** 工作台骨架屏：与真实页面同形，加载完成时不跳动；与前后内容交叉淡化，不是硬切。 */
export default function Loading() {
  return (
    <PageTransition variant="swap">
      <SkeletonBlock label="正在加载工作台" className="md:pt-3">
        <Skeleton className="mb-2 h-4 w-28" />
        <Skeleton className="mb-2 h-8 w-44" />
        <Skeleton className="mb-7 h-4 w-52" />
        <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-5 xl:gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className={i === 0 ? "h-[104px] rounded-card max-sm:col-span-2" : "h-[104px] rounded-card"} />
          ))}
        </div>
        <Skeleton className="mb-3 h-9 w-72 rounded-full" />
        <Skeleton className="h-80 rounded-card" />
      </SkeletonBlock>
    </PageTransition>
  );
}
