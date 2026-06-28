import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../components/ui";
import { colors, spacing } from "../theme";

/**
 * The push events EchoAI sends to mobile devices via FCM. Wire a real
 * notifications inbox here once a `/api/v2/notifications` history endpoint
 * exists; today the backend pushes these three event types in real time.
 */
const EVENTS = [
  {
    icon: "🔥",
    title: "Hot lead",
    body: "A lead just turned hot from a chat, your website widget, or a phone call.",
  },
  {
    icon: "📊",
    title: "Weekly report ready",
    body: "Your latest weekly performance report has been generated.",
  },
  {
    icon: "⚠️",
    title: "Payment failed",
    body: "We couldn't process a payment — update billing to avoid a lockout.",
  },
];

export default function NotificationsScreen() {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Notifications</Text>
      <Text style={styles.subtitle}>
        EchoAI sends you a push notification the moment any of these happen.
        Enable push in Settings to receive them.
      </Text>

      {EVENTS.map((e) => (
        <Card key={e.title} style={styles.card}>
          <Text style={styles.icon}>{e.icon}</Text>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{e.title}</Text>
            <Text style={styles.cardText}>{e.body}</Text>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  subtitle: { color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  icon: { fontSize: 28, marginRight: spacing.md },
  cardBody: { flex: 1 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  cardText: { color: colors.textMuted, marginTop: 2 },
});
