import { Component } from 'react';

/**
 * Without this, a render-time exception unmounts the whole app and leaves a blank
 * page with nothing in the UI to explain it.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="max-w-md rounded-xl border border-steel-200 bg-white p-8 text-center shadow-ticket">
          <h1 className="font-display text-xl font-semibold text-steel-900">
            Something went wrong on this screen
          </h1>
          <p className="mt-2 text-sm text-steel-500">
            Nothing you entered has been sent. Reload to carry on — if it keeps happening, note
            what you were doing and pass it on.
          </p>
          <p className="num mt-3 break-words text-xs text-steel-400">
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 rounded-md bg-copper-500 px-5 py-2.5 text-sm font-semibold text-steel-950 hover:bg-copper-400"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
