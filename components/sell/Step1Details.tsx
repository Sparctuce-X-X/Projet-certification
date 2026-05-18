import { Text, TextInput, View } from "react-native";

interface Props {
  titre: string;
  description: string;
  onChange: (patch: { titre?: string; description?: string }) => void;
}

const TITRE_MIN = 3;
const TITRE_MAX = 50;
const DESC_MIN = 10;
const DESC_MAX = 2000;

/**
 * Step 1 — titre + description.
 *
 * Validations affichées en compteur sous chaque champ. Les bornes matchent
 * les check constraints DB (cf. migration 15) — si l'user atteint la limite,
 * le TextInput refuse les caractères supplémentaires côté client.
 */
export function Step1Details({ titre, description, onChange }: Props) {
  const titreLen = titre.trim().length;
  const descLen = description.trim().length;
  const titreOk = titreLen >= TITRE_MIN && titreLen <= TITRE_MAX;
  const descOk = descLen >= DESC_MIN && descLen <= DESC_MAX;

  return (
    <View>
      {/* Titre */}
      <Text className="font-body text-caption text-niqo-gray-800 mb-1">
        Titre
      </Text>
      <TextInput
        value={titre}
        onChangeText={(t) => onChange({ titre: t.slice(0, TITRE_MAX) })}
        placeholder="iPhone 13 Pro Max 256 Go"
        placeholderTextColor="#888780"
        maxLength={TITRE_MAX}
        returnKeyType="next"
        accessibilityLabel="Titre de l'annonce"
        className="bg-niqo-gray-50 rounded-card px-4 h-12 mb-1 font-body text-body text-niqo-black border border-transparent"
      />
      <Text
        className={`font-body text-micro mb-4 ${
          titreLen === 0
            ? "text-niqo-gray-500"
            : titreOk
              ? "text-niqo-success"
              : "text-niqo-warning"
        }`}
      >
        {titreLen}/{TITRE_MAX}
        {titreLen > 0 && titreLen < TITRE_MIN ? ` — ${TITRE_MIN} caractères minimum` : ""}
      </Text>

      {/* Description */}
      <Text className="font-body text-caption text-niqo-gray-800 mb-1">
        Description
      </Text>
      <TextInput
        value={description}
        onChangeText={(t) => onChange({ description: t.slice(0, DESC_MAX) })}
        placeholder="État, accessoires inclus, raison de la vente, etc."
        placeholderTextColor="#888780"
        maxLength={DESC_MAX}
        multiline
        textAlignVertical="top"
        accessibilityLabel="Description de l'annonce"
        className="bg-niqo-gray-50 rounded-card px-4 py-3 mb-1 font-body text-body text-niqo-black border border-transparent"
        style={{ minHeight: 140 }}
      />
      <Text
        className={`font-body text-micro ${
          descLen === 0
            ? "text-niqo-gray-500"
            : descOk
              ? "text-niqo-success"
              : "text-niqo-warning"
        }`}
      >
        {descLen}/{DESC_MAX}
        {descLen > 0 && descLen < DESC_MIN ? ` — ${DESC_MIN} caractères minimum` : ""}
      </Text>
    </View>
  );
}
