import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import {
  AlertTriangle,
  CalendarCheck,
  ChevronRight,
  PackageCheck,
  Star,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import {
  actionDeeplink,
  actionSubtitleFr,
  actionTitleFr,
  fetchPendingActions,
  type PendingAction,
} from "@/lib/pendingActions";
import { useAuth } from "@/lib/auth/AuthProvider";

const CARD_WIDTH = 260;

export function HomeActionsBanner() {
  const { profile } = useAuth();
  const [actions, setActions] = useState<PendingAction[]>([]);

  // Refetch à chaque focus du Home (pas d'abonnement realtime — overkill ici,
  // les actions évoluent au timing humain, pas en temps réel)
  useFocusEffect(
    useCallback(() => {
      if (!profile?.id) {
        setActions([]);
        return;
      }
      let cancelled = false;
      void fetchPendingActions().then((list) => {
        if (!cancelled) setActions(list);
      });
      return () => {
        cancelled = true;
      };
    }, [profile?.id])
  );

  // Skip si anonyme OU aucune action
  if (!profile?.id || actions.length === 0) return null;

  return (
    <View className="bg-niqo-white border-b border-niqo-gray-100 py-3">
      <View className="px-4 mb-2 flex-row items-baseline justify-between">
        <Text className="font-display text-label text-niqo-black">
          {actions.length === 1
            ? "1 action en attente"
            : `${actions.length} actions en attente`}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {actions.map((action) => (
          <ActionCard key={`${action.type}:${action.conversation_id}`} action={action} />
        ))}
      </ScrollView>
    </View>
  );
}

// ── Card par action ────────────────────────────────────────────────────────

function ActionCard({ action }: { action: PendingAction }) {
  const config = configForAction(action);
  return (
    <Pressable
      onPress={() => router.push(actionDeeplink(action) as never)}
      accessibilityRole="button"
      accessibilityLabel={`${actionTitleFr(action)} — ${actionSubtitleFr(action)}`}
      style={{ width: CARD_WIDTH }}
      className={`rounded-2xl border px-3 py-3 active:opacity-80 ${config.bg} ${config.border}`}
    >
      <View className="flex-row items-center mb-1.5">
        <View
          className={`w-7 h-7 rounded-full items-center justify-center mr-2 ${config.iconBg}`}
        >
          {config.icon}
        </View>
        <Text
          numberOfLines={1}
          className={`flex-1 font-display text-label ${config.titleColor}`}
        >
          {actionTitleFr(action)}
        </Text>
        <ChevronRight size={14} color={config.chevronColor} />
      </View>
      <Text
        numberOfLines={2}
        className="font-body text-micro text-niqo-gray-800 leading-snug"
      >
        {actionSubtitleFr(action)}
      </Text>
    </Pressable>
  );
}

// ── Config visuelle par type d'action ──────────────────────────────────────

function configForAction(action: PendingAction): {
  icon: React.ReactNode;
  iconBg: string;
  bg: string;
  border: string;
  titleColor: string;
  chevronColor: string;
} {
  switch (action.type) {
    case "disputed":
      return {
        icon: <AlertTriangle size={14} color="#FFFFFF" />,
        iconBg: "bg-niqo-warning",
        bg: "bg-niqo-warning/10",
        border: "border-niqo-warning/30",
        titleColor: "text-niqo-warning",
        chevronColor: "#C97A1F",
      };
    case "rencontre":
      return {
        icon: <CalendarCheck size={14} color="#FFFFFF" />,
        iconBg: "bg-niqo-coral",
        bg: "bg-niqo-coral-light",
        border: "border-niqo-coral/30",
        titleColor: "text-niqo-coral",
        chevronColor: "#D85A30",
      };
    case "mark_vendue":
      return {
        icon: <PackageCheck size={14} color="#FFFFFF" />,
        iconBg: "bg-niqo-success",
        bg: "bg-niqo-success/10",
        border: "border-niqo-success/30",
        titleColor: "text-niqo-success",
        chevronColor: "#2D8654",
      };
    case "avis":
      return {
        icon: <Star size={14} color="#FFFFFF" />,
        iconBg: "bg-niqo-black",
        bg: "bg-niqo-gray-50",
        border: "border-niqo-gray-200",
        titleColor: "text-niqo-black",
        chevronColor: "#1A1A1A",
      };
  }
}
