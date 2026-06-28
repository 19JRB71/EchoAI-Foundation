import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";

/**
 * Generic "coming soon" screen for EchoAI features that exist on the web
 * platform but aren't built into the mobile app yet. Pass a `title` (and
 * optional `description`) via navigation params:
 *
 *   navigation.navigate("Placeholder", { title: "SEO tools" });
 */
export default function PlaceholderScreen({ route }) {
  const title = route?.params?.title || "Coming soon";
  const description =
    route?.params?.description ||
    "This feature is available in the EchoAI web app and is coming to mobile soon.";

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🚧</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  icon: { fontSize: 56, marginBottom: spacing.md },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", textAlign: "center" },
  description: {
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 22,
  },
});
