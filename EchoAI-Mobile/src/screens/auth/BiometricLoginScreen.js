import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { Button, Banner } from "../../components/ui";
import { colors, spacing } from "../../theme";

export default function BiometricLoginScreen({ navigation }) {
  const { loginWithBiometric, biometricEnabled } = useAuth();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function onUnlock() {
    setError(null);
    setLoading(true);
    try {
      await loginWithBiometric();
    } catch (err) {
      setError(err.message || "Biometric sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔐</Text>
      <Text style={styles.title}>Welcome back</Text>
      <Text style={styles.subtitle}>
        {biometricEnabled
          ? "Unlock EchoAI with Face ID or your fingerprint."
          : "Biometric sign in isn't set up on this device yet."}
      </Text>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {biometricEnabled ? (
        <Button title="Unlock" onPress={onUnlock} loading={loading} />
      ) : null}

      <Button
        title="Sign in with password"
        variant="ghost"
        onPress={() => navigation.navigate("Login")}
        style={{ marginTop: spacing.sm }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    justifyContent: "center",
  },
  icon: { fontSize: 56, textAlign: "center", marginBottom: spacing.md },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", textAlign: "center" },
  subtitle: {
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
});
