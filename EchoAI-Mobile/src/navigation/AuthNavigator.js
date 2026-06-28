import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { colors } from "../theme";
import LoginScreen from "../screens/auth/LoginScreen";
import BiometricLoginScreen from "../screens/auth/BiometricLoginScreen";
import RegisterScreen from "../screens/auth/RegisterScreen";
import { useAuth } from "../context/AuthContext";

const Stack = createNativeStackNavigator();

export default function AuthNavigator() {
  const { biometricEnabled } = useAuth();

  return (
    <Stack.Navigator
      initialRouteName={biometricEnabled ? "BiometricLogin" : "Login"}
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} options={{ title: "Sign in" }} />
      <Stack.Screen
        name="BiometricLogin"
        component={BiometricLoginScreen}
        options={{ title: "Welcome back" }}
      />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ title: "Create account" }} />
    </Stack.Navigator>
  );
}
