/**
 * Skeleton loading affiché par Next.js App Router pendant que le RSC
 * `page.tsx` fetch le détail de la vérification + URLs signées Storage
 * (V4 audit). Sans, l'admin voit la liste figée 1-2s sans signal.
 *
 * Pattern aligné sur la structure visuelle de la page détail KYC : header
 * vendeur + cards CNI recto/verso/selfie + sidebar actions.
 */
export default function VerificationDetailLoading() {
  return (
    <div className="px-8 py-10 max-w-5xl animate-pulse">
      {/* Back link */}
      <div className="h-4 w-32 bg-niqo-gray-100 rounded mb-6" />

      {/* Header vendeur */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-full bg-niqo-gray-100" />
        <div className="space-y-2">
          <div className="h-7 w-48 bg-niqo-gray-100 rounded" />
          <div className="h-4 w-32 bg-niqo-gray-100 rounded" />
        </div>
      </div>

      {/* Grid : CNI + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* CNI cards */}
        <div className="space-y-4">
          <div className="bg-white border border-niqo-gray-200 rounded-xl p-4">
            <div className="h-4 w-24 bg-niqo-gray-100 rounded mb-3" />
            <div className="aspect-[1.6/1] w-full bg-niqo-gray-100 rounded-lg" />
          </div>
          <div className="bg-white border border-niqo-gray-200 rounded-xl p-4">
            <div className="h-4 w-24 bg-niqo-gray-100 rounded mb-3" />
            <div className="aspect-[1.6/1] w-full bg-niqo-gray-100 rounded-lg" />
          </div>
          <div className="bg-white border border-niqo-gray-200 rounded-xl p-4">
            <div className="h-4 w-20 bg-niqo-gray-100 rounded mb-3" />
            <div className="aspect-square w-full max-w-[280px] bg-niqo-gray-100 rounded-lg" />
          </div>
        </div>

        {/* Sidebar actions */}
        <div className="space-y-3">
          <div className="bg-white border border-niqo-gray-200 rounded-xl p-4">
            <div className="h-4 w-20 bg-niqo-gray-100 rounded mb-3" />
            <div className="h-12 w-full bg-niqo-gray-100 rounded-lg mb-2" />
            <div className="h-12 w-full bg-niqo-gray-100 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
