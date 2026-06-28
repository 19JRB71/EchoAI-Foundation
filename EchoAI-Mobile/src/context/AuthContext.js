import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { authApi, saveSession, clearSession } from "../api/client";
import { STORAGE_KEYS } from "../config";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Restore any persisted session on launch.
  useEffect(() => {
    (async () => {
      try {
        const [token, storedUser, bioToken, hasHardware] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.accessToken),
          AsyncStorage.getItem(STORAGE_KEYS.user),
          AsyncStorage.getItem(STORAGE_KEYS.biometricToken),
          LocalAuthentication.hasHardwareAsync(),
        ]);
        const enrolled = hasHardware && (await LocalAuthentication.isEnrolledAsync());
        setBiometricAvailable(!!enrolled);
        setBiometricEnabled(!!bioToken && !!enrolled);
        if (token && storedUser) setUser(JSON.parse(storedUser));
      } catch {
        // ignore — fall through to logged-out state
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  async function login(email, password) {
    const res = await authApi.login(email, password);
    await saveSession(res.data);
    setUser(res.data.user);
    return res.data.user;
  }

  async function register(payload) {
    const res = await authApi.register(payload);
    await saveSession(res.data);
    setUser(res.data.user);
    return res.data.user;
  }

  async function logout() {
    const refreshToken = await AsyncStorage.getItem(STORAGE_KEYS.refreshToken);
    try {
      await authApi.logout(refreshToken);
    } catch {
      // best-effort server revoke; clear locally regardless
    }
    await clearSession();
    await AsyncStorage.removeItem(STORAGE_KEYS.biometricToken);
    setBiometricEnabled(false);
    setUser(null);
  }

  // Mint + persist a biometric token (call while logged in).
  async function enableBiometric() {
    const res = await authApi.createBiometricToken();
    await AsyncStorage.setItem(STORAGE_KEYS.biometricToken, res.data.biometricToken);
    setBiometricEnabled(true);
  }

  async function disableBiometric() {
    await AsyncStorage.removeItem(STORAGE_KEYS.biometricToken);
    setBiometricEnabled(false);
  }

  // Prompt the device biometric check, then exchange the stored token.
  async function loginWithBiometric() {
    const bioToken = await AsyncStorage.getItem(STORAGE_KEYS.biometricToken);
    if (!bioToken) throw new Error("Biometric login is not set up on this device.");

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Sign in to EchoAI",
      fallbackLabel: "Use password",
    });
    if (!result.success) throw new Error("Biometric authentication cancelled.");

    const res = await authApi.biometricLogin(bioToken);
    await saveSession(res.data);
    // Refresh the biometric token for next time (best-effort).
    try {
      const next = await authApi.createBiometricToken();
      await AsyncStorage.setItem(STORAGE_KEYS.biometricToken, next.data.biometricToken);
    } catch {
      // keep existing token
    }
    setUser(res.data.user);
    return res.data.user;
  }

  const value = useMemo(
    () => ({
      user,
      bootstrapping,
      isAuthenticated: !!user,
      biometricAvailable,
      biometricEnabled,
      login,
      register,
      logout,
      enableBiometric,
      disableBiometric,
      loginWithBiometric,
    }),
    [user, bootstrapping, biometricAvailable, biometricEnabled]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
