import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { Button, Field, Banner } from "../../components/ui";
import { colors, spacing } from "../../theme";

export default function LoginScreen({ navigation }) {
  const { login, biometricAvailable } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      // RootNavigator swaps to the main tabs once isAuthenticated flips.
    } catch (err) {
      setError(err.message || "Sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>EchoAI</Text>
        <Text style={styles.subtitle}>Your AI marketing team, in your pocket.</Text>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@company.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
        />

        <Button title="Sign in" onPress={onSubmit} loading={loading} />

        {biometricAvailable ? (
          <Button
            title="Use Face ID / fingerprint"
            variant="ghost"
            onPress={() => navigation.navigate("BiometricLogin")}
            style={{ marginTop: spacing.sm }}
          />
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.footerText}>No account yet?</Text>
          <Button
            title="Create one"
            variant="ghost"
            onPress={() => navigation.navigate("Register")}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, paddingTop: spacing.xl, flexGrow: 1, justifyContent: "center" },
  brand: { color: colors.primary, fontSize: 40, fontWeight: "800", textAlign: "center" },
  subtitle: { color: colors.textMuted, textAlign: "center", marginBottom: spacing.xl, marginTop: spacing.xs },
  footer: { alignItems: "center", marginTop: spacing.lg },
  footerText: { color: colors.textMuted },
});
