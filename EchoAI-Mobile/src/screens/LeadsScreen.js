import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { dataApi, legacyApi } from "../api/client";
import { Banner } from "../components/ui";
import { colors, radius, spacing } from "../theme";

const FILTERS = [
  { key: null, label: "All" },
  { key: "hot", label: "Hot" },
  { key: "warm", label: "Warm" },
  { key: "tire_kicker", label: "Cold" },
];

function TemperatureBadge({ temperature }) {
  const color = colors[temperature] || colors.textMuted;
  const label =
    temperature === "tire_kicker" ? "cold" : temperature || "—";
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

function LeadRow({ lead }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.name}>{lead.name || "Unnamed lead"}</Text>
        <Text style={styles.contact}>{lead.email || lead.phone || "No contact info"}</Text>
      </View>
      <TemperatureBadge temperature={lead.temperature} />
    </View>
  );
}

export default function LeadsScreen() {
  const [brand, setBrand] = useState(null);
  const [filter, setFilter] = useState(null);
  const [leads, setLeads] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const fetchPage = useCallback(
    async ({ brandId, temperature, reset }) => {
      const res = await dataApi.leads({
        brandId,
        temperature: temperature || undefined,
        cursor: reset ? undefined : cursor,
        limit: 20,
      });
      setLeads((prev) => (reset ? res.data : [...prev, ...res.data]));
      setCursor(res.pagination?.nextCursor || null);
      setHasMore(!!res.pagination?.hasMore);
    },
    [cursor]
  );

  // Initial load: resolve a brand, then first page.
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const brands = await legacyApi.brands();
        if (!brands.length) {
          setBrand(null);
          setLeads([]);
          return;
        }
        const first = brands[0];
        setBrand(first);
        await fetchPage({ brandId: first.brand_id, temperature: filter, reset: true });
      } catch (err) {
        setError(err.message || "Could not load leads.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyFilter(next) {
    if (!brand) return;
    setFilter(next);
    setLoading(true);
    setError(null);
    setCursor(null);
    try {
      await fetchPage({ brandId: brand.brand_id, temperature: next, reset: true });
    } catch (err) {
      setError(err.message || "Could not load leads.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!brand || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      await fetchPage({ brandId: brand.brand_id, temperature: filter, reset: false });
    } catch {
      // keep what we have; user can pull/scroll to retry
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <View style={styles.flex}>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.label}
            onPress={() => applyFilter(f.key)}
            style={[styles.chip, filter === f.key && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <View style={styles.padded}>
          <Banner tone="danger">{error}</Banner>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={leads}
          keyExtractor={(item) => String(item.leadId)}
          renderItem={({ item }) => <LeadRow lead={item} />}
          contentContainerStyle={styles.list}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {brand ? "No leads match this filter yet." : "No brands yet — create one in the web app."}
            </Text>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  padded: { padding: spacing.md },
  filters: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontWeight: "600" },
  chipTextActive: { color: "#111827" },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowMain: { flex: 1, marginRight: spacing.md },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  contact: { color: colors.textMuted, marginTop: 2 },
  badge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: spacing.xl },
});
