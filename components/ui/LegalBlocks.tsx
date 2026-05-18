import { Stack, router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Composants atomiques de rendu pour les écrans légaux mobiles
// (`app/legal/*.tsx`). Source de vérité textuelle = `docs/legal/*.md`.
// Toute modification matérielle d'un document doit être répliquée du .md
// vers le .tsx correspondant ET incrémentée dans `lib/legal.ts` (LEGAL_VERSIONS).

export function LegalScreen({
  title,
  version,
  date,
  children,
}: {
  title: string;
  version: string;
  date: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets.top }} className="flex-1 bg-niqo-white">
      <Stack.Screen options={{ headerShown: false }} />

      <View className="px-4 h-14 flex-row items-center border-b border-niqo-gray-150">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          className="min-h-[44px] min-w-[44px] items-center justify-center -ml-2 active:opacity-60"
        >
          <ArrowLeft size={22} color="#1A1A1A" />
        </Pressable>
        <Text className="ml-2 font-display text-h3 text-niqo-black flex-1" numberOfLines={1}>
          {title}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 32,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="font-body text-micro text-niqo-gray-500 mb-6">
          Dernière mise à jour : {date} — version {version}
        </Text>

        {children}
      </ScrollView>
    </View>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View className="mb-6">
      <Text className="font-display text-h3 text-niqo-black mb-3">{title}</Text>
      {children}
    </View>
  );
}

export function SubTitle({ children }: { children: ReactNode }) {
  return (
    <Text className="font-body text-label text-niqo-black mt-2 mb-2">
      {children}
    </Text>
  );
}

export function P({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Text
      className={`font-body text-body text-niqo-gray-800 mb-3 leading-6 ${className ?? ""}`}
    >
      {children}
    </Text>
  );
}

export function Bullet({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row mb-2 pl-2">
      <Text className="font-body text-body text-niqo-coral mr-2">•</Text>
      <Text className="flex-1 font-body text-body text-niqo-gray-800 leading-6">
        {children}
      </Text>
    </View>
  );
}

export function Strong({ children }: { children: ReactNode }) {
  return (
    <Text className="font-body-semibold text-niqo-black">{children}</Text>
  );
}
