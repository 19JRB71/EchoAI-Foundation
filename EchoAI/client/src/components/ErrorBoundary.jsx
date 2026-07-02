// Catches render/runtime errors in its subtree so a single component crash shows
// a recoverable message instead of blanking the entire app to a white screen.
//
// Two modes:
//   - default: renders a friendly error card with "Try again" / "Reload".
//   - silent:  renders nothing (used for non-critical overlays like the tour, so
//     a tour bug can never take down the dashboard).

import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Surface the crash in the console for debugging; never swallow silently.
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught an error:", error, info);
  }

  handleReset() {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.silent) return null;

    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center">
        <h2 className="text-xl font-bold text-gray-100">Something went wrong</h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-400">
          This part of the app hit an unexpected error. Your data is safe — try
          again, or reload the page.
        </p>
        {this.state.error?.message && (
          <p className="mt-3 break-words rounded-lg bg-gray-900 p-3 text-left font-mono text-xs text-red-300">
            {this.state.error.message}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={this.handleReset}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-400"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
