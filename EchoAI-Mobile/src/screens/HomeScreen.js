import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { dataApi, legacyApi } from "../api/client";
import { Card, Banner } from "../components/ui";
import { colors, spacing } from "../theme";

function Metric({ label, value }) {
  return (
    <Card style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Card>
  );
}

function money(n) {
  if (n == null) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [brand, setBrand] = useState(null);
  const [dashboard, setDashboard] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const brands = await legacyApi.brands();
      if (!brands.length) {
        setBrand(null);
        setDashboard(null);
        return;
      }
      const first = brands[0];
      setBrand(first);
      const res = await dataApi.dashboard(first.brand_id);
      setDashboard(res.data);
    } catch (err) {
      setError(err.message || "Could not load your dashboard.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const metrics = dashboard?.metrics;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {brand ? (
        <>
          <Text style={styles.brandName}>{brand.name || brand.brand_name || "Your brand"}</Text>
          {dashboard?.weekDate ? (
            <Text style={styles.subtle}>Week of {dashboard.weekDate}</Text>
          ) : (
            <Text style={styles.subtle}>No analytics recorded yet.</Text>
          )}

          <View style={styles.metrics}>
            <Metric label="Total spend" value={money(metrics?.totalSpend)} />
            <Metric label="Total leads" value={metrics?.totalLeads ?? "—"} />
            <Metric label="Cost / lead" value={money(metrics?.costPerLead)} />
          </View>
        </>
      ) : !error ? (
        <Card>
          <Text style={styles.empty}>
            No brands yet. Create a brand in the EchoAI web app to see your metrics here.
          </Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  container: { padding: spacing.lg },
  brandName: { color: colors.text, fontSize: 24, fontWeight: "800" },
  subtle: { color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  metrics: { gap: spacing.md },
  metric: { alignItems: "flex-start" },
  metricValue: { color: colors.primary, fontSize: 30, fontWeight: "800" },
  metricLabel: { color: colors.textMuted, marginTop: spacing.xs },
  empty: { color: colors.textMuted, textAlign: "center" },
});
