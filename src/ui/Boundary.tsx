import { Component, type ReactNode } from "react";

/** Izolează eroarea unui panou: restul terminalului merge mai departe, iar panoul se poate reporni. */
export class Boundary extends Component<{ name: string; children: ReactNode; className?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn(`Panoul „${this.props.name}” a căzut:`, error.message);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={`boundary ${this.props.className ?? ""}`} role="alert">
        <p><b>{this.props.name}</b> nu s-a putut afișa. Restul terminalului merge normal.</p>
        <button className="btn-ghost small" onClick={() => this.setState({ error: null })}>Repornește panoul</button>
      </div>
    );
  }
}
