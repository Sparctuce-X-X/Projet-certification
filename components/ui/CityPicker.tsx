import { Check, X } from "lucide-react-native";
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  visible: boolean;
  cities: readonly string[];
  selected: string;
  onSelect: (city: string) => void;
  onClose: () => void;
  /** Titre de la modale. Default "Choisis ta ville". */
  title?: string;
}

/**
 * Bottom-sheet picker pour sélectionner une ville parmi une liste prédéfinie.
 *
 * Pattern : Modal RN natif avec animationType="slide" (animation système
 * iOS/Android, pas besoin de Reanimated). Backdrop tappable pour fermer.
 * FlatList virtualisée pour scroller même avec longues listes.
 */
export function CityPicker({
  visible,
  cities,
  selected,
  onSelect,
  onClose,
  title = "Choisis ta ville",
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View className="flex-1 justify-end bg-black/50">
        <Pressable
          accessibilityLabel="Fermer la liste"
          onPress={onClose}
          className="absolute inset-0"
        />
        <View
          style={{ paddingBottom: insets.bottom }}
          className="bg-niqo-white rounded-t-3xl max-h-[75%]"
        >
          <View className="px-4 h-14 flex-row items-center justify-between border-b border-niqo-gray-150">
            <Text className="font-display text-h3 text-niqo-black">
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              className="min-h-[44px] min-w-[44px] items-center justify-center -mr-2 active:opacity-60"
            >
              <X size={22} color="#1A1A1A" />
            </Pressable>
          </View>

          <FlatList
            data={cities}
            keyExtractor={(c) => c}
            renderItem={({ item }) => {
              const isSelected = item === selected;
              return (
                <Pressable
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={item}
                  className="px-4 min-h-[56px] flex-row items-center justify-between border-b border-niqo-gray-100 active:bg-niqo-gray-50"
                >
                  <Text
                    className={`font-body text-body ${
                      isSelected
                        ? "text-niqo-coral"
                        : "text-niqo-black"
                    }`}
                  >
                    {item}
                  </Text>
                  {isSelected && <Check size={20} color="#D85A30" />}
                </Pressable>
              );
            }}
            showsVerticalScrollIndicator={false}
          />
        </View>
      </View>
    </Modal>
  );
}
