/**
 * Skeleton loading affiché par Next.js App Router pendant que le RSC
 * `page.tsx` fetch les données du signalement (S4 audit). Sans, l'admin
 * voit la liste figée 1-2s sans aucun feedback de transition.
 *
 * Pattern aligné sur la structure visuelle de la page détail (header,
 * grid 2 colonnes, cards) pour éviter le content-jumping au remplacement.
 */
export default function SignalementDetailLoading() {
  return (
    <div className="px-6 py-6 max-w-7xl mx-auto animate-pulse">
      {/* Back link + header */}
      <div className="h-4 w-32 bg-niqo-gray-100 rounded mb-4" />
      <div className="flex items-center gap-3 mb-6">
        <div className="h-7 w-64 bg-niqo-gray-100 rounded" />
        <div className="h-6 w-24 bg-niqo-gray-100 rounded-full" />
      </div>

      {/* Grid 2 cols : main content + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Main */}
        <div className="space-y-4">
          <div className="bg-white border border-niqo-gray-200 rounded-xl p-5">
            <div className="h-5 w-40 bg-niqo-gray-100 rounded mb-3" />
            <div className="space-y-2">
              <div className="h-4 w-full bg-niqo-gray-100 rounded" />
              <div className="h-4 w-3/4 bg-niqo-gray-100 rounded" />
            </div>
          </div>
          <div className="bg-white border border-niqo-gray-200 rounded-xl p-5">
            <div className="h-5 w-32 bg-niqo-gray-100 rounded mb-3" />
            <div className="h-32 w-full bg-niqo-gray-100 rounded" />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white border border-niqo-gray-200 rounded-xl p-4">
            <div className="h-4 w-20 bg-niqo-gray-100 rounded mb-3" />
            <div className="h-10 w-full bg-niqo-gray-100 rounded mb-2" />
            <div className="h-10 w-full bg-niqo-gray-100 rounded" />
          </div>
          <div className="bg-white border border-niqo-gray-200 rounded-xl p-4">
            <div className="h-4 w-24 bg-niqo-gray-100 rounded mb-3" />
            <div className="space-y-2">
              <div className="h-4 w-full bg-niqo-gray-100 rounded" />
              <div className="h-4 w-2/3 bg-niqo-gray-100 rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
