export default function KpisLoading() {
  return (
    <div className="px-8 py-10 max-w-[1400px] mx-auto space-y-10">
      {/* Header */}
      <div className="flex justify-between items-start gap-4">
        <div className="space-y-2">
          <div className="h-9 w-32 bg-niqo-gray-200 rounded animate-pulse" />
          <div className="h-4 w-72 bg-niqo-gray-100 rounded animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-56 bg-niqo-gray-100 rounded animate-pulse" />
          <div className="h-10 w-48 bg-niqo-gray-100 rounded animate-pulse" />
        </div>
      </div>

      {/* Panel 1 — Liquidité */}
      <section>
        <div className="h-5 w-56 bg-niqo-gray-200 rounded animate-pulse mb-4" />
        <div className="h-3 w-44 bg-niqo-gray-200 rounded animate-pulse mb-3" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} h="h-32" />
          ))}
        </div>
        <div className="h-3 w-48 bg-niqo-gray-200 rounded animate-pulse mb-3" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} h="h-32" />
          ))}
        </div>
      </section>

      {/* Panel 2 — Activation */}
      <section>
        <div className="h-5 w-64 bg-niqo-gray-200 rounded animate-pulse mb-4" />
        <div className="grid lg:grid-cols-12 gap-4 mb-6">
          <SkeletonCard h="h-44" className="lg:col-span-3" />
          <SkeletonCard h="h-44" className="lg:col-span-9" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} h="h-32" />
          ))}
        </div>
      </section>

      {/* Panel 3 — Revenue */}
      <section>
        <div className="h-5 w-44 bg-niqo-gray-200 rounded animate-pulse mb-4" />
        <div className="grid lg:grid-cols-12 gap-4 mb-6">
          <SkeletonCard h="h-44" className="lg:col-span-5" />
          <SkeletonCard h="h-44" className="lg:col-span-3" />
          <SkeletonCard h="h-44" className="lg:col-span-4" />
        </div>
        <SkeletonCard h="h-72" />
      </section>

      {/* Compta */}
      <section>
        <div className="h-5 w-56 bg-niqo-gray-200 rounded animate-pulse mb-4" />
        <div className="grid lg:grid-cols-12 gap-4 mb-4">
          <SkeletonCard h="h-44" className="lg:col-span-7" />
          <SkeletonCard h="h-44" className="lg:col-span-5" />
        </div>
        <SkeletonCard h="h-56" />
      </section>
    </div>
  );
}

function SkeletonCard({
  h,
  className = "",
}: {
  h: string;
  className?: string;
}) {
  return (
    <div
      className={`bg-white border border-niqo-gray-200 rounded-xl ${h} animate-pulse ${className}`}
    />
  );
}
