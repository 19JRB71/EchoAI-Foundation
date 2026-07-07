/**
 * Returns a stand-in for an optional third-party SDK client that could not be
 * constructed because its credential (API key) is missing.
 *
 * Several SDKs (Stripe, OpenAI, Anthropic, ...) throw at CONSTRUCTION time when
 * their key is absent. Since these clients are created in modules that are
 * `require`d at server boot, an unconditional `new SDK(key)` would crash the
 * ENTIRE server even though the feature is optional. Instead, when the key is
 * missing we hand back this stub: requiring/loading it never throws, but any
 * actual USE of the client fails loudly with a clear, descriptive message.
 *
 * The stub is a Proxy that tolerates arbitrary property/method access chains
 * (e.g. `client.messages.create(...)` or `client.subscriptions.list()`) and
 * throws only when a method is finally invoked.
 *
 * @param {string} feature - human-readable feature name (e.g. "Stripe (billing)").
 * @param {string} envVar  - the env var that enables it (e.g. "STRIPE_SECRET_KEY").
 */
function makeUnconfiguredClient(feature, envVar) {
  const fail = () => {
    throw new Error(
      `${feature} is not configured: set ${envVar} to enable this feature.`
    );
  };
  const handler = {
    get() {
      return new Proxy(fail, handler);
    },
    apply() {
      return fail();
    },
  };
  return new Proxy(fail, handler);
}

module.exports = { makeUnconfiguredClient };
