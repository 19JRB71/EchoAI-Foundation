import React, { useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { Button, Card } from "../components/ui";
import { colors, spacing } from "../theme";

// Features that exist on the EchoAI web platform but aren't built into the
// mobile app yet. Listed so the roadmap is visible inside the app shell.
const UPCOMING = [
  "Ad campaigns (Facebook & Google)",
  "Content studio (social, video, email, images)",
  "SEO tools",
  "Reputation management",
  "AI phone agent",
  "Sales scripts",
  "ROI dashboard",
  "Billing & subscription",
];

export default function SettingsScreen() {
  const {
    user,
    logout,
    biometricAvailable,
    biometricEnabled,
    enableBiometric,
    disableBiometric,
  } = useAuth();
  const [busy, setBusy] = useState(false);

  async function toggleBiometric(next) {
    setBusy(true);
    try {
      if (next) await enableBiometric();
      else await disableBiometric();
    } catch (err) {
      Alert.alert("Biometric setup failed", err.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirmLogout() {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => logout() },
    ]);
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Card style={styles.section}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.value}>{user?.email}</Text>
        {user?.subscriptionTier ? (
          <Text style={styles.tier}>{String(user.subscriptionTier).toUpperCase()} plan</Text>
        ) : null}
      </Card>

      <Card style={styles.section}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.value}>Biometric sign in</Text>
            <Text style={styles.hint}>
              {biometricAvailable
                ? "Use Face ID / fingerprint to unlock EchoAI."
                : "Not available on this device."}
            </Text>
          </View>
          <Switch
            value={biometricEnabled}
            onValueChange={toggleBiometric}
            disabled={!biometricAvailable || busy}
            trackColor={{ true: colors.primary }}
          />
        </View>
      </Card>

      <Card style={styles.section}>
        <Text style={styles.label}>Coming to mobile</Text>
        {UPCOMING.map((f) => (
          <Text key={f} style={styles.upcoming}>
            • {f}
          </Text>
        ))}
        <Text style={styles.hint}>
          Manage these in the EchoAI web app for now.
        </Text>
      </Card>

      <Button title="Sign out" variant="secondary" onPress={confirmLogout} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, gap: spacing.md },
  section: { marginBottom: 0 },
  label: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xs },
  value: { color: colors.text, fontSize: 16, fontWeight: "600" },
  tier: { color: colors.primary, marginTop: spacing.xs, fontWeight: "700" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchText: { flex: 1, marginRight: spacing.md },
  hint: { color: colors.textMuted, marginTop: spacing.xs, fontSize: 13 },
  upcoming: { color: colors.text, marginTop: spacing.xs },
});
