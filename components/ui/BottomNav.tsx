import { Pressable, Text, View } from "react-native";
import {
  Home,
  MessageCircle,
  Plus,
  Search,
  User,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type TabKey = "home" | "search" | "sell" | "messages" | "profile";

interface BottomNavProps {
  active: TabKey;
  onTabPress: (tab: TabKey) => void;
  /** Nombre de messages non-lus — badge coral sur l'onglet Messages */
  unreadCount?: number;
}

interface TabItemProps {
  Icon: LucideIcon;
  label: string;
  active: boolean;
  onPress: () => void;
  badge?: number;
}

function TabItem({ Icon, label, active, onPress, badge }: TabItemProps) {
  const iconColor = active ? "#D85A30" : "#888780";
  const textClass = active ? "text-niqo-coral" : "text-niqo-gray-500";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      className="flex-1 items-center justify-center min-h-[44px] py-2 active:opacity-60"
    >
      <View>
        <Icon size={22} color={iconColor} />
        {badge !== undefined && badge > 0 && (
          <View className="absolute -top-1.5 -right-2.5 bg-niqo-coral min-w-[18px] h-[18px] rounded-full items-center justify-center px-1">
            <Text
              className="font-mono text-2xs text-niqo-white"
              allowFontScaling={false}
            >
              {badge > 99 ? "99+" : badge}
            </Text>
          </View>
        )}
      </View>
      <Text
        className={`mt-1 font-body text-2xs ${textClass}`}
        allowFontScaling={false}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function BottomNav({ active, onTabPress, unreadCount }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const isSellActive = active === "sell";

  return (
    <View
      style={{ paddingBottom: insets.bottom }}
      className="bg-niqo-white border-t border-niqo-gray-150 flex-row items-center"
    >
      <TabItem
        Icon={Home}
        label="Accueil"
        active={active === "home"}
        onPress={() => onTabPress("home")}
      />
      <TabItem
        Icon={Search}
        label="Recherche"
        active={active === "search"}
        onPress={() => onTabPress("search")}
      />

      <View className="flex-1 items-center justify-center py-2">
        <Pressable
          onPress={() => onTabPress("sell")}
          accessibilityRole="button"
          accessibilityLabel="Vendre un article"
          accessibilityState={{ selected: isSellActive }}
          className="w-14 h-14 rounded-full bg-niqo-coral items-center justify-center active:opacity-80"
          style={{
            shadowColor: "#1A1A1A",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.2,
            shadowRadius: 8,
            elevation: 6,
          }}
        >
          <Plus size={28} color="#FFFFFF" strokeWidth={2.5} />
        </Pressable>
      </View>

      <TabItem
        Icon={MessageCircle}
        label="Messages"
        active={active === "messages"}
        onPress={() => onTabPress("messages")}
        badge={unreadCount}
      />

      <TabItem
        Icon={User}
        label="Profil"
        active={active === "profile"}
        onPress={() => onTabPress("profile")}
      />
    </View>
  );
}
